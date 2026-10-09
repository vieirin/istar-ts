import type { ActorKind, ElementKind, LinkKind, NodeKind } from './metamodel';
import type { AnyMetamodel, Metamodel } from './metamodels';
import { ISTAR_2_0, isActorKindIn } from './metamodels';

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

export const DEFAULT_DIAGRAM: Diagram = { width: 2000, height: 1300 };

/** A model of any dialect, for code that handles every kind generically. */
export type AnyIstarModel = IstarModel<string, string>;

/**
 * The metamodel of each model that isn't iStar 2.0. Kept beside the model rather than in it,
 * so a model's shape (and `JSON.stringify`, deep equality, snapshots) is the same as before
 * metamodels existed. Operations and the store carry it to every model they derive.
 */
const metamodels = new WeakMap<object, AnyMetamodel>();

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
const hostMetamodels = new WeakMap<object, AnyMetamodel>();

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
  const model: AnyIstarModel = {
    elements: new Map(),
    links: new Map(),
    diagram,
    tool: PISTAR_TOOL,
    istar: ISTAR_VERSION,
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

/** Links that have the element as source or target. */
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
