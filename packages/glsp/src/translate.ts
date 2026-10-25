/**
 * GLSP operations as `@istar-ts/actions` operations: the GModel's ids, types and relative
 * positions mapped back to the model's, so every GLSP edit goes through the istar-ts dispatcher
 * exactly as a React Flow canvas edit does (flow similarity, Metin & Bork 2025 §4.1.4).
 *
 * Pure: the model and the contribution in, an `IstarOperation` (or the reason there is none)
 * out. The mapping is `modelToGModelSchema`'s (`@istar-ts/gmodel`), read backwards:
 *
 * - **Types**: `gmodelTypes(...).kindOf` (`node:K`/`edge:K` and the contribution's overrides).
 * - **Ids**: the model's; `<id>_anchor` (a link's anchor node) stands for link `<id>`, the root
 *   (`GRAPH_ID`) for "no container", and labels (`<id>_label`, `<id>_value`) for their owner.
 * - **Positions**: a GLSP client sends `changeBounds` positions relative to the element's parent
 *   in the GModel, `createNode` locations absolute (GLSP's own create handlers convert them with
 *   `getRelativeLocation`). An actor's node sits at its boundary's corner, not at the actor's
 *   `x`/`y`, so an actor moves by the boundary's offset; its elements' model positions are the
 *   boundary's corner plus their GModel position. Bounds are read from a fresh
 *   `modelToGModelSchema` of the current model, so the boundary maths lives in one place.
 */
import type { AnyIstarModel, AnyMetamodel, CustomProperties, GoalDiagnostic } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { IstarOperation } from '@istar-ts/actions';
import {
  ApplyLabelEditOperation,
  ChangeBoundsOperation,
  ChangeContainerOperation,
  ChangeRoutingPointsOperation,
  CompoundOperation,
  CreateEdgeOperation,
  CreateNodeOperation,
  DeleteElementOperation,
  ReconnectEdgeOperation,
} from '@eclipse-glsp/server';
import type { Args, Operation } from '@eclipse-glsp/server';
import { GRAPH_ID, isGNodeSchema, modelToGModelSchema } from '@istar-ts/gmodel';
import type { GModelChildSchema } from '@istar-ts/gmodel';
import type { IstarGlspContribution } from './contribution';
import { gmodelOptions } from './gmodel';
import { gmodelTypes } from './types';

/**
 * The flat `args` (GLSP's `Args`: primitives only) the palette's trigger actions carry and the
 * client sends back on the create operation.
 */
export const GLSP_ARGS = {
  /** `customProperties.<key>`: a custom property preset, e.g. a KAOS goal's type. */
  propertyPrefix: 'customProperties.',
  /** A contribution's value (the link's `label`), e.g. `help`. */
  value: 'value',
  /** For a dependency kind: the dependum's element kind. */
  dependumKind: 'dependumKind',
  /** The new element's or link's name. */
  name: 'name',
} as const;

const ANCHOR_SUFFIX = '_anchor';
const LABEL_SUFFIX = '_label';
const VALUE_SUFFIX = '_value';

/** What `translateOperation` makes of a GLSP operation. */
export type Translation =
  | { readonly ok: true; readonly operation: IstarOperation<string, string> }
  /** Nothing to do (a move to where the element already is, a client-only sub-operation). */
  | { readonly ok: true; readonly operation?: undefined }
  | { readonly ok: false; readonly diagnostics: readonly GoalDiagnostic[] };

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

class Untranslatable extends Error {
  readonly diagnostic: GoalDiagnostic;
  constructor(message: string, elementId = '', code = 'unknown-element') {
    super(message);
    this.diagnostic = { elementId, severity: 'error', message, code, source: 'glsp' };
  }
}

/** The model id a GModel id stands for: an element, a link, or the link under an anchor. */
export function modelIdOf(model: AnyIstarModel, id: string): string | undefined {
  if (model.elements.has(id) || model.links.has(id)) return id;
  if (id.endsWith(ANCHOR_SUFFIX)) {
    const linkId = id.slice(0, -ANCHOR_SUFFIX.length);
    if (model.links.has(linkId)) return linkId;
  }
  return undefined;
}

/** Absolute bounds of every node of the model's GModel (elements, hubs, anchors), by id. */
export function gmodelBounds(
  model: AnyIstarModel,
  contribution: IstarGlspContribution,
): Map<string, Bounds> {
  const root = modelToGModelSchema(model, gmodelOptions(contribution));
  const bounds = new Map<string, Bounds>();
  const walk = (element: GModelChildSchema, origin: { x: number; y: number }): void => {
    // Nodes only: labels are placed by their owner, edges by their ends.
    if (!isGNodeSchema(element)) return;
    const box = {
      x: origin.x + element.position.x,
      y: origin.y + element.position.y,
      width: element.size.width,
      height: element.size.height,
    };
    bounds.set(element.id, box);
    for (const child of element.children) walk(child, box);
  };
  for (const child of root.children) walk(child, { x: 0, y: 0 });
  return bounds;
}

/** The GLSP flat args as `createNode`'s custom properties: the `customProperties.` keys. */
function propertiesOf(args: Args | undefined): CustomProperties | undefined {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (key.startsWith(GLSP_ARGS.propertyPrefix)) {
      properties[key.slice(GLSP_ARGS.propertyPrefix.length)] = String(value);
    }
  }
  return Object.keys(properties).length > 0 ? properties : undefined;
}

/** The schema defaults of a kind (`PropertySchema.defaults`), as the React canvas presets them. */
function defaultsOf(
  contribution: IstarGlspContribution,
  kind: string,
): CustomProperties | undefined {
  const schema = contribution.schemas?.find((s) => s.kind === kind);
  const defaults = schema?.defaults();
  return defaults && Object.keys(defaults).length > 0 ? defaults : undefined;
}

const round = (n: number): number => Math.round(n);

/**
 * The istar-ts operation for a GLSP operation, against `model` (the store's current model).
 * Unknown types and ids are rejected here, with a diagnostic; everything else (`canLink`, guards,
 * property schemas) is the dispatcher's to decide.
 */
export function translateOperation(
  operation: Operation,
  model: AnyIstarModel,
  contribution: IstarGlspContribution,
): Translation {
  try {
    const operationOut = new Translator(model, contribution).translate(operation);
    return operationOut ? { ok: true, operation: operationOut } : { ok: true };
  } catch (error) {
    if (error instanceof Untranslatable) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
}

class Translator {
  readonly model: AnyIstarModel;
  readonly contribution: IstarGlspContribution;
  readonly metamodel: AnyMetamodel;
  readonly types: ReturnType<typeof gmodelTypes>;
  private boundsCache?: Map<string, Bounds>;

  constructor(model: AnyIstarModel, contribution: IstarGlspContribution) {
    this.model = model;
    this.contribution = contribution;
    // The model's metamodel: the contribution's, extended by the file's own block.
    this.metamodel = metamodelOf(model) as unknown as AnyMetamodel;
    this.types = gmodelTypes(this.metamodel, contribution.types);
  }

  get bounds(): Map<string, Bounds> {
    this.boundsCache ??= gmodelBounds(this.model, this.contribution);
    return this.boundsCache;
  }

  translate(operation: Operation): IstarOperation<string, string> | undefined {
    if (CreateNodeOperation.is(operation)) return this.createNode(operation);
    if (CreateEdgeOperation.is(operation)) return this.createEdge(operation);
    if (DeleteElementOperation.is(operation)) return this.deleteElements(operation);
    if (ChangeBoundsOperation.is(operation)) return this.changeBounds(operation);
    if (ChangeContainerOperation.is(operation)) return this.changeContainer(operation);
    if (ReconnectEdgeOperation.is(operation)) return this.reconnect(operation);
    if (ApplyLabelEditOperation.is(operation)) return this.labelEdit(operation);
    if (ChangeRoutingPointsOperation.is(operation)) return this.changeRoutingPoints(operation);
    if (CompoundOperation.is(operation)) {
      const operationList = operation.operationList
        .map((child) => this.translate(child))
        .filter((child) => child !== undefined);
      if (operationList.length === 0) return undefined;
      return { kind: 'compound', operationList };
    }
    // Operations with no istar-ts counterpart (a client's `layout`) are skipped, as GLSP's own
    // compound handler skips operations no handler takes.
    return undefined;
  }

  private kindOf(type: string, category: 'element' | 'link'): string {
    const kind = this.types.kindOf(type);
    const known = category === 'element' ? this.metamodel.elements : this.metamodel.links;
    if (kind === undefined || !known.has(kind)) {
      throw new Untranslatable(
        `"${type}" is not a ${category} type of ${this.metamodel.name}`,
        '',
        'unknown-kind',
      );
    }
    return kind;
  }

  private idOf(id: string): string {
    return modelIdOf(this.model, id) ?? fail(`unknown element "${id}"`, id);
  }

  /** An actor (or `undefined` for the root): a container of the GModel. */
  private containerOf(id: string | undefined): string | undefined {
    if (id === undefined || id === GRAPH_ID) return undefined;
    return this.idOf(id);
  }

  private createNode(operation: CreateNodeOperation): IstarOperation<string, string> {
    const kind = this.kindOf(operation.elementTypeId, 'element');
    const containerId = this.containerOf(operation.containerId);
    const name = operation.args?.[GLSP_ARGS.name];
    const properties = { ...defaultsOf(this.contribution, kind), ...propertiesOf(operation.args) };
    return {
      kind: 'createNode',
      elementTypeId: kind,
      // Absolute, as GLSP sends it, and the element's top-left corner, as GLSP's own create
      // handlers place it. Rounded, as the React canvas does.
      ...(operation.location
        ? { location: { x: round(operation.location.x), y: round(operation.location.y) } }
        : {}),
      ...(containerId === undefined ? {} : { containerId }),
      args: {
        ...(name === undefined ? {} : { name: String(name) }),
        ...(Object.keys(properties).length > 0 ? { customProperties: properties } : {}),
      },
    };
  }

  private createEdge(operation: CreateEdgeOperation): IstarOperation<string, string> {
    const kind = this.kindOf(operation.elementTypeId, 'link');
    const definition = this.metamodel.links.get(kind)!;
    const source = this.idOf(operation.sourceElementId);
    const target = this.idOf(operation.targetElementId);
    const args = operation.args ?? {};
    const name = args[GLSP_ARGS.name];
    const base = {
      kind: 'createEdge',
      elementTypeId: kind,
      sourceElementId: source,
      targetElementId: target,
    } as const;
    // The same args the React canvas's `onConnect` sends.
    if (definition.category === 'dependency') {
      const dependumKind = args[GLSP_ARGS.dependumKind];
      const label =
        dependumKind === undefined
          ? undefined
          : this.metamodel.elements.get(String(dependumKind))?.label;
      return {
        ...base,
        args: {
          dependum: {
            ...(dependumKind === undefined ? {} : { kind: String(dependumKind) }),
            ...(name !== undefined
              ? { name: String(name) }
              : label === undefined
                ? {}
                : { name: label }),
          },
        },
      };
    }
    const value = args[GLSP_ARGS.value];
    // A new n-ary link's properties live on its hub (DSM3's split link); an existing hub as
    // target adds a leg, which has none.
    const targetIsHub =
      this.metamodel.elements.get(this.model.elements.get(target)?.kind ?? '')?.role === 'hub';
    const nary = definition.arity === 'n';
    const properties = nary && !targetIsHub ? defaultsOf(this.contribution, kind) : undefined;
    return {
      ...base,
      args: {
        ...(value === undefined ? {} : { value: String(value) }),
        ...(name === undefined ? {} : { name: String(name) }),
        ...(properties ? { customProperties: properties } : {}),
      },
    };
  }

  private deleteElements(
    operation: DeleteElementOperation,
  ): IstarOperation<string, string> | undefined {
    // Labels and anchors are parts of their owner, not elements of their own: a client deleting
    // a selection that includes one deletes the rest.
    const ids = [
      ...new Set(
        operation.elementIds.filter(
          (id) => this.model.elements.has(id) || this.model.links.has(id),
        ),
      ),
    ];
    return ids.length > 0 ? { kind: 'deleteElement', elementIds: ids } : undefined;
  }

  private isActor(id: string): boolean {
    const element = this.model.elements.get(id);
    return this.metamodel.elements.get(element?.kind ?? '')?.category === 'actor';
  }

  /** The absolute corner of `id`'s container in the GModel: an actor's boundary, or the origin. */
  private originOf(id: string): { x: number; y: number } {
    const parent = this.model.elements.get(id)?.parent;
    if (parent === undefined || this.isActor(id)) return { x: 0, y: 0 };
    const box = this.bounds.get(parent);
    return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
  }

  private changeBounds(
    operation: ChangeBoundsOperation,
  ): IstarOperation<string, string> | undefined {
    const newBounds = [];
    for (const { elementId, newPosition, newSize } of operation.newBounds) {
      const element =
        this.model.elements.get(elementId) ?? fail(`unknown element "${elementId}"`, elementId);
      const box = this.bounds.get(elementId);
      if (!box) fail(`"${elementId}" is not drawn (inside a collapsed actor)`, elementId);
      const actor = this.isActor(elementId);
      let position: { x: number; y: number } | undefined;
      if (newPosition) {
        const origin = this.originOf(elementId);
        const x = round(origin.x + newPosition.x);
        const y = round(origin.y + newPosition.y);
        // An actor's node is its boundary: the actor moves by the boundary's offset.
        const next = actor
          ? { x: element.x + x - round(box.x), y: element.y + y - round(box.y) }
          : { x, y };
        if (next.x !== element.x || next.y !== element.y) position = next;
      }
      // GLSP sends the size with every move: only a changed size is written to `display`. An
      // actor's boundary is derived from its elements (piStar's `updateBoundary`), so it isn't.
      const size =
        newSize &&
        !actor &&
        (round(newSize.width) !== box.width || round(newSize.height) !== box.height)
          ? { width: round(newSize.width), height: round(newSize.height) }
          : undefined;
      if (position || size) {
        newBounds.push({
          elementId,
          ...(position ? { newPosition: position } : {}),
          ...(size ? { newSize: size } : {}),
        });
      }
    }
    return newBounds.length > 0 ? { kind: 'changeBounds', newBounds } : undefined;
  }

  /** A GEdge's id is its link's id (`modelToGModelSchema`), so no anchor resolution needed. */
  private changeRoutingPoints(
    operation: ChangeRoutingPointsOperation,
  ): IstarOperation<string, string> | undefined {
    const operationList: IstarOperation<string, string>[] = [];
    for (const { elementId, newRoutingPoints } of operation.newRoutingPoints) {
      if (!this.model.links.has(elementId)) fail(`"${elementId}" is not a link`, elementId);
      operationList.push({
        kind: 'istar.updateLinkDisplay',
        linkId: elementId,
        patch: {
          vertices:
            newRoutingPoints && newRoutingPoints.length > 0
              ? newRoutingPoints.map(({ x, y }) => ({ x: round(x), y: round(y) }))
              : undefined,
        },
      });
    }
    if (operationList.length === 0) return undefined;
    return operationList.length === 1 ? operationList[0] : { kind: 'compound', operationList };
  }

  private changeContainer(operation: ChangeContainerOperation): IstarOperation<string, string> {
    const elementId = this.idOf(operation.elementId);
    const container = this.containerOf(operation.targetContainerId);
    // GLSP leaves `location` loosely defined ("the graphical location") and no stock client sends
    // this operation; it is read as the element's new position in its new container, as GModel
    // positions are.
    let location: { x: number; y: number } | undefined;
    if (operation.location) {
      const box = container === undefined ? undefined : this.bounds.get(container);
      location = {
        x: round((box?.x ?? 0) + operation.location.x),
        y: round((box?.y ?? 0) + operation.location.y),
      };
    }
    return {
      kind: 'changeContainer',
      elementId,
      targetContainerId: container ?? null,
      ...(location ? { location } : {}),
    };
  }

  private reconnect(operation: ReconnectEdgeOperation): IstarOperation<string, string> {
    const edgeElementId = operation.edgeElementId;
    if (!this.model.links.has(edgeElementId))
      fail(`unknown link "${edgeElementId}"`, edgeElementId);
    return {
      kind: 'reconnectEdge',
      edgeElementId,
      sourceElementId: this.idOf(operation.sourceElementId),
      targetElementId: this.idOf(operation.targetElementId),
    };
  }

  private labelEdit(operation: ApplyLabelEditOperation): IstarOperation<string, string> {
    const { labelId, text } = operation;
    const owner = (suffix: string): string | undefined => {
      if (!labelId.endsWith(suffix)) return undefined;
      const id = labelId.slice(0, -suffix.length);
      return this.model.elements.has(id) || this.model.links.has(id) ? id : undefined;
    };
    const named = owner(LABEL_SUFFIX);
    if (named !== undefined) return { kind: 'applyLabelEdit', labelId: named, text };
    const valued = owner(VALUE_SUFFIX);
    if (valued !== undefined && this.model.links.has(valued)) {
      return { kind: 'istar.setLinkValue', linkId: valued, value: text === '' ? null : text };
    }
    return fail(`unknown label "${labelId}"`, labelId);
  }
}

function fail(message: string, elementId = ''): never {
  throw new Untranslatable(message, elementId);
}
