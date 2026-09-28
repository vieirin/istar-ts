import type { ActorKind, ElementKind, LinkKind, NodeKind } from './metamodel';
import { isActorKind } from './metamodel';

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

export interface IstarElement<K extends ElementKind = ElementKind> {
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

export interface IstarLink<K extends LinkKind = LinkKind> {
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
 */
export interface IstarModel {
  readonly elements: ReadonlyMap<string, IstarElement>;
  readonly links: ReadonlyMap<string, IstarLink>;
  readonly diagram?: Diagram;
  readonly tool?: string;
  readonly istar?: string;
  readonly saveDate?: string;
  /** `display` entries whose id matches no element or link. */
  readonly extraDisplay?: Extra;
  /** Unknown top-level keys (e.g. `metamodelVersion`). */
  readonly extra?: Extra;
}

export const DEFAULT_DIAGRAM: Diagram = { width: 2000, height: 1300 };

export function createEmptyModel(diagram: Diagram = DEFAULT_DIAGRAM): IstarModel {
  return { elements: new Map(), links: new Map(), diagram };
}

export function isActor(element: IstarElement | undefined): element is IstarActor {
  return element !== undefined && isActorKind(element.kind);
}

export function isNode(element: IstarElement | undefined): element is IstarNode {
  return element !== undefined && !isActorKind(element.kind);
}

/** Inner elements of an actor, in model order. */
export function childrenOf(model: IstarModel, actorId: string): IstarElement[] {
  const result: IstarElement[] = [];
  for (const element of model.elements.values()) {
    if (element.parent === actorId) result.push(element);
  }
  return result;
}

/** Links that have the element as source or target. */
export function linksOf(model: IstarModel, elementId: string): IstarLink[] {
  const result: IstarLink[] = [];
  for (const link of model.links.values()) {
    if (link.source === elementId || link.target === elementId) result.push(link);
  }
  return result;
}

/** For a dependum, the two halves of its dependency: depender → dependum → dependee. */
export function dependencyLinksOf(
  model: IstarModel,
  dependumId: string,
): { inbound?: IstarLink; outbound?: IstarLink } {
  let inbound: IstarLink | undefined;
  let outbound: IstarLink | undefined;
  for (const link of model.links.values()) {
    if (link.kind !== 'istar.DependencyLink') continue;
    if (link.target === dependumId && !inbound) inbound = link;
    if (link.source === dependumId && !outbound) outbound = link;
  }
  return { inbound, outbound };
}
