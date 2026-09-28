/**
 * The iStar 2.0 metamodel, ported from piStar's `tool/language/metamodel.js`.
 *
 * Kind names carry the `istar.` prefix exactly as they appear in piStar save files.
 */

export const ISTAR_PREFIX = 'istar';
export const METAMODEL_VERSION = '0.2';

/** Containers: elements that hold inner elements (piStar `metamodel.containers`). */
export const ACTOR_KINDS = ['istar.Actor', 'istar.Agent', 'istar.Role'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Intentional elements (piStar `metamodel.nodes`). */
export const NODE_KINDS = ['istar.Goal', 'istar.Quality', 'istar.Resource', 'istar.Task'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export type ElementKind = ActorKind | NodeKind;
export const ELEMENT_KINDS: readonly ElementKind[] = [...ACTOR_KINDS, ...NODE_KINDS];

/** Links between two containers (piStar `metamodel.containerLinks`). */
export const ACTOR_LINK_KINDS = ['istar.IsALink', 'istar.ParticipatesInLink'] as const;
export type ActorLinkKind = (typeof ACTOR_LINK_KINDS)[number];

/** Links that connect two containers through a dependum (piStar `metamodel.dependencyLinks`). */
export const DEPENDENCY_LINK_KINDS = ['istar.DependencyLink'] as const;
export type DependencyLinkKind = (typeof DEPENDENCY_LINK_KINDS)[number];

/** Links between two intentional elements (piStar `metamodel.nodeLinks`). */
export const NODE_LINK_KINDS = [
  'istar.AndRefinementLink',
  'istar.OrRefinementLink',
  'istar.NeededByLink',
  'istar.QualificationLink',
  'istar.ContributionLink',
] as const;
export type NodeLinkKind = (typeof NODE_LINK_KINDS)[number];

export type LinkKind = ActorLinkKind | DependencyLinkKind | NodeLinkKind;
export const LINK_KINDS: readonly LinkKind[] = [
  ...ACTOR_LINK_KINDS,
  ...DEPENDENCY_LINK_KINDS,
  ...NODE_LINK_KINDS,
];

/** Possible values of a Contribution link's `label`. */
export const CONTRIBUTION_LABELS = ['make', 'help', 'hurt', 'break'] as const;
export type ContributionLabel = (typeof CONTRIBUTION_LABELS)[number];

export interface NodeKindInfo {
  /** Can be added inside an actor. */
  readonly canBeInnerElement: boolean;
  /** Can be the dependum of a dependency. */
  readonly canBeDependum: boolean;
  /** Can be placed directly on the diagram, outside any actor. */
  readonly canBeOnPaper: boolean;
}

export interface LinkKindInfo {
  /** Fixed text drawn on the link (e.g. "is-a"). */
  readonly label?: string;
  /** piStar retries with source and target swapped when the first attempt is invalid. */
  readonly tryReversedWhenAdding?: boolean;
  /** The link carries a user-selectable label, stored as `label` in the save file. */
  readonly changeableLabel?: boolean;
  readonly possibleLabels?: readonly string[];
}

const innerNode: NodeKindInfo = {
  canBeInnerElement: true,
  canBeDependum: true,
  canBeOnPaper: false,
};

export const NODE_KIND_INFO: Readonly<Record<NodeKind, NodeKindInfo>> = {
  'istar.Goal': innerNode,
  'istar.Quality': innerNode,
  'istar.Resource': innerNode,
  'istar.Task': innerNode,
};

export const LINK_KIND_INFO: Readonly<Record<LinkKind, LinkKindInfo>> = {
  'istar.IsALink': { label: 'is-a' },
  'istar.ParticipatesInLink': { label: 'participates-in' },
  'istar.DependencyLink': {},
  'istar.AndRefinementLink': {},
  'istar.OrRefinementLink': {},
  'istar.NeededByLink': { tryReversedWhenAdding: true },
  'istar.QualificationLink': { tryReversedWhenAdding: true },
  'istar.ContributionLink': { changeableLabel: true, possibleLabels: CONTRIBUTION_LABELS },
};

export interface Size {
  width: number;
  height: number;
}

/**
 * Default sizes of each element kind, from piStar's `shapes.js`. For actors this is the
 * initial boundary size; the collapsed actor symbol is a circle of radius 40.
 */
export const DEFAULT_ELEMENT_SIZE: Readonly<Record<ElementKind, Size>> = {
  'istar.Actor': { width: 200, height: 120 },
  'istar.Agent': { width: 200, height: 120 },
  'istar.Role': { width: 200, height: 120 },
  'istar.Goal': { width: 90, height: 35 },
  'istar.Quality': { width: 90, height: 55 },
  'istar.Resource': { width: 90, height: 35 },
  'istar.Task': { width: 95, height: 36 },
};

const actorKinds: ReadonlySet<string> = new Set(ACTOR_KINDS);
const nodeKinds: ReadonlySet<string> = new Set(NODE_KINDS);
const elementKinds: ReadonlySet<string> = new Set(ELEMENT_KINDS);
const linkKinds: ReadonlySet<string> = new Set(LINK_KINDS);
const actorLinkKinds: ReadonlySet<string> = new Set(ACTOR_LINK_KINDS);
const nodeLinkKinds: ReadonlySet<string> = new Set(NODE_LINK_KINDS);

export function isActorKind(kind: string): kind is ActorKind {
  return actorKinds.has(kind);
}
export function isNodeKind(kind: string): kind is NodeKind {
  return nodeKinds.has(kind);
}
export function isElementKind(kind: string): kind is ElementKind {
  return elementKinds.has(kind);
}
export function isLinkKind(kind: string): kind is LinkKind {
  return linkKinds.has(kind);
}
export function isActorLinkKind(kind: string): kind is ActorLinkKind {
  return actorLinkKinds.has(kind);
}
export function isNodeLinkKind(kind: string): kind is NodeLinkKind {
  return nodeLinkKinds.has(kind);
}
export function isDependencyLinkKind(kind: string): kind is DependencyLinkKind {
  return kind === 'istar.DependencyLink';
}
export function isContributionLabel(value: string): value is ContributionLabel {
  return (CONTRIBUTION_LABELS as readonly string[]).includes(value);
}

/** `'istar.Goal'` → `'Goal'` */
export function shortKindName(kind: ElementKind | LinkKind): string {
  return kind.slice(ISTAR_PREFIX.length + 1);
}
