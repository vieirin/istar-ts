/**
 * The dispatcher: the server side of the protocol over a `ModelStore`. Operations run as one
 * store transaction each and are rejected, model untouched, with `GoalDiagnostic`s; requests
 * are answered from the model, its metamodel and the palette; store changes reach subscribers
 * as `ModelSourceChangedAction`s, whoever made them.
 */
import {
  FILE_METAMODEL_KEY,
  MetamodelError,
  ModelOperationError,
  PistarParseError,
  TOP_LEVEL_KEYS,
  canLink,
  connectResultToDiagnostic,
  dependencyEnds,
  hostMetamodelOf,
  inheritMetamodel,
  inheritSourceLayout,
  metamodelOf,
  parsePistar,
  toPistarObject,
  validateModel,
  validateModelProperties,
  withFileMetamodel,
} from '@istar-ts/core';
import type {
  AnyIstarModel,
  AnyMetamodel,
  AnyPaletteDescription,
  ConnectResult,
  CustomProperties,
  ElementKind,
  Extra,
  GoalDiagnostic,
  IstarLink,
  IstarModel,
  LinkCheck,
  LinkKind,
  ModelChangeEvent,
  ModelStore,
  PistarFile,
  PropertySchema,
  PropertyShape,
} from '@istar-ts/core';
import type {
  CheckEdgeResultAction,
  DirtyStateChangeReason,
  IstarAction,
  IstarOperation,
  RequestCheckEdgeAction,
  RequestContextActions,
  RequestMarkersAction,
  RequestModelAction,
  RequestTypeHintsAction,
  SaveModelAction,
  SetContextActions,
  SetMarkersAction,
  SetModelAction,
  SetTypeHintsAction,
} from './actions';
import { isOperation, isRequestAction } from './actions';
import { contextActionsFor, paletteFromMetamodel, typeHintsFor } from './hints';
import { diagnosticToMarker } from './markers';

/** The response a request is answered with; `never` for other actions. */
export type ResponseFor<A> = A extends RequestModelAction
  ? SetModelAction
  : A extends RequestTypeHintsAction
    ? SetTypeHintsAction
    : A extends RequestCheckEdgeAction
      ? CheckEdgeResultAction
      : A extends RequestContextActions
        ? SetContextActions
        : A extends RequestMarkersAction
          ? SetMarkersAction
          : never;

/**
 * What dispatching an action did. Plain JSON, like the actions.
 *
 * A rejection (`ok: false`) left the model untouched: the same model object, no undo step. Its
 * diagnostics say why (an unknown element, a link `canLink` refuses, a guard, a property schema).
 */
export type ActionResult<R = never> =
  | {
      readonly ok: true;
      /** Ids of the elements, then links, the action added, in model order. */
      readonly createdIds: readonly string[];
      /** A request's answer. */
      readonly response?: R;
      /** Non-error diagnostics from guards, for an operation that was applied anyway. */
      readonly diagnostics?: readonly GoalDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly GoalDiagnostic[] };

export type ActionListener<EK extends string = ElementKind, LK extends string = LinkKind> = (
  action: IstarAction<EK, LK>,
) => void;

/**
 * Sends actions and hears what the other side sends back. Implemented in-process by
 * `createActionDispatcher`; a transport implements it over a message port.
 */
/** `dispatch`'s second argument. */
export interface DispatchOptions {
  /**
   * Echoed back as `origin` on every `ModelSourceChangedAction` and `SetDirtyStateAction` this
   * dispatch causes (each change of a compound, both events of an undo or redo), so a listener
   * can tell which surface or client made a change without tracking it itself. Carried through
   * `createRemoteDispatcher`/`connectDispatcher` and by `createMirrorStore`'s dispatcher, so it
   * survives a round trip to a remote host. Optional: a change with no origin (a host's direct
   * `store.load`, for instance) has none.
   */
  readonly origin?: string;
}

export interface ActionDispatcher<EK extends string = ElementKind, LK extends string = LinkKind> {
  /**
   * For a **local** dispatcher (`createActionDispatcher`), an operation, `glspUndo`/`glspRedo`,
   * and the guards and postGuards around them, are applied to the store and every listener
   * (`subscribe`, the store's own) is notified synchronously, before this call's promise is
   * created to resolve — only `saveModel` awaits. Code that needs to see the result of an action
   * before its own next statement (not just before `await dispatch(...)` resolves) can rely on
   * this for a local dispatcher; it does **not** hold across a `createRemoteDispatcher`/
   * `connectDispatcher` transport or a `createMirrorStore` mirror, where a change always arrives
   * after a message round trip. Use `origin` ({@link DispatchOptions}) instead where that
   * portability matters — it is carried through both.
   */
  dispatch<A extends IstarAction<EK, LK>>(
    action: A,
    options?: DispatchOptions,
  ): Promise<ActionResult<ResponseFor<A>>>;
  /**
   * Hears the actions the dispatcher sends: `ModelSourceChangedAction` after every model change,
   * `SetDirtyStateAction` when the dirty state flips, and the notifications dispatched to it.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ActionListener<EK, LK>): () => void;
}

/**
 * A host's rule, run before each operation is applied (and before each operation of a compound
 * one, against the model as the previous ones left it). Diagnostics of severity `error` reject
 * the operation; others are returned with the result.
 */
export type ActionGuard<EK extends string = ElementKind, LK extends string = LinkKind> = (
  operation: IstarOperation<EK, LK>,
  model: IstarModel<EK, LK>,
) => readonly GoalDiagnostic[] | void;

/**
 * A host's rule, run after each operation is applied (and after each operation of a compound
 * one, plus once more on the compound's own result), inside the operation's transaction. Sees
 * the model as the operation leaves it (`modelAfter`) and as it was before (`modelBefore`), so
 * it can check things a pre-guard can't without re-applying the operation itself (goal-controller's
 * edgeV2 engine check is the motivating case). Diagnostics of severity `error` roll the
 * transaction back: the model is untouched and there is no undo entry. Others are returned with
 * the result, merged with pre-guards' warnings.
 */
export type ActionPostGuard<EK extends string = ElementKind, LK extends string = LinkKind> = (
  operation: IstarOperation<EK, LK>,
  modelAfter: IstarModel<EK, LK>,
  modelBefore: IstarModel<EK, LK>,
) => readonly GoalDiagnostic[] | void;

export interface ActionDispatcherOptions<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> {
  readonly guards?: readonly ActionGuard<EK, LK>[];
  /** Run after each operation is applied; see `ActionPostGuard`. */
  readonly postGuards?: readonly ActionPostGuard<EK, LK>[];
  /**
   * What `RequestContextActions` offers: a fixed description, or a function evaluated on each
   * request (so a host can track a registry or extensions that change after this dispatcher was
   * created — a plain `AnyPaletteDescription` is read once, at creation). Default: derived from
   * the model's current metamodel (`paletteFromMetamodel`), the same fallback `contributionFor`
   * (`@istar-ts/glsp`) uses — not iStar 2.0's palette regardless of dialect.
   */
  readonly palette?: AnyPaletteDescription | (() => AnyPaletteDescription);
  /**
   * Property schemas an operation must not break: an operation that adds an issue
   * (`validateModelProperties`) is rejected. Their issues are also markers.
   */
  readonly schemas?: readonly PropertySchema<PropertyShape, string>[];
  /** The host's diagnostics (e.g. a `DiagnosticsStore`'s `getAll`), reported as markers. */
  readonly diagnostics?: () => readonly GoalDiagnostic[];
  /** Writes the file for `SaveModelAction`; without it, saving is rejected. */
  readonly save?: (file: PistarFile, action: SaveModelAction) => void | Promise<void>;
  /** `ModelSourceChangedAction.sourceModelName`, e.g. the file name. Default `''`. */
  readonly sourceModelName?: string;
  /**
   * Attach the new model to every `sourceModelChanged` as `newRoot` (piStar JSON), so a mirror
   * on the other end of a transport (`createMirrorStore`) follows without a `requestModel` round
   * trip. Costs a `toPistarObject` per change (0.3 ms on the largest fixture). Default false.
   */
  readonly sendModel?: boolean;
}

export interface StoreActionDispatcher<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends ActionDispatcher<EK, LK> {
  /** True while the model differs from the one last saved (or loaded, or given at creation). */
  isDirty(): boolean;
  /** Stops listening to the store. */
  dispose(): void;
}

/** Thrown inside a transaction to roll it back and reject the action. */
class Rejection extends Error {
  readonly diagnostics: readonly GoalDiagnostic[];
  constructor(diagnostics: readonly GoalDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join('; '));
    this.diagnostics = diagnostics;
  }
}

function reject(message: string, elementId = '', code?: string): never {
  throw new Rejection([
    { elementId, severity: 'error', message, ...(code === undefined ? {} : { code }) },
  ]);
}

function rejectCheck(
  check: Extract<LinkCheck, { ok: false }>,
  endpoints: { readonly source: string; readonly target: string },
): never {
  throw new Rejection([connectResultToDiagnostic(check as ConnectResult, endpoints)!]);
}

function metaOf(model: AnyIstarModel): AnyMetamodel {
  return metamodelOf(model) as unknown as AnyMetamodel;
}

/**
 * Keys `istar.updateModelExtra`'s `set`/`remove` must not touch: every key core models itself
 * (`TOP_LEVEL_KEYS`, which includes `tool`), and `"metamodel"` (`istar.setFileMetamodel`'s own).
 */
const RESERVED_EXTRA_KEYS: ReadonlySet<string> = new Set([...TOP_LEVEL_KEYS, FILE_METAMODEL_KEY]);

/** A model with `links` changed, as the core operations derive one. */
function withLinks(model: AnyIstarModel, links: ReadonlyMap<string, IstarLink<string>>) {
  return inheritMetamodel(model, inheritSourceLayout(model, { ...model, links }));
}

function createdIds(before: AnyIstarModel, after: AnyIstarModel): string[] {
  const ids: string[] = [];
  for (const id of after.elements.keys()) if (!before.elements.has(id)) ids.push(id);
  for (const id of after.links.keys()) if (!before.links.has(id)) ids.push(id);
  return ids;
}

function issueKey(d: { readonly id: string; readonly key: string; readonly message: string }) {
  return `${d.id}\u0000${d.key}\u0000${d.message}`;
}

function linkIssueDiagnostics(model: AnyIstarModel): GoalDiagnostic[] {
  return validateModel(model).map((issue) => ({
    elementId: issue.linkId,
    severity: 'error',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * A dispatcher over `store`, in-process. Hand it to a transport to serve remote clients.
 */
export function createActionDispatcher<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
>(
  store: ModelStore<EK, LK>,
  options: ActionDispatcherOptions<EK, LK> = {},
): StoreActionDispatcher<EK, LK> {
  const s = store as unknown as ModelStore<string, string>;
  const guards = (options.guards ?? []) as readonly ActionGuard<string, string>[];
  const postGuards = (options.postGuards ?? []) as readonly ActionPostGuard<string, string>[];
  const resolvePalette = (meta: AnyMetamodel): AnyPaletteDescription => {
    const option = options.palette;
    if (typeof option === 'function') return option();
    return option ?? paletteFromMetamodel(meta);
  };
  const sourceModelName = options.sourceModelName ?? '';
  const listeners = new Set<ActionListener<string, string>>();

  let saved: AnyIstarModel = s.getModel();
  let dirty = false;
  /**
   * The origin of the dispatch currently applying synchronously (set by `dispatch`, around the
   * synchronous part of `run`): what the store's subscription below echoes on
   * `sourceModelChanged`/`setDirtyState`. `undefined` for a change not caused by a dispatch (a
   * host's direct `store.load`) or once `run`'s synchronous part has returned.
   */
  let currentOrigin: string | undefined;

  const emit = (action: IstarAction<string, string>): void => {
    for (const listener of listeners) listener(action);
  };

  const updateDirty = (reason: DirtyStateChangeReason, origin: string | undefined): void => {
    const next = s.getModel() !== saved;
    if (next === dirty) return;
    dirty = next;
    emit({
      kind: 'setDirtyState',
      isDirty: next,
      reason,
      ...(origin === undefined ? {} : { origin }),
    });
  };

  const REASONS: Record<ModelChangeEvent['source'], DirtyStateChangeReason> = {
    edit: 'operation',
    undo: 'undo',
    redo: 'redo',
    load: 'external',
  };
  const unsubscribe = s.subscribe((event) => {
    // A load opens a file: the new model is the saved one.
    if (event.source === 'load') saved = event.model;
    emit({
      kind: 'sourceModelChanged',
      sourceModelName,
      source: event.source,
      changes: event.changes,
      ...(options.sendModel ? { newRoot: toPistarObject(event.model) } : {}),
      ...(options.sendModel ? { canUndo: s.canUndo(), canRedo: s.canRedo() } : {}),
      ...(currentOrigin === undefined ? {} : { origin: currentOrigin }),
    });
    updateDirty(REASONS[event.source], currentOrigin);
  });

  // -------------------------------------------------------------------------------------------
  // Operations

  const requireElement = (id: string) =>
    s.getModel().elements.get(id) ?? reject(`unknown element "${id}"`, id, 'unknown-element');

  const runGuards = (operation: IstarOperation<string, string>, warnings: GoalDiagnostic[]) => {
    const errors: GoalDiagnostic[] = [];
    for (const guard of guards) {
      for (const d of guard(operation, s.getModel()) ?? []) {
        (d.severity === 'error' ? errors : warnings).push(d);
      }
    }
    if (errors.length > 0) throw new Rejection(errors);
  };

  const runPostGuards = (
    operation: IstarOperation<string, string>,
    before: AnyIstarModel,
    warnings: GoalDiagnostic[],
  ) => {
    const errors: GoalDiagnostic[] = [];
    for (const guard of postGuards) {
      for (const d of guard(operation, s.getModel(), before) ?? []) {
        (d.severity === 'error' ? errors : warnings).push(d);
      }
    }
    if (errors.length > 0) throw new Rejection(errors);
  };

  const apply = (operation: IstarOperation<string, string>, warnings: GoalDiagnostic[]): void => {
    runGuards(operation, warnings);
    const before = s.getModel();
    doApply(operation, warnings);
    runPostGuards(operation, before, warnings);
  };

  const doApply = (operation: IstarOperation<string, string>, warnings: GoalDiagnostic[]): void => {
    const model = s.getModel();
    const meta = metaOf(model);
    switch (operation.kind) {
      case 'createNode': {
        const { elementTypeId: kind, containerId, args = {} } = operation;
        const definition =
          meta.elements.get(kind) ??
          reject(`unknown element kind "${kind}" in ${meta.name}`, '', 'unknown-kind');
        if (definition.role === 'hub') {
          reject(`a ${definition.label} is created with its link (createEdge)`, '', 'hub-kind');
        }
        const container = containerId === undefined ? undefined : requireElement(containerId);
        if (definition.category === 'node') {
          // piStar only adds an element where its kind may be: inside an actor, or on paper.
          if (container && definition.info?.canBeInnerElement === false) {
            reject(`a ${definition.label} cannot be inside an actor`, containerId, 'container');
          }
          if (!container && definition.info?.canBeOnPaper === false) {
            reject(`a ${definition.label} must be created inside an actor`, '', 'container');
          }
        }
        const location = operation.location ?? container ?? { x: 0, y: 0 };
        s.addElement({
          kind,
          x: location.x,
          y: location.y,
          ...(containerId === undefined ? {} : { parent: containerId }),
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.customProperties ? { customProperties: args.customProperties } : {}),
        });
        return;
      }
      case 'createEdge': {
        const { elementTypeId: kind, sourceElementId: source, targetElementId: target } = operation;
        const args = operation.args ?? {};
        const definition =
          meta.links.get(kind) ??
          reject(`unknown link kind "${kind}" in ${meta.name}`, '', 'unknown-kind');
        if (definition.category === 'dependency') {
          const dependum = args.dependum ?? {};
          const dependumKind =
            dependum.kind ??
            [...meta.elements.values()].find(
              (d) => d.category === 'node' && d.role !== 'hub' && d.info?.canBeDependum !== false,
            )?.kind ??
            reject(`${meta.name} has no kind that can be a dependum`, '', 'unknown-kind');
          const result = s.addDependency({
            depender: source,
            dependee: target,
            linkKind: kind,
            dependum: {
              kind: dependumKind,
              ...(dependum.id === undefined ? {} : { id: dependum.id }),
              ...(dependum.name === undefined ? {} : { name: dependum.name }),
              ...(dependum.location ? { x: dependum.location.x, y: dependum.location.y } : {}),
              ...(dependum.customProperties ? { customProperties: dependum.customProperties } : {}),
            },
            ...(args.linkIds ? { linkIds: args.linkIds } : {}),
          });
          if (!result.ok) rejectCheck(result, { source, target });
          return;
        }
        const values = definition.info.possibleLabels;
        if (args.value !== undefined && values && !values.includes(args.value)) {
          reject(
            `"${args.value}" is not a value of a ${definition.label} link (${values.join(', ')})`,
            source,
            'invalid-value',
          );
        }
        const result = s.connect({
          kind,
          source,
          target,
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.value === undefined ? {} : { label: args.value }),
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.customProperties ? { customProperties: args.customProperties } : {}),
          ...(args.legId === undefined ? {} : { legId: args.legId }),
          ...(args.endId === undefined ? {} : { endId: args.endId }),
        });
        if (!result.ok) rejectCheck(result, { source, target });
        return;
      }
      case 'deleteElement': {
        const elements: string[] = [];
        const links: string[] = [];
        for (const id of operation.elementIds) {
          if (model.elements.has(id)) elements.push(id);
          else if (model.links.has(id)) links.push(id);
          else reject(`unknown element or link "${id}"`, id, 'unknown-element');
        }
        if (elements.length > 0) s.removeElements(elements);
        // Removing elements may already have taken some of the links with them.
        for (const id of links) if (s.getModel().links.has(id)) s.disconnect(id);
        return;
      }
      case 'changeBounds': {
        for (const { elementId, newPosition, newSize } of operation.newBounds) {
          requireElement(elementId);
          if (newPosition) s.moveElement(elementId, newPosition.x, newPosition.y);
          if (newSize) {
            s.updateElement(elementId, {
              display: { width: newSize.width, height: newSize.height },
            });
          }
        }
        return;
      }
      case 'changeContainer': {
        const { elementId, targetContainerId, location } = operation;
        s.nestElement(elementId, targetContainerId);
        if (location) s.moveElement(elementId, location.x, location.y);
        return;
      }
      case 'reconnectEdge':
        reconnect(operation.edgeElementId, operation.sourceElementId, operation.targetElementId);
        return;
      case 'applyLabelEdit': {
        const hash = operation.labelId.indexOf('#');
        const id = hash < 0 ? operation.labelId : operation.labelId.slice(0, hash);
        const key = hash < 0 ? undefined : operation.labelId.slice(hash + 1);
        if (key === undefined) {
          if (model.elements.has(id)) s.updateElement(id, { name: operation.text });
          // A link's name is optional; an empty text removes it, matching what piStar writes
          // for a link whose name was cleared (fileManager.js only writes `name` when truthy).
          else if (model.links.has(id)) {
            s.updateLink(id, { name: operation.text === '' ? null : operation.text });
          } else reject(`unknown element or link "${id}"`, id, 'unknown-element');
        } else {
          setProperties(id, { [key]: operation.text });
        }
        return;
      }
      case 'compound':
        for (const child of operation.operationList) apply(child, warnings);
        return;
      case 'istar.addLeg': {
        const { hubId, sourceElementId: source } = operation;
        const result = s.addLeg(hubId, source, operation.args?.id ? { id: operation.args.id } : {});
        if (!result.ok) rejectCheck(result, { source, target: hubId });
        return;
      }
      case 'istar.removeLeg':
        s.removeLeg(operation.legId);
        return;
      case 'istar.setCollapsed': {
        const element = requireElement(operation.elementId);
        if (meta.elements.get(element.kind)?.category !== 'actor') {
          reject(`"${element.id}" is not an actor`, element.id, 'not-an-actor');
        }
        s.setCollapsed(element.id, operation.collapsed);
        return;
      }
      case 'istar.updateDiagram': {
        const { name, width, height, customProperties } = operation.diagram;
        s.updateDiagram({
          ...(name === undefined ? {} : { name }),
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(customProperties === undefined ? {} : { customProperties }),
        });
        return;
      }
      case 'istar.updateProperties':
        setProperties(operation.elementId, operation.properties);
        return;
      case 'istar.updateDisplay':
        requireElement(operation.elementId);
        s.updateElement(operation.elementId, { display: operation.patch });
        return;
      case 'istar.updateLinkDisplay':
        if (!model.links.has(operation.linkId)) {
          reject(`unknown link "${operation.linkId}"`, operation.linkId, 'unknown-element');
        }
        s.updateLink(operation.linkId, { display: operation.patch });
        return;
      case 'istar.setLinkValue': {
        const { linkId, value } = operation;
        const link =
          model.links.get(linkId) ?? reject(`unknown link "${linkId}"`, linkId, 'unknown-element');
        const definition = meta.links.get(link.kind);
        const values = definition?.info.possibleLabels;
        if (value !== null && values && !values.includes(value)) {
          reject(
            `"${value}" is not a value of a ${definition.label} link (${values.join(', ')})`,
            linkId,
            'invalid-value',
          );
        }
        s.updateLink(linkId, { label: value });
        return;
      }
      case 'istar.changeLinkKind': {
        const { linkIds, elementTypeId: kind } = operation;
        if (linkIds.length === 0) return;
        const ids = new Set(linkIds);
        const links = [...ids].map(
          (id) => model.links.get(id) ?? reject(`unknown link "${id}"`, id, 'unknown-element'),
        );
        const definition =
          meta.links.get(kind) ??
          reject(`unknown link kind "${kind}" in ${meta.name}`, '', 'unknown-kind');
        const toChange = links.filter((link) => link.kind !== kind);
        if (toChange.length === 0) return;
        const remaining = new Map(model.links);
        for (const id of ids) remaining.delete(id);
        const without = withLinks(model, remaining);
        const values = definition.info.possibleLabels;
        for (const link of toChange) {
          const check = canLink(without, link.source, link.target, kind);
          if (!check.ok) rejectCheck(check, { source: link.source, target: link.target });
          if (link.label != null && values && !values.includes(link.label)) {
            reject(
              `"${link.label}" is not a value of a ${definition.label} link (${values.join(', ')})`,
              link.id,
              'invalid-value',
            );
          }
        }
        const next = new Map(model.links);
        for (const link of toChange) next.set(link.id, { ...link, kind });
        s.replace(withLinks(model, next));
        return;
      }
      case 'istar.setFileMetamodel': {
        let next: AnyIstarModel;
        try {
          next = withFileMetamodel(model, operation.block);
        } catch (error) {
          if (error instanceof MetamodelError) reject(error.message, '', 'invalid-metamodel');
          throw error;
        }
        s.replace(next);
        return;
      }
      case 'istar.updateModelExtra': {
        const { set, remove, tool } = operation;
        for (const key of [...Object.keys(set ?? {}), ...(remove ?? [])]) {
          if (!RESERVED_EXTRA_KEYS.has(key)) continue;
          if (key === 'tool') {
            reject(
              `"tool" is a modelled field: set it with this operation's own "tool"`,
              '',
              'reserved-key',
            );
          }
          if (key === FILE_METAMODEL_KEY) {
            reject(
              `"${key}" is set with istar.setFileMetamodel, not updateModelExtra`,
              '',
              'reserved-key',
            );
          }
          reject(
            `"${key}" is modelled by the file itself and cannot be an extra key`,
            '',
            'reserved-key',
          );
        }
        let withTool: AnyIstarModel = model;
        if (tool === null) {
          const { tool: _tool, ...rest } = withTool;
          withTool = rest;
        } else if (tool !== undefined) {
          withTool = { ...withTool, tool };
        }
        const extra: Record<string, unknown> = { ...withTool.extra };
        if (set) for (const [key, value] of Object.entries(set)) extra[key] = value;
        if (remove) for (const key of remove) delete extra[key];
        const { extra: _extra, ...rest } = withTool;
        const next: AnyIstarModel = {
          ...rest,
          ...(Object.keys(extra).length > 0 ? { extra: extra as Extra } : {}),
        };
        s.replace(inheritMetamodel(model, inheritSourceLayout(model, next)));
        return;
      }
      case 'istar.replaceModel': {
        const host = hostMetamodelOf(model) ?? meta;
        let next: AnyIstarModel;
        try {
          next = parsePistar(operation.model, {
            metamodel: host,
            fileMetamodel: operation.fileMetamodel ?? false,
          });
        } catch (error) {
          if (error instanceof PistarParseError) reject(error.message, '', 'parse-error');
          throw error;
        }
        s.replace(next);
        return;
      }
      default:
        reject(`unknown operation "${(operation as { kind: string }).kind}"`, '', 'unknown-action');
    }
  };

  /** Sets (or, with `null`, removes) custom properties of an element or link. */
  const setProperties = (id: string, properties: Readonly<Record<string, string | null>>) => {
    const model = s.getModel();
    const owner = model.elements.get(id) ?? model.links.get(id);
    if (!owner) reject(`unknown element or link "${id}"`, id, 'unknown-element');
    const next: Record<string, string> = { ...owner.customProperties };
    for (const [key, value] of Object.entries(properties)) {
      if (value === null) delete next[key];
      else if (typeof value === 'string') next[key] = value;
      else reject(`the value of "${key}" must be a string or null`, id, 'invalid-value');
    }
    // Removing the last property keeps an empty object, as piStar's exports do
    // ("customProperties": {}); an owner that never had the key and ends up with none stays without it.
    if (Object.keys(next).length === 0 && owner.customProperties === undefined) return;
    const customProperties: CustomProperties = next;
    if (model.elements.has(id)) s.updateElement(id, { customProperties });
    else s.updateLink(id, { customProperties });
  };

  /**
   * Gives a link new ends, checked with `canLink` against the model without it. The link keeps
   * its place in the model (and the file), its id and everything else it carries.
   */
  const reconnect = (id: string, source: string, target: string): void => {
    const model = s.getModel();
    const meta = metaOf(model);
    const link = model.links.get(id) ?? reject(`unknown link "${id}"`, id, 'unknown-element');
    if (link.source === source && link.target === target) return;
    const definition = meta.links.get(link.kind);
    const others = new Map(model.links);
    others.delete(id);
    const without = withLinks(model, others);
    let check: LinkCheck;
    if (definition?.category === 'dependency') {
      // A dependency's link keeps its dependum end; the check is depender → dependee.
      const dependumAtTarget = model.elements.get(link.target)?.isDependum === true;
      const dependumId = dependumAtTarget ? link.target : link.source;
      if ((dependumAtTarget ? target : source) !== dependumId) {
        reject('a dependency link keeps its dependum', id, 'dependum-endpoint');
      }
      const ends = dependencyEnds(model, dependumId);
      const depender = dependumAtTarget ? source : ends.depender;
      const dependee = dependumAtTarget ? ends.dependee : target;
      if (depender === undefined || dependee === undefined) {
        reject('the dependency is incomplete', id, 'dependum-endpoint');
      }
      check = canLink(without, depender, dependee, link.kind);
      if (!check.ok) rejectCheck(check, { source: depender, target: dependee });
    } else {
      // An n-ary link's end stays on its hub, and a leg can't leave a hub without legs.
      if (definition?.role === 'end' && source !== link.source) {
        reject('the end of an n-ary link stays on its hub', id, 'hub-target');
      }
      if (definition?.role === 'leg' && target !== link.target) {
        const legs = [...model.links.values()].filter(
          (l) => l.target === link.target && l.kind === link.kind,
        );
        if (legs.length === 1) {
          reject('the last leg of an n-ary link cannot leave its hub', id, 'hub-target');
        }
      }
      check = canLink(without, source, target, link.kind);
      if (!check.ok) rejectCheck(check, { source, target });
    }
    s.replace(withLinks(model, new Map(model.links).set(id, { ...link, source, target })));
  };

  const runOperation = (operation: IstarOperation<string, string>): ActionResult => {
    const before = s.getModel();
    const warnings: GoalDiagnostic[] = [];
    s.transaction(() => {
      apply(operation, warnings);
      const schemas = options.schemas;
      if (!schemas || s.getModel() === before) return;
      const known = new Set(validateModelProperties(before, schemas).map(issueKey));
      const added = validateModelProperties(s.getModel(), schemas).filter(
        (issue) => !known.has(issueKey(issue)),
      );
      if (added.length > 0) {
        throw new Rejection(
          added.map((issue) => ({
            elementId: issue.id,
            key: issue.key,
            severity: 'error',
            message: issue.message,
            code: 'invalid-property',
          })),
        );
      }
    });
    return {
      ok: true,
      createdIds: createdIds(before, s.getModel()),
      ...(warnings.length > 0 ? { diagnostics: warnings } : {}),
    };
  };

  // -------------------------------------------------------------------------------------------
  // Requests

  const checkEdge = (action: RequestCheckEdgeAction): CheckEdgeResultAction => {
    const { edgeType, sourceElementId: source, targetElementId: target } = action;
    const model = s.getModel();
    const meta = metaOf(model);
    const answer = (check: LinkCheck): CheckEdgeResultAction => ({
      kind: 'checkEdgeTargetResult',
      responseId: action.requestId,
      isValid: check.ok,
      edgeType,
      sourceElementId: source,
      ...(target === undefined ? {} : { targetElementId: target }),
      ...(check.ok ? {} : { reason: check.reason, code: check.code }),
    });
    if (target !== undefined) {
      const check = canLink(model, source, target, edgeType);
      // `createEdge` retries reversed where piStar does (Needed-By, Qualification).
      if (!check.ok && meta.links.get(edgeType)?.info.tryReversedWhenAdding) {
        const reversed = canLink(model, target, source, edgeType);
        if (reversed.ok) return answer(reversed);
      }
      return answer(check);
    }
    // No target yet: can the source start such a link at all?
    const element = model.elements.get(source);
    if (!element) {
      return answer({
        ok: false,
        code: 'unknown-element',
        reason: `unknown source element "${source}"`,
      });
    }
    const hint = typeHintsFor(meta).edgeHints.find((h) => h.elementTypeId === edgeType);
    if (!hint) {
      return answer({
        ok: false,
        code: 'unknown-link-kind',
        reason: `unknown link kind "${edgeType}"`,
      });
    }
    if (hint.sourceElementTypeIds && !hint.sourceElementTypeIds.includes(element.kind)) {
      return answer({
        ok: false,
        code: 'invalid-source',
        reason: `a ${meta.elements.get(element.kind)?.label ?? element.kind} cannot be the source of a ${meta.links.get(edgeType)?.label ?? edgeType} link`,
      });
    }
    return answer({ ok: true });
  };

  const markers = (action: RequestMarkersAction): SetMarkersAction => {
    const model = s.getModel();
    const diagnostics: GoalDiagnostic[] = linkIssueDiagnostics(model);
    if (options.schemas) {
      for (const issue of validateModelProperties(model, options.schemas)) {
        diagnostics.push({
          elementId: issue.id,
          key: issue.key,
          severity: 'error',
          message: issue.message,
          code: 'invalid-property',
        });
      }
    }
    diagnostics.push(...(options.diagnostics?.() ?? []));
    const ids = action.elementsIDs.filter((id) => model.elements.has(id) || model.links.has(id));
    const wanted = new Set(ids);
    return {
      kind: 'setMarkers',
      responseId: action.requestId,
      markers: diagnostics
        .filter((d) => wanted.size === 0 || wanted.has(d.elementId))
        .map(diagnosticToMarker),
      ...(action.reason === undefined ? {} : { reason: action.reason }),
    };
  };

  const respond = (action: IstarAction<string, string>) => {
    const model = s.getModel();
    switch (action.kind) {
      case 'requestModel':
        return { kind: 'setModel', responseId: action.requestId, newRoot: toPistarObject(model) };
      case 'requestTypeHints':
        return {
          kind: 'setTypeHints',
          responseId: action.requestId,
          ...typeHintsFor(metaOf(model)),
        };
      case 'requestCheckEdge':
        return checkEdge(action);
      case 'requestContextActions': {
        const meta = metaOf(model);
        return {
          kind: 'setContextActions',
          responseId: action.requestId,
          ...contextActionsFor(resolvePalette(meta), meta),
        };
      }
      case 'requestMarkers':
        return markers(action);
      default:
        return undefined;
    }
  };

  // -------------------------------------------------------------------------------------------

  const run = async (
    action: IstarAction<string, string>,
    origin: string | undefined,
  ): Promise<ActionResult<unknown>> => {
    if (isOperation(action)) return runOperation(action);
    if (isRequestAction(action)) return { ok: true, createdIds: [], response: respond(action) };
    switch (action.kind) {
      case 'glspUndo':
        s.undo();
        return { ok: true, createdIds: [] };
      case 'glspRedo':
        s.redo();
        return { ok: true, createdIds: [] };
      case 'saveModel': {
        if (!options.save) reject('this host does not save models', '', 'no-save-handler');
        const model = s.getModel();
        await options.save(toPistarObject(model, { saveDate: new Date() }), action);
        saved = model;
        updateDirty('save', origin);
        return { ok: true, createdIds: [] };
      }
      case 'sourceModelChanged':
      case 'setDirtyState':
      case 'triggerNodeCreation':
      case 'triggerEdgeCreation':
      case 'deleteMarkers':
        emit(action);
        return { ok: true, createdIds: [] };
      default:
        return reject(
          `"${action.kind}" is not an action this dispatcher handles`,
          '',
          'unknown-action',
        );
    }
  };

  return {
    async dispatch(action, dispatchOptions) {
      const origin = dispatchOptions?.origin;
      // `run`'s synchronous part (an operation, undo, redo, their guards) applies and notifies
      // listeners before this call returns to its caller below, still inside this `try`: see
      // `ActionDispatcher.dispatch`'s doc comment. `currentOrigin` is reset right after, before
      // any `await`, so it can't leak into an unrelated dispatch's own synchronous part.
      currentOrigin = origin;
      let pending: Promise<ActionResult<unknown>>;
      try {
        pending = run(action as IstarAction<string, string>, origin);
      } finally {
        currentOrigin = undefined;
      }
      try {
        return (await pending) as ActionResult<never>;
      } catch (error) {
        if (error instanceof Rejection) return { ok: false, diagnostics: error.diagnostics };
        if (error instanceof ModelOperationError) {
          return { ok: false, diagnostics: [error.toDiagnostic()] };
        }
        throw error;
      }
    },
    subscribe(listener) {
      const l = listener as ActionListener<string, string>;
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isDirty: () => s.getModel() !== saved,
    dispose: unsubscribe,
  };
}
