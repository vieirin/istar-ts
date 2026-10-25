/**
 * Backend B: tools declared directly over the `@istar-ts/actions` vocabulary
 * (`HANDLED_ACTION_KINDS`), each call one `dispatcher.dispatch` (#126 §4, the native column).
 * No GLSP or MCP: the shield is the dispatcher's guards, as on every other path.
 *
 * A tool's name is its action kind with `.` as `_` (`istar.setLinkValue` → `istar_setLinkValue`,
 * since OpenAI-compatible APIs only accept `[a-zA-Z0-9_-]`); its arguments are the action's
 * fields without `kind` (and without a request's `requestId`).
 */
import { HANDLED_ACTION_KINDS, createActionDispatcher } from '@istar-ts/actions';
import type {
  ActionDispatcher,
  ActionDispatcherOptions,
  ActionGuard,
  ActionResult,
  IstarAction,
  IstarOperation,
} from '@istar-ts/actions';
import {
  ISTAR_2_0,
  createModelStore,
  defaultIdGenerator,
  metamodelOf,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import type {
  AnyIstarModel,
  AnyMetamodel,
  ElementKind,
  IdGenerator,
  IstarModel,
  LinkKind,
  ModelStore,
  PistarFile,
} from '@istar-ts/core';
import type { ChangeSetEntry, ChangeSetTarget, ScratchSession } from './change-set';
import { errorToToolResult, toolRefusal } from './tools';
import type { JsonSchema, JsonValue, ToolRegistry, ToolResult, ToolSpec } from './tools';

type ActionKind = IstarAction['kind'];

/** The action kinds offered as tools: every operation and request, plus undo and redo. */
const TOOL_KINDS: readonly ActionKind[] = [
  ...HANDLED_ACTION_KINDS.operations,
  ...HANDLED_ACTION_KINDS.requests,
  'glspUndo',
  'glspRedo',
];

const READ_ONLY_KINDS: ReadonlySet<string> = new Set(HANDLED_ACTION_KINDS.requests);

/** The tool name of an action kind. */
export function actionToolName(kind: string): string {
  return kind.replace(/\./g, '_');
}

// ---------------------------------------------------------------------------------------------
// Schemas

const str = (description?: string): JsonSchema =>
  description === undefined ? { type: 'string' } : { type: 'string', description };
const point: JsonSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
};
const properties: JsonSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
  description: 'Custom properties; values are strings.',
};
const object = (
  props: Record<string, JsonSchema>,
  required: readonly string[] = [],
): JsonSchema => ({
  type: 'object',
  properties: props,
  ...(required.length > 0 ? { required } : {}),
});

interface KindInfo {
  readonly nodes: readonly string[];
  readonly links: readonly string[];
  readonly values: string;
}

function kindInfo(metamodel: AnyMetamodel): KindInfo {
  const nodes = [...metamodel.elements.values()].filter((d) => d.role !== 'hub').map((d) => d.kind);
  const links = [...metamodel.links.values()].filter((d) => d.role === undefined);
  const values = links
    .filter((d) => d.info.possibleLabels)
    .map((d) => `${d.kind}: ${d.info.possibleLabels!.join(' | ')}`)
    .join('; ');
  return { nodes, links: links.map((d) => d.kind), values };
}

function toolFor(
  kind: ActionKind,
  info: KindInfo,
): { description: string; parameters: JsonSchema } {
  switch (kind) {
    case 'createNode':
      return {
        description:
          'Create an element. Actors go on the paper; other elements go inside an actor (containerId). Returns the new id.',
        parameters: object(
          {
            elementTypeId: { type: 'string', enum: info.nodes },
            containerId: str('The actor to create the element in.'),
            location: point,
            args: object({
              name: str(),
              id: str('The new element id. Default: generated.'),
              customProperties: properties,
            }),
          },
          ['elementTypeId'],
        ),
      };
    case 'createEdge':
      return {
        description:
          'Create a link from sourceElementId to targetElementId. A dependency kind (source = depender, target = dependee) also creates its dependum, from args.dependum. ' +
          (info.values ? `Values (args.value) per kind: ${info.values}.` : ''),
        parameters: object(
          {
            elementTypeId: { type: 'string', enum: info.links },
            sourceElementId: str(),
            targetElementId: str(),
            args: object({
              value: str("A contribution's value."),
              name: str(),
              id: str(),
              customProperties: properties,
              dependum: object({
                kind: { type: 'string', enum: info.nodes },
                name: str(),
                id: str(),
                location: point,
                customProperties: properties,
              }),
            }),
          },
          ['elementTypeId', 'sourceElementId', 'targetElementId'],
        ),
      };
    case 'deleteElement':
      return {
        description: 'Delete elements and links, with everything that depends on them.',
        parameters: object({ elementIds: { type: 'array', items: str() } }, ['elementIds']),
      };
    case 'changeBounds':
      return {
        description: 'Move or resize elements. Moving an actor moves its inner elements.',
        parameters: object(
          {
            newBounds: {
              type: 'array',
              items: object(
                {
                  elementId: str(),
                  newPosition: point,
                  newSize: object({ width: { type: 'number' }, height: { type: 'number' } }, [
                    'width',
                    'height',
                  ]),
                },
                ['elementId'],
              ),
            },
          },
          ['newBounds'],
        ),
      };
    case 'changeContainer':
      return {
        description: 'Move an inner element into another actor, or out of any actor with null.',
        parameters: object(
          {
            elementId: str(),
            targetContainerId: { type: ['string', 'null'] },
            location: point,
          },
          ['elementId', 'targetContainerId'],
        ),
      };
    case 'reconnectEdge':
      return {
        description: 'Give a link new ends, keeping its id, kind and properties.',
        parameters: object(
          { edgeElementId: str(), sourceElementId: str(), targetElementId: str() },
          ['edgeElementId', 'sourceElementId', 'targetElementId'],
        ),
      };
    case 'applyLabelEdit':
      return {
        description:
          'Rename an element or link (labelId = its id), or set one custom property (labelId = "<id>#<key>").',
        parameters: object({ labelId: str(), text: str() }, ['labelId', 'text']),
      };
    case 'compound':
      return {
        description:
          'Apply several operations as one step; if one is refused, none is applied. Each item is an operation with its action "kind" (createNode, createEdge, …, istar.setLinkValue) and that tool\'s arguments.',
        parameters: object(
          {
            operationList: {
              type: 'array',
              items: { type: 'object', properties: { kind: str() }, required: ['kind'] },
            },
          },
          ['operationList'],
        ),
      };
    case 'istar.addLeg':
      return {
        description: 'Add a leg from sourceElementId to the hub of an n-ary link.',
        parameters: object({ hubId: str(), sourceElementId: str(), args: object({ id: str() }) }, [
          'hubId',
          'sourceElementId',
        ]),
      };
    case 'istar.removeLeg':
      return {
        description: 'Remove a leg of an n-ary link; the last one takes the hub with it.',
        parameters: object({ legId: str() }, ['legId']),
      };
    case 'istar.setCollapsed':
      return {
        description: 'Collapse or expand an actor.',
        parameters: object({ elementId: str(), collapsed: { type: 'boolean' } }, [
          'elementId',
          'collapsed',
        ]),
      };
    case 'istar.updateDiagram':
      return {
        description: "Change the diagram's name, size or custom properties (replaced as a whole).",
        parameters: object(
          {
            diagram: object({
              name: str(),
              width: { type: 'number' },
              height: { type: 'number' },
              customProperties: properties,
            }),
          },
          ['diagram'],
        ),
      };
    case 'istar.updateProperties':
      return {
        description:
          'Set custom properties of an element or link: each key to its string value, or removed with null; other keys are kept.',
        parameters: object(
          {
            elementId: str(),
            properties: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
          },
          ['elementId', 'properties'],
        ),
      };
    case 'istar.updateDisplay':
      return {
        description: "Merge into an element's display (e.g. backgroundColor, width, height).",
        parameters: object({ elementId: str(), patch: { type: 'object' } }, ['elementId', 'patch']),
      };
    case 'istar.setLinkValue':
      return {
        description:
          "Set an existing link's value (e.g. a contribution's), or clear it with null. " +
          (info.values ? `Values per kind: ${info.values}.` : ''),
        parameters: object({ linkId: str(), value: { type: ['string', 'null'] } }, [
          'linkId',
          'value',
        ]),
      };
    case 'requestModel':
      return {
        description:
          'Read the model: actors with their elements, dependums, and links (ids, kinds, names, values).',
        parameters: object({}),
      };
    case 'requestTypeHints':
      return {
        description:
          'Read which element kinds an actor can contain and which kinds each link kind can connect.',
        parameters: object({}),
      };
    case 'requestCheckEdge':
      return {
        description:
          'Ask whether a link of edgeType from source to target would be accepted, and why not. Cheaper than a refused createEdge.',
        parameters: object(
          {
            edgeType: { type: 'string', enum: info.links },
            sourceElementId: str(),
            targetElementId: str(),
          },
          ['edgeType', 'sourceElementId'],
        ),
      };
    case 'requestContextActions':
      return {
        description: 'Read the palette: what can be created, with its presets.',
        parameters: object({ contextId: str('Default "tool-palette".') }),
      };
    case 'requestMarkers':
      return {
        description:
          "Validate: the model's link and property issues, and the host's diagnostics. Optionally only for some ids.",
        parameters: object({ elementsIDs: { type: 'array', items: str() } }),
      };
    case 'glspUndo':
      return { description: 'Undo the last change.', parameters: object({}) };
    case 'glspRedo':
      return { description: 'Redo the last undone change.', parameters: object({}) };
    default:
      return { description: kind, parameters: { type: 'object' } };
  }
}

// ---------------------------------------------------------------------------------------------
// Calls

type Fields = Record<string, unknown>;
type Refusal = Extract<ToolResult, { ok: false }>;

const refusal = (message: string, code: string): Refusal => toolRefusal(message, code) as Refusal;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fills in the ids a create leaves to the store, so the same action creates the same ids in a
 * dry run's scratch store and, once applied, in the live one. A `createEdge` to an existing hub
 * (a new leg) keeps the store's id: the dispatcher has no seat for it.
 */
function pinIds(
  fields: Fields,
  kind: string,
  metamodel: AnyMetamodel,
  createId: IdGenerator,
): Fields {
  const args = isFields(fields.args) ? fields.args : {};
  switch (kind) {
    case 'createNode':
    case 'istar.addLeg':
      return { ...fields, args: { ...args, id: args.id ?? createId() } };
    case 'createEdge': {
      const definition = metamodel.links.get(String(fields.elementTypeId));
      if (!definition) return fields;
      if (definition.category === 'dependency') {
        const dependum = isFields(args.dependum) ? args.dependum : {};
        return {
          ...fields,
          args: {
            ...args,
            dependum: { ...dependum, id: dependum.id ?? createId() },
            linkIds: args.linkIds ?? [createId(), createId()],
          },
        };
      }
      if (definition.parts) {
        return {
          ...fields,
          args: {
            ...args,
            id: args.id ?? createId(),
            legId: args.legId ?? createId(),
            endId: args.endId ?? createId(),
          },
        };
      }
      return { ...fields, args: { ...args, id: args.id ?? createId() } };
    }
    case 'compound': {
      if (!Array.isArray(fields.operationList)) return fields;
      return {
        ...fields,
        operationList: fields.operationList.map((child: unknown) =>
          isFields(child) && typeof child.kind === 'string'
            ? { ...pinIds(child, child.kind, metamodel, createId), kind: child.kind }
            : child,
        ),
      };
    }
    default:
      return fields;
  }
}

type FileElement = {
  readonly id: string;
  readonly type: string;
  readonly text?: string;
  readonly customProperties?: Readonly<Record<string, string>>;
};
type FileLink = {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly name?: string;
};

/**
 * The model without layout (#126 §4: no raw JSON dumps of a large model): actors and their
 * elements, loose elements, dependums and links, with the kinds the tools take (the file's
 * piStar types looked up in `metamodel`).
 */
function compactModel(file: PistarFile, metamodel: AnyMetamodel): JsonValue {
  const elementKind = (type: string) => metamodel.elementsByPistarType.get(type) ?? type;
  const linkKind = (type: string) => metamodel.linksByPistarType.get(type) ?? type;
  const node = (element: FileElement) => ({
    id: element.id,
    kind: elementKind(element.type),
    ...(element.text === undefined ? {} : { name: element.text }),
    ...(element.customProperties && Object.keys(element.customProperties).length > 0
      ? { properties: element.customProperties }
      : {}),
  });
  const link = (l: FileLink) => ({
    id: l.id,
    kind: linkKind(l.type),
    source: l.source,
    target: l.target,
    ...(l.label === undefined ? {} : { value: l.label }),
    ...(l.name === undefined ? {} : { name: l.name }),
  });
  return {
    actors: file.actors.map((actor) => ({ ...node(actor), elements: actor.nodes.map(node) })),
    elements: (file.orphans ?? []).map(node),
    dependums: (file.dependencies ?? []).map(node),
    links: (file.links ?? []).map((entry) =>
      'hub' in entry && entry.hub
        ? {
            hub: node(entry.hub as FileElement),
            legs: (entry.starts as FileLink[]).map(link),
            ...(entry.end ? { end: link(entry.end as FileLink) } : {}),
          }
        : link(entry as FileLink),
    ),
  } as unknown as JsonValue;
}

function toToolResult(
  kind: string,
  result: ActionResult<unknown>,
  metamodel: AnyMetamodel,
): ToolResult {
  if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
  const warnings = result.diagnostics ?? [];
  let content: JsonValue;
  if (READ_ONLY_KINDS.has(kind)) {
    const { kind: _kind, responseId: _responseId, ...response } = (result.response ?? {}) as Fields;
    content =
      kind === 'requestModel'
        ? compactModel(response.newRoot as PistarFile, metamodel)
        : (response as unknown as JsonValue);
  } else {
    content = { createdIds: [...result.createdIds] };
  }
  return {
    ok: true,
    content,
    createdIds: result.createdIds,
    ...(warnings.length > 0 ? { diagnostics: warnings } : {}),
  };
}

export interface ActionToolRegistryOptions {
  /** The kinds the tools describe (enums, link values). Default `ISTAR_2_0`. */
  readonly metamodel?: AnyMetamodel;
  /** Action kinds to leave out. Default: none. */
  readonly exclude?: readonly string[];
  /** Ids for creates that name none. Default: UUIDs. */
  readonly createId?: IdGenerator;
}

/** A backend-B registry: also turns a call into the action it dispatches. */
export interface ActionToolRegistry extends ToolRegistry {
  /**
   * The action a call of `name` dispatches, its create ids already pinned (`args.id`, a
   * dependency's `dependum.id`/`linkIds`, an n-ary's `legId`/`endId`), or a refusal.
   */
  toAction(name: string, args: JsonValue): IstarAction | Refusal;
}

/** Tools over `dispatcher`, one per handled operation and request, plus undo and redo. */
export function createActionToolRegistry<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
>(
  liveDispatcher: ActionDispatcher<EK, LK>,
  options: ActionToolRegistryOptions = {},
): ActionToolRegistry {
  const dispatcher = liveDispatcher as unknown as ActionDispatcher<string, string>;
  const metamodel = options.metamodel ?? (ISTAR_2_0 as unknown as AnyMetamodel);
  const createId = options.createId ?? defaultIdGenerator;
  const exclude = new Set(options.exclude ?? []);
  const info = kindInfo(metamodel);
  const kindByName = new Map<string, string>();
  const specs: ToolSpec[] = [];
  for (const kind of TOOL_KINDS) {
    if (exclude.has(kind)) continue;
    const name = actionToolName(kind);
    kindByName.set(name, kind);
    specs.push({
      name,
      ...toolFor(kind, info),
      ...(READ_ONLY_KINDS.has(kind) ? { readOnly: true } : {}),
    });
  }
  let requests = 0;

  const toAction: ActionToolRegistry['toAction'] = (name, args) => {
    const kind = kindByName.get(name);
    if (kind === undefined) return refusal(`unknown tool "${name}"`, 'unknown-tool');
    if (args !== null && !isFields(args)) {
      return refusal('the arguments must be a JSON object', 'invalid-arguments');
    }
    const fields = pinIds({ ...args }, kind, metamodel, createId);
    if (!READ_ONLY_KINDS.has(kind)) return { ...fields, kind } as unknown as IstarAction;
    const request: Fields = { ...fields, kind, requestId: `agent-${++requests}` };
    if (kind === 'requestMarkers') request.elementsIDs ??= [];
    if (kind === 'requestContextActions') {
      request.contextId ??= 'tool-palette';
      request.editorContext ??= { selectedElementIds: [] };
    }
    return request as unknown as IstarAction;
  };

  return {
    list: () => specs,
    toAction,
    prepare(name, args) {
      const kind = kindByName.get(name);
      if (kind === undefined || !isFields(args)) return args;
      return pinIds({ ...args }, kind, metamodel, createId) as JsonValue;
    },
    async call(name, args) {
      const action = toAction(name, args);
      if ('ok' in action) return action;
      try {
        return toToolResult(action.kind, await dispatcher.dispatch(action), metamodel);
      } catch (error) {
        return errorToToolResult(error);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Propose mode

export interface ActionChangeSetOptions<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
>
  extends
    Pick<ActionDispatcherOptions<EK, LK>, 'guards' | 'schemas' | 'palette' | 'diagnostics'>,
    Omit<ActionToolRegistryOptions, 'metamodel'> {
  /** Where the reviewed change set is applied, as one `compound`. */
  readonly dispatcher: ActionDispatcher<EK, LK>;
  /** The live model a dry run copies (e.g. `store.getModel`). */
  readonly getModel: () => AnyIstarModel;
}

/** A model identical to `model`, but a different object, for a dry run to edit freely. */
function copyOf(model: AnyIstarModel): AnyIstarModel {
  return parsePistar(toPistar(model), { metamodel: metamodelOf(model), fileMetamodel: true });
}

/**
 * The operations `entries` amount to, in order: the accepted operations, with the dry run's
 * undos and redos played out on them (an undo drops the last operation, a redo brings it back).
 */
function operationsOf(
  registry: ActionToolRegistry,
  entries: readonly ChangeSetEntry[],
): IstarOperation[] {
  const done: IstarOperation[] = [];
  const undone: IstarOperation[] = [];
  for (const entry of entries) {
    // A refused call changed nothing in the dry run; dropping it reproduces the dry run.
    if (!entry.result.ok) continue;
    const action = registry.toAction(entry.name, entry.args);
    if ('ok' in action) continue;
    if (action.kind === 'glspUndo') {
      const last = done.pop();
      if (last) undone.push(last);
    } else if (action.kind === 'glspRedo') {
      const next = undone.pop();
      if (next) done.push(next);
    } else if (!READ_ONLY_KINDS.has(action.kind)) {
      done.push(action as IstarOperation);
      undone.length = 0;
    }
  }
  return done;
}

/**
 * Propose mode over the dispatcher (the same pattern as the playground pseudo-agent's `dryRun`):
 * each run dry-runs against a scratch dispatcher, with the same guards and schemas, over
 * `parsePistar(toPistar(getModel()))`, never the live store; `apply` dispatches the reviewed
 * entries to `dispatcher` as one `compound` (one undo step, refused as a whole).
 */
export function createActionChangeSet<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
>(options: ActionChangeSetOptions<EK, LK>): ChangeSetTarget {
  const {
    dispatcher: live,
    getModel,
    guards: liveGuards,
    schemas,
    palette,
    diagnostics,
    ...tools
  } = options;
  const dispatcher = live as unknown as ActionDispatcher<string, string>;
  const guards = liveGuards as readonly ActionGuard<string, string>[] | undefined;
  const registryFor = (target: ActionDispatcher<string, string>, model: AnyIstarModel) =>
    createActionToolRegistry(target, {
      ...tools,
      metamodel: metamodelOf(model) as unknown as AnyMetamodel,
    });
  return {
    openScratch(): ScratchSession {
      const store = createModelStore(copyOf(getModel()) as IstarModel) as unknown as ModelStore<
        string,
        string
      >;
      const scratch = createActionDispatcher(store, {
        ...(guards ? { guards } : {}),
        ...(schemas ? { schemas } : {}),
        ...(palette ? { palette } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      });
      return { registry: registryFor(scratch, store.getModel()), close: () => scratch.dispose() };
    },
    async apply(entries) {
      const operationList = operationsOf(registryFor(dispatcher, getModel()), entries);
      if (operationList.length === 0)
        return { ok: true, content: { createdIds: [] }, createdIds: [] };
      const result = await dispatcher.dispatch({
        kind: 'compound',
        operationList: operationList as IstarOperation<string, string>[],
      });
      return toToolResult('compound', result, metamodelOf(getModel()) as unknown as AnyMetamodel);
    },
  };
}
