import type { ActorKind, ElementKind, LinkKind, NodeKind, Size } from './metamodel';
import type { AnyMetamodel, Metamodel } from './metamodels';
import { ISTAR_2_0, isActorKindIn } from './metamodels';
import { sharedWeakMap } from './shared';

/**
 * piStar stores every custom property value as a string (e.g. `"initialValue": "false"`).
 * Typed access is layered on top with property schemas (see `properties.ts`).
 */
export type CustomProperties = Readonly<Record<string, string>>;

/** Arbitrary JSON keys the library does not interpret; kept so they survive a round trip. */
export type Extra = Readonly<Record<string, unknown>>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Per-element entry of the save file's `display` section. */
export interface ElementDisplay {
  readonly backgroundColor?: string;
  readonly width?: number;
  readonly height?: number;
  /** Actors only. */
  readonly collapsed?: boolean;
  readonly [key: string]: unknown;
}

/** Per-link entry of the save file's `display` section. */
export interface LinkDisplay {
  readonly vertices?: readonly Point[];
  readonly [key: string]: unknown;
}

/**
 * An element of the model. `K` is the kind union: iStar 2.0's by default, wider for models of an
 * extended metamodel (see `extendMetamodel`).
 */
export interface IstarElement<K extends string = ElementKind> {
  readonly id: string;
  readonly kind: K;
  /** The element's label; `text` in the save file. */
  readonly name: string;
  /** Absolute diagram coordinates, as in the save file (children are not relative to actors). */
  readonly x: number;
  readonly y: number;
  /** Id of the containing actor, for inner elements. */
  readonly parent?: string;
  /** True when the element is the dependum of a dependency (lives in `dependencies`). */
  readonly isDependum?: boolean;
  /**
   * Depender/dependee recorded in the save file for a dependum. The dependency links are the
   * source of truth; this is only a fallback used when those links are missing.
   */
  readonly dependency?: { readonly source: string; readonly target: string };
  readonly customProperties?: CustomProperties;
  readonly display?: ElementDisplay;
  readonly extra?: Extra;
}

export type IstarActor = IstarElement<ActorKind>;
export type IstarNode = IstarElement<NodeKind>;

export interface IstarLink<K extends string = LinkKind> {
  readonly id: string;
  readonly kind: K;
  readonly source: string;
  readonly target: string;
  /** Contribution value (`make`/`help`/`hurt`/`break`), stored as `label` in the save file. */
  readonly label?: string;
  readonly name?: string;
  readonly customProperties?: CustomProperties;
  readonly display?: LinkDisplay;
  readonly extra?: Extra;
}

export interface Diagram {
  readonly width?: number;
  readonly height?: number;
  readonly name?: string;
  readonly customProperties?: CustomProperties;
  readonly extra?: Extra;
}

/**
 * An immutable iStar model. Maps preserve insertion order, which is the order elements and
 * links are written back to disk.
 *
 * `EK`/`LK` are the element and link kind unions; they default to iStar 2.0's.
 */
export interface IstarModel<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly elements: ReadonlyMap<string, IstarElement<EK>>;
  readonly links: ReadonlyMap<string, IstarLink<LK>>;
  readonly diagram?: Diagram;
  readonly tool?: string;
  readonly istar?: string;
  readonly saveDate?: string;
  /** `display` entries whose id matches no element or link. */
  readonly extraDisplay?: Extra;
  /** Unknown top-level keys (e.g. `metamodelVersion`). */
  readonly extra?: Extra;
}

/** Tool identifier written by piStar 2.1.0, whose file format this library emulates. */
export const PISTAR_TOOL = 'pistar.2.1.0';
export const ISTAR_VERSION = '2.0';

/**
 * DSM3-goals' file conventions, shared by its languages (KAOS, NFR; see `@istar-ts/dsm3-kaos`
 * and `@istar-ts/dsm3-nfr`): the `tool` its editors write, and the order of their top-level keys
 * (`fileManager.js`). Use them as a root's `file.tool` and `file.keys`.
 */
export const DSM3_TOOL = 'dsm3-goals';
export const DSM3_FILE_KEYS: readonly string[] = [
  'actors',
  'orphans',
  'dependencies',
  'links',
  'display',
  'tool',
  'metamodelVersion',
  'saveDate',
  'diagram',
];

export const DEFAULT_DIAGRAM: Diagram = { width: 2000, height: 1300 };

/** A model of any dialect, for code that handles every kind generically. */
export type AnyIstarModel = IstarModel<string, string>;

/**
 * The metamodel of each model that isn't iStar 2.0. Kept beside the model rather than in it,
 * so a model's shape (and `JSON.stringify`, deep equality, snapshots) is the same as before
 * metamodels existed. Operations and the store carry it to every model they derive.
 */
const metamodels = sharedWeakMap<AnyMetamodel>('metamodels');

/**
 * Associates `metamodel` with `model` and returns the same model, typed for it. Use when a
 * model was built without the library's operations (e.g. with an object spread), which loses
 * the association.
 */
export function withMetamodel<EK extends string, LK extends string>(
  model: IstarModel<string, string>,
  metamodel: Metamodel<EK, LK>,
): IstarModel<EK, LK> {
  if ((metamodel as unknown) === ISTAR_2_0) metamodels.delete(model);
  else metamodels.set(model, metamodel as unknown as AnyMetamodel);
  return model as unknown as IstarModel<EK, LK>;
}

/**
 * For models whose file declares part of their metamodel (see `withFileMetamodel`): the
 * metamodel the host supplied, without the file's kinds.
 */
const hostMetamodels = sharedWeakMap<AnyMetamodel>('hostMetamodels');

/** @internal Records the host part of a model's metamodel (used by serialization). */
export function setHostMetamodel(model: object, metamodel: AnyMetamodel | undefined): void {
  if (metamodel) hostMetamodels.set(model, metamodel);
  else hostMetamodels.delete(model);
}

/** @internal The host part of a model's metamodel, if the file declares the rest. */
export function hostMetamodelOf(model: object): AnyMetamodel | undefined {
  return hostMetamodels.get(model);
}

/** Gives `to` the metamodel of `from` (used for every model an operation derives). */
export function inheritMetamodel<M extends IstarModel<string, string>>(
  from: IstarModel<string, string>,
  to: M,
): M {
  if (from === to) return to;
  const metamodel = metamodels.get(from);
  if (metamodel) metamodels.set(to, metamodel);
  const host = hostMetamodels.get(from);
  if (host) hostMetamodels.set(to, host);
  return to;
}

// The iStar 2.0 overload comes last: TypeScript resolves function references (e.g.
// `useIstarStore(createEmptyModel)`) against the last one, as before metamodels existed.
export function createEmptyModel<EK extends string, LK extends string>(
  diagram: Diagram | undefined,
  options: { metamodel: Metamodel<EK, LK> },
): IstarModel<EK, LK>;
export function createEmptyModel(diagram?: Diagram): IstarModel;
export function createEmptyModel(
  diagram: Diagram = DEFAULT_DIAGRAM,
  options: { metamodel?: AnyMetamodel } = {},
): AnyIstarModel {
  // The root metamodel's file hints say what a new file records: iStar 2.0 writes piStar's
  // `tool` and `istar: "2.0"`; other roots their own tool and top-level keys.
  const { file } = (options.metamodel ?? ISTAR_2_0) as AnyMetamodel;
  const model: AnyIstarModel = {
    elements: new Map(),
    links: new Map(),
    diagram,
    tool: file.tool ?? PISTAR_TOOL,
    ...(file.istar !== undefined ? { istar: file.istar } : {}),
    ...(file.extra !== undefined ? { extra: { ...file.extra } } : {}),
  };
  return options.metamodel ? withMetamodel(model, options.metamodel) : model;
}

/**
 * The metamodel a model was read or created with (see `parsePistar`, `createEmptyModel`), or
 * iStar 2.0. Constraints, operations and serialization use it unless given another one.
 */
export function metamodelOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
): Metamodel<EK, LK> {
  return (metamodels.get(model) ?? ISTAR_2_0) as unknown as Metamodel<EK, LK>;
}

/**
 * True for iStar 2.0 actors (Actor, Agent, Role). One argument, so it is safe as an array
 * callback (`elements.filter(isActor)`). For extended actor kinds use `isActorIn(metamodel)`.
 */
export function isActor(element: IstarElement<string> | undefined): element is IstarActor {
  return element !== undefined && isActorKindIn(ISTAR_2_0, element.kind);
}

/** True for iStar 2.0 intentional elements. For extended kinds use `isNodeIn(metamodel)`. */
export function isNode(element: IstarElement<string> | undefined): element is IstarNode {
  return element !== undefined && !isActorKindIn(ISTAR_2_0, element.kind);
}

/**
 * A predicate for actor-category elements of `metamodel`, extended actor kinds included:
 * `elements.filter(isActorIn(metamodelOf(model)))`.
 */
export function isActorIn(
  metamodel: AnyMetamodel,
): (element: IstarElement<string> | undefined) => boolean {
  return (element) => element !== undefined && isActorKindIn(metamodel, element.kind);
}

/** A predicate for node-category elements of `metamodel`, extended node kinds included. */
export function isNodeIn(
  metamodel: AnyMetamodel,
): (element: IstarElement<string> | undefined) => boolean {
  return (element) =>
    element !== undefined && metamodel.elements.get(element.kind)?.category === 'node';
}

/** Inner elements of an actor, in model order. */
export function childrenOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  actorId: string,
): IstarElement<EK>[] {
  const result: IstarElement<EK>[] = [];
  for (const element of model.elements.values()) {
    if (element.parent === actorId) result.push(element);
  }
  return result;
}

/**
 * Links that have the element as source or target. Given a link id, the links that target that
 * link (see `LinkRules`).
 */
export function linksOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  elementId: string,
): IstarLink<LK>[] {
  const result: IstarLink<LK>[] = [];
  for (const link of model.links.values()) {
    if (link.source === elementId || link.target === elementId) result.push(link);
  }
  return result;
}

/** For a dependum, the two halves of its dependency: depender → dependum → dependee. */
export function dependencyLinksOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  dependumId: string,
): { inbound?: IstarLink<LK>; outbound?: IstarLink<LK> } {
  const metamodel = metamodelOf(model) as AnyMetamodel;
  let inbound: IstarLink<LK> | undefined;
  let outbound: IstarLink<LK> | undefined;
  for (const link of model.links.values()) {
    if (metamodel.links.get(link.kind)?.category !== 'dependency') continue;
    if (link.target === dependumId && !inbound) inbound = link;
    if (link.source === dependumId && !outbound) outbound = link;
  }
  return { inbound, outbound };
}

/** What a link points at: an element, or a link for kinds whose rules target links. */
export function linkTargetOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  link: IstarLink<LK>,
): IstarElement<EK> | IstarLink<LK> | undefined {
  return model.elements.get(link.target) ?? model.links.get(link.target);
}

// ---------------------------------------------------------------------------------------------
// Hub links (n-ary link kinds, see `LinkKindDeclaration.arity`)

/** An n-ary link as it lives in a model: its hub element, its legs (in link order), its end. */
export interface HubLink<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly hub: IstarElement<EK>;
  readonly legs: readonly IstarLink<LK>[];
  /** Absent only in an incomplete model (`validateModel` reports it). */
  readonly end?: IstarLink<LK>;
}

/** True when `element` is the hub of an n-ary link. */
export function isHubElement(
  metamodel: AnyMetamodel,
  element: IstarElement<string> | undefined,
): boolean {
  return element !== undefined && metamodel.elements.get(element.kind)?.role === 'hub';
}

/** The n-ary link whose hub is `hubId`; `undefined` when it isn't a hub. */
export function hubLinkOf<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  hubId: string,
): HubLink<EK, LK> | undefined {
  const metamodel = metamodelOf(model) as AnyMetamodel;
  const hub = model.elements.get(hubId);
  if (!hub || !isHubElement(metamodel, hub)) return undefined;
  const legs: IstarLink<LK>[] = [];
  let end: IstarLink<LK> | undefined;
  for (const link of model.links.values()) {
    const role = metamodel.links.get(link.kind)?.role;
    if (role === 'leg' && link.target === hubId) legs.push(link);
    else if (role === 'end' && link.source === hubId) end ??= link;
  }
  return { hub, legs, ...(end ? { end } : {}) };
}

/** The hub a leg or end link belongs to. */
export function hubOfLink<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  linkId: string,
): IstarElement<EK> | undefined {
  const metamodel = metamodelOf(model) as AnyMetamodel;
  const link = model.links.get(linkId);
  const role = link && metamodel.links.get(link.kind)?.role;
  if (!link || !role) return undefined;
  const hub = model.elements.get(role === 'leg' ? link.target : link.source);
  return isHubElement(metamodel, hub) ? hub : undefined;
}

/** The centre of an element's box: its display size, else its kind's default size. */
export function elementCenter<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  element: IstarElement<EK>,
): Point {
  const size = (metamodelOf(model) as AnyMetamodel).elements.get(element.kind)?.size;
  const width = element.display?.width ?? size?.width ?? 0;
  const height = element.display?.height ?? size?.height ?? 0;
  return { x: element.x + width / 2, y: element.y + height / 2 };
}

/**
 * Where a new hub goes: centred between the source and the target, as DSM3-goals places it.
 * Returns its top-left corner for a hub of `size`.
 */
export function defaultHubPosition<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  source: IstarElement<EK>,
  target: IstarElement<EK>,
  size: Size,
): Point {
  const a = elementCenter(model, source);
  const b = elementCenter(model, target);
  return { x: (a.x + b.x) / 2 - size.width / 2, y: (a.y + b.y) / 2 - size.height / 2 };
}

export interface Box extends Point, Size {}

/** Space kept between inner elements and an actor's boundary (piStar's `updateBoundary` adds 10px). */
export const ACTOR_PADDING = 10;

/** A kind's default size, absent any per-host override (see `actorBounds`' `defaultSizeOf`). */
function metamodelSizeOf(metamodel: AnyMetamodel, kind: string): Size {
  return metamodel.elements.get(kind)?.size ?? { width: 0, height: 0 };
}

/**
 * An actor's boundary: the kind's default-size rectangle at the actor's position, grown to
 * include every inner element (each padded by `ACTOR_PADDING`), like piStar's `updateBoundary`
 * (which floors on the kind's default size, not the actor's last expanded `display` size; an
 * inner element's own `display` size does override, same as its rendered size elsewhere).
 * Shared by `@istar-ts/react`'s node layout and `@istar-ts/glsp`'s GModel, so an actor draws the
 * same box in both: children are looked up by category (`metamodelOf`), not `istar.*` names.
 *
 * `defaultSizeOf` resolves a kind's default size; it defaults to the metamodel's, but a host
 * whose registry overrides a kind's size independently of the metamodel (`@istar-ts/react`'s
 * `IstarRegistry`) must pass one that reads its own sizes, or its boundary would stop matching
 * what it actually draws.
 */
export function actorBounds<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  actorId: string,
  metamodel: Metamodel<EK, LK> = metamodelOf(model),
  defaultSizeOf: (kind: EK) => Size = (kind) =>
    metamodelSizeOf(metamodel as unknown as AnyMetamodel, kind),
): Box {
  const actor = model.elements.get(actorId);
  if (!actor) throw new Error(`no element "${actorId}" in the model`);
  const meta = metamodel as unknown as AnyMetamodel;
  const ownSize = defaultSizeOf(actor.kind);
  let minX = actor.x;
  let minY = actor.y;
  let maxX = actor.x + ownSize.width;
  let maxY = actor.y + ownSize.height;
  for (const child of model.elements.values()) {
    if (child.parent !== actorId) continue;
    if (meta.elements.get(child.kind)?.category === 'actor') continue;
    const base = defaultSizeOf(child.kind);
    const width = child.display?.width ?? base.width;
    const height = child.display?.height ?? base.height;
    minX = Math.min(minX, child.x - ACTOR_PADDING);
    minY = Math.min(minY, child.y - ACTOR_PADDING);
    maxX = Math.max(maxX, child.x + width + ACTOR_PADDING);
    maxY = Math.max(maxY, child.y + height + ACTOR_PADDING);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
