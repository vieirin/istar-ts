/**
 * The action vocabulary: a subset of GLSP's action protocol
 * (https://eclipse.dev/glsp/documentation/protocol/), with GLSP's interface names and `kind`
 * strings where the concept is the same, and iStar extras under `istar.*`.
 *
 * Every action is plain JSON (no Maps, functions or class instances), so a dispatcher can sit
 * on the other side of a `postMessage` or a socket. Requests carry `requestId`; their response
 * carries it back as `responseId`, as in GLSP.
 *
 * Where a shape differs from GLSP's: `args` of the create operations are structured (a name,
 * custom properties, ids) rather than GLSP's flat `Args`; `newSize` of `ElementAndBounds` is
 * optional; `ChangeContainerOperation.targetContainerId` is `null` to take an element out of
 * its actor; `SetModelAction.newRoot` is the piStar file, not a GModel; operations need not
 * carry GLSP's `isOperation: true` (the dispatcher knows them by `kind`).
 */
import type {
  CustomProperties,
  DiagnosticSeverity,
  ElementKind,
  LinkKind,
  ModelChange,
  PistarFile,
} from '@istar-ts/core';

/** GLSP's custom arguments: a flat map of primitives. */
export type Args = Readonly<Record<string, string | number | boolean>>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Dimension {
  readonly width: number;
  readonly height: number;
}

export interface Action {
  readonly kind: string;
}

export interface RequestAction extends Action {
  readonly requestId: string;
  /** Milliseconds the sender is willing to wait (GLSP); the in-process dispatcher ignores it. */
  readonly timeout?: number;
}

export interface ResponseAction extends Action {
  /** The `requestId` of the request this answers. */
  readonly responseId: string;
}

/** An action that edits the model, as one undo step. */
export interface Operation extends Action {
  /** GLSP's operation marker. Optional here: the dispatcher knows operations by `kind`. */
  readonly isOperation?: true;
}

// ---------------------------------------------------------------------------------------------
// Operations (GLSP)

export interface CreateNodeArgs {
  /** Default: the kind's label ("Goal"), as in piStar. */
  readonly name?: string;
  readonly customProperties?: CustomProperties;
  /** The new element's id. Default: a fresh UUID. Lets a compound operation refer to it. */
  readonly id?: string;
}

export interface CreateNodeOperation<EK extends string = ElementKind> extends Operation {
  readonly kind: 'createNode';
  /** The element kind, e.g. `istar.Goal`. */
  readonly elementTypeId: EK;
  /** Default: the container's position, or the origin. */
  readonly location?: Point;
  /** The actor to create the element in. */
  readonly containerId?: string;
  readonly args?: CreateNodeArgs;
}

/** The dependum a dependency creates between its depender and dependee. */
export interface DependumArgs<EK extends string = ElementKind> {
  /** Default: the metamodel's first node kind that can be a dependum. */
  readonly kind?: EK;
  readonly name?: string;
  readonly id?: string;
  /** Default: midway between depender and dependee, as in piStar. */
  readonly location?: Point;
  readonly customProperties?: CustomProperties;
}

export interface CreateEdgeArgs<EK extends string = ElementKind> {
  /** A contribution's value (the link's `label`), e.g. `help`. */
  readonly value?: string;
  readonly name?: string;
  readonly customProperties?: CustomProperties;
  /** The new link's id (for an n-ary kind: the new hub's). Default: a fresh UUID. */
  readonly id?: string;
  /** For a dependency kind: the dependum to create. */
  readonly dependum?: DependumArgs<EK>;
  /** For a dependency kind: the ids of its two links. */
  readonly linkIds?: readonly [string, string];
}

/**
 * Adds a link. With a dependency kind, adds the dependum and its two links (as `addDependency`
 * does), source being the depender and target the dependee. With an n-ary kind, adds a leg when
 * the target is one of the kind's hubs, else a new hub with a leg and an end.
 */
export interface CreateEdgeOperation<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends Operation {
  readonly kind: 'createEdge';
  /** The link kind, e.g. `istar.ContributionLink`. */
  readonly elementTypeId: LK;
  readonly sourceElementId: string;
  readonly targetElementId: string;
  readonly args?: CreateEdgeArgs<EK>;
}

/** Removes elements and links, with everything that depends on them (as the store does). */
export interface DeleteElementOperation extends Operation {
  readonly kind: 'deleteElement';
  /** Element and link ids. */
  readonly elementIds: readonly string[];
}

export interface ElementAndBounds {
  readonly elementId: string;
  /** Moving an actor moves its inner elements with it. */
  readonly newPosition?: Point;
  /** Written to the element's `display` (`width`, `height`). */
  readonly newSize?: Dimension;
}

export interface ChangeBoundsOperation extends Operation {
  readonly kind: 'changeBounds';
  readonly newBounds: readonly ElementAndBounds[];
}

/** Moves an inner element into another actor, or out of any actor with `null` (`nestElement`). */
export interface ChangeContainerOperation extends Operation {
  readonly kind: 'changeContainer';
  readonly elementId: string;
  readonly targetContainerId: string | null;
  /** The element's new position, if it moves too. */
  readonly location?: Point;
}

/**
 * Gives a link new ends, keeping its id, kind and properties. A dependency's link keeps its
 * dependum end; an n-ary link's leg keeps its hub (or moves to another hub of the kind), its end
 * keeps the hub.
 */
export interface ReconnectEdgeOperation extends Operation {
  readonly kind: 'reconnectEdge';
  readonly edgeElementId: string;
  readonly sourceElementId: string;
  readonly targetElementId: string;
  readonly args?: Args;
}

/**
 * Sets an element's or link's name (`labelId` = its id), or one of its custom properties
 * (`labelId` = `"<id>#<key>"`). An element's name is written as-is (`text`, including `""`, as
 * piStar always keeps the key); a link's name is removed from the file when `text` is `""`, as
 * piStar does for a link whose name was cleared (`fileManager.js` only writes `name` when it is
 * truthy).
 */
export interface ApplyLabelEditOperation extends Operation {
  readonly kind: 'applyLabelEdit';
  readonly labelId: string;
  readonly text: string;
}

/** Applies its operations in order, as one undo step; if one is rejected, none is applied. */
export interface CompoundOperation<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends Operation {
  readonly kind: 'compound';
  readonly operationList: readonly IstarOperation<EK, LK>[];
}

// ---------------------------------------------------------------------------------------------
// Operations (iStar)

/** Adds a leg from `sourceElementId` to the hub of an n-ary link (`store.addLeg`). */
export interface AddLegOperation extends Operation {
  readonly kind: 'istar.addLeg';
  readonly hubId: string;
  readonly sourceElementId: string;
  readonly args?: { readonly id?: string };
}

/** Removes a leg of an n-ary link; the last one takes the hub and end with it. */
export interface RemoveLegOperation extends Operation {
  readonly kind: 'istar.removeLeg';
  readonly legId: string;
}

export interface SetCollapsedOperation extends Operation {
  readonly kind: 'istar.setCollapsed';
  /** An actor. */
  readonly elementId: string;
  readonly collapsed: boolean;
}

export interface DiagramPatch {
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  /** Replaces the diagram's custom properties. */
  readonly customProperties?: CustomProperties;
}

export interface UpdateDiagramOperation extends Operation {
  readonly kind: 'istar.updateDiagram';
  readonly diagram: DiagramPatch;
}

/**
 * Sets custom properties of an element or link: each key is set to its value, or removed when
 * the value is `null`; other keys are kept. Values are strings, as piStar stores them.
 */
export interface UpdatePropertiesOperation extends Operation {
  readonly kind: 'istar.updateProperties';
  /** An element or link id. */
  readonly elementId: string;
  readonly properties: Readonly<Record<string, string | null>>;
}

/**
 * Merges into an element's `display` (colour, the auto-grown height from a label fit): a key set
 * to `undefined` is removed, the rest is written as-is. Same semantics as `ElementPatch.display`
 * (`@istar-ts/core`), which this forwards to.
 */
export interface UpdateDisplayOperation extends Operation {
  readonly kind: 'istar.updateDisplay';
  readonly elementId: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * Sets an existing link's contribution value (`label` in the save file), e.g. a Contribution
 * link's make/help/hurt/break. `null` clears it. Rejected when the link's kind has no
 * `possibleLabels`, or `value` is not one of them (as `createEdge.args.value` is checked at
 * creation).
 */
export interface SetLinkValueOperation extends Operation {
  readonly kind: 'istar.setLinkValue';
  readonly linkId: string;
  readonly value: string | null;
}

/** Every operation, keyed by `kind`. */
export type IstarOperation<EK extends string = ElementKind, LK extends string = LinkKind> =
  | CreateNodeOperation<EK>
  | CreateEdgeOperation<EK, LK>
  | DeleteElementOperation
  | ChangeBoundsOperation
  | ChangeContainerOperation
  | ReconnectEdgeOperation
  | ApplyLabelEditOperation
  | CompoundOperation<EK, LK>
  | AddLegOperation
  | RemoveLegOperation
  | SetCollapsedOperation
  | UpdateDiagramOperation
  | UpdatePropertiesOperation
  | UpdateDisplayOperation
  | SetLinkValueOperation;

// ---------------------------------------------------------------------------------------------
// Model

export interface RequestModelAction extends RequestAction {
  readonly kind: 'requestModel';
  readonly options?: Args;
}

export interface SetModelAction extends ResponseAction {
  readonly kind: 'setModel';
  /** The model as a piStar save file (`toPistarObject`). */
  readonly newRoot: PistarFile;
}

/**
 * The model changed: sent to subscribers after every edit, undo, redo or load, whoever caused
 * it. `source` and `changes` are iStar extras (the store's `ModelChangeEvent`).
 */
export interface ModelSourceChangedAction extends Action {
  readonly kind: 'sourceModelChanged';
  /** The dispatcher's `sourceModelName` option. */
  readonly sourceModelName: string;
  readonly source: 'edit' | 'undo' | 'redo' | 'load';
  /** What an edit did; empty for undo, redo and load. */
  readonly changes: readonly ModelChange[];
}

/** Saves the model through the host's `save` callback. */
export interface SaveModelAction extends Action {
  readonly kind: 'saveModel';
  readonly fileUri?: string;
}

export type DirtyStateChangeReason = 'operation' | 'undo' | 'redo' | 'save' | 'external';

/** Sent to subscribers when the model starts or stops differing from the last saved one. */
export interface SetDirtyStateAction extends Action {
  readonly kind: 'setDirtyState';
  readonly isDirty: boolean;
  readonly reason?: DirtyStateChangeReason;
}

export interface UndoAction extends Action {
  readonly kind: 'glspUndo';
}

export interface RedoAction extends Action {
  readonly kind: 'glspRedo';
}

// ---------------------------------------------------------------------------------------------
// Type hints and edge checks

export interface TypeHint {
  readonly elementTypeId: string;
  readonly repositionable: boolean;
  readonly deletable: boolean;
}

export interface ShapeTypeHint extends TypeHint {
  readonly resizable: boolean;
  /** Can move into or out of an actor. */
  readonly reparentable: boolean;
  /** For an actor: the node kinds it can contain. */
  readonly containableElementTypeIds?: readonly string[];
}

export interface EdgeTypeHint extends TypeHint {
  readonly routable: boolean;
  /** Element kinds that may be the source; absent when any may. */
  readonly sourceElementTypeIds?: readonly string[];
  /** Element kinds that may be the target; absent when any may. */
  readonly targetElementTypeIds?: readonly string[];
  /** Always true for iStar: kinds alone don't decide (same actor, uniqueness…); ask `requestCheckEdge`. */
  readonly dynamic?: boolean;
}

export interface RequestTypeHintsAction extends RequestAction {
  readonly kind: 'requestTypeHints';
}

export interface SetTypeHintsAction extends ResponseAction {
  readonly kind: 'setTypeHints';
  readonly shapeHints: readonly ShapeTypeHint[];
  readonly edgeHints: readonly EdgeTypeHint[];
}

/** Would a link of `edgeType` from source to target be accepted (`canLink`)? */
export interface RequestCheckEdgeAction extends RequestAction {
  readonly kind: 'requestCheckEdge';
  readonly edgeType: string;
  readonly sourceElementId: string;
  /** Absent: is the source an acceptable source at all? */
  readonly targetElementId?: string;
}

export interface CheckEdgeResultAction extends ResponseAction {
  readonly kind: 'checkEdgeTargetResult';
  readonly isValid: boolean;
  readonly edgeType: string;
  readonly sourceElementId: string;
  readonly targetElementId?: string;
  /** iStar extra: why not, when `isValid` is false. */
  readonly reason?: string;
  /** iStar extra: the constraint that failed (`ConstraintCode`). */
  readonly code?: string;
}

// ---------------------------------------------------------------------------------------------
// Context actions (the palette)

export interface EditorContext {
  readonly selectedElementIds: readonly string[];
  /** Where the user is about to create something, in model coordinates. */
  readonly lastMousePosition?: Point;
  readonly args?: Args;
}

/** GLSP's context ids. The dispatcher answers every context with the palette. */
export type ContextId = 'tool-palette' | 'context-menu' | 'command-palette' | (string & {});

export interface RequestContextActions extends RequestAction {
  readonly kind: 'requestContextActions';
  readonly contextId: ContextId;
  readonly editorContext: EditorContext;
}

/** One palette entry: the trigger action(s) a click sends, with the palette's data. */
export interface LabeledAction {
  readonly label: string;
  readonly actions: readonly IstarAction[];
  readonly icon?: string;
  /** iStar extras, from the `PaletteDescription` entry. */
  readonly id?: string;
  readonly group?: string;
  readonly section?: string;
  readonly order?: number;
}

export interface SetContextActions extends ResponseAction {
  readonly kind: 'setContextActions';
  /** Sorted by `order`. */
  readonly actions: readonly LabeledAction[];
  /** iStar extra: labels of the entries' `group`s (the palette's dropdown buttons). */
  readonly groups?: Readonly<Record<string, { readonly label: string }>>;
  readonly args?: Args;
}

/** Arms the client's node creation tool; the client then sends a `CreateNodeOperation`. */
export interface TriggerNodeCreationAction extends Action {
  readonly kind: 'triggerNodeCreation';
  readonly elementTypeId: string;
  /** Presets for the operation's `args`. */
  readonly args?: { readonly customProperties?: CustomProperties };
}

/** Arms the client's edge creation tool; the client then sends a `CreateEdgeOperation`. */
export interface TriggerEdgeCreationAction extends Action {
  readonly kind: 'triggerEdgeCreation';
  readonly elementTypeId: string;
  /** Presets for the operation's `args`: a contribution's value, a dependency's dependum kind. */
  readonly args?: { readonly value?: string; readonly dependum?: { readonly kind: string } };
}

// ---------------------------------------------------------------------------------------------
// Markers

/** GLSP's validation marker; `kind` is a `DiagnosticSeverity`. */
export interface Marker {
  /** Short text (the diagnostic's message). */
  readonly label: string;
  /** Full text (the message, with its source when it has one). */
  readonly description: string;
  readonly elementId: string;
  readonly kind: DiagnosticSeverity | (string & {});
  /** iStar extras, kept so a marker converts back to the same `GoalDiagnostic`. */
  readonly key?: string;
  readonly source?: string;
  readonly code?: string;
}

/**
 * Markers of the model: link constraint violations (`validateModel`), property issues (the
 * dispatcher's `schemas`) and the host's `diagnostics`.
 */
export interface RequestMarkersAction extends RequestAction {
  readonly kind: 'requestMarkers';
  /**
   * Elements to report on (GLSP's spelling). Empty, or naming no element or link of the model
   * (a GLSP client sends its root's id), means the whole model.
   */
  readonly elementsIDs: readonly string[];
  readonly reason?: string;
}

export interface SetMarkersAction extends ResponseAction {
  readonly kind: 'setMarkers';
  readonly markers: readonly Marker[];
  readonly reason?: string;
}

export interface DeleteMarkersAction extends Action {
  readonly kind: 'deleteMarkers';
  readonly markers: readonly Marker[];
}

// ---------------------------------------------------------------------------------------------
// Unions

export type IstarRequestAction =
  | RequestModelAction
  | RequestTypeHintsAction
  | RequestCheckEdgeAction
  | RequestContextActions
  | RequestMarkersAction;

export type IstarResponseAction =
  | SetModelAction
  | SetTypeHintsAction
  | CheckEdgeResultAction
  | SetContextActions
  | SetMarkersAction;

/**
 * Actions the dispatcher does not act on: it passes them to its subscribers (a server telling
 * its clients), and sends the first two itself.
 */
export type IstarNotificationAction =
  | ModelSourceChangedAction
  | SetDirtyStateAction
  | TriggerNodeCreationAction
  | TriggerEdgeCreationAction
  | DeleteMarkersAction;

/** Every action of the protocol, keyed by `kind`. */
export type IstarAction<EK extends string = ElementKind, LK extends string = LinkKind> =
  | IstarOperation<EK, LK>
  | UndoAction
  | RedoAction
  | SaveModelAction
  | IstarRequestAction
  | IstarResponseAction
  | IstarNotificationAction;

const OPERATION_KINDS: ReadonlySet<string> = new Set<IstarOperation['kind']>([
  'createNode',
  'createEdge',
  'deleteElement',
  'changeBounds',
  'changeContainer',
  'reconnectEdge',
  'applyLabelEdit',
  'compound',
  'istar.addLeg',
  'istar.removeLeg',
  'istar.setCollapsed',
  'istar.updateDiagram',
  'istar.updateProperties',
  'istar.updateDisplay',
  'istar.setLinkValue',
]);

const REQUEST_KINDS: ReadonlySet<string> = new Set<IstarRequestAction['kind']>([
  'requestModel',
  'requestTypeHints',
  'requestCheckEdge',
  'requestContextActions',
  'requestMarkers',
]);

/** True for the operations (actions that edit the model). */
export function isOperation<EK extends string, LK extends string>(
  action: IstarAction<EK, LK>,
): action is IstarOperation<EK, LK> {
  return OPERATION_KINDS.has(action.kind);
}

/** True for the requests (actions answered with a response action). */
export function isRequestAction(action: Action): action is IstarRequestAction {
  return REQUEST_KINDS.has(action.kind);
}
