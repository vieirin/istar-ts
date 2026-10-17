/**
 * KAOS kind names, as DSM3-goals' `language_kaos_metamodel.js` declares them under the `kaos`
 * prefix. The metamodel (`metamodel.ts`) declares exactly these kinds; the shapes, schemas and
 * registry parts are typed with them.
 */

/** KAOS node kinds. KAOS has no containers: every node lies on the paper. */
export const KAOS_ELEMENT_KINDS: readonly [
  'kaos.BehavioralGoal',
  'kaos.Softgoal',
  'kaos.Agent',
  'kaos.EnvironmentAgent',
  'kaos.DomainProperty',
] = [
  'kaos.BehavioralGoal',
  'kaos.Softgoal',
  'kaos.Agent',
  'kaos.EnvironmentAgent',
  'kaos.DomainProperty',
];

/** The element kinds declared in KAOS. */
export type KaosDeclaredElementKind = (typeof KAOS_ELEMENT_KINDS)[number];

/** KAOS's element kinds, with the hub its n-ary refinement generates. */
export type KaosElementKind = KaosDeclaredElementKind | 'kaos.RefinementLinkHub';

/**
 * KAOS link kinds. `kaos.RefinementLink` is n-ary (DSM3's `sourceMultiplicity: -1`): core
 * generates its hub, leg and end kinds (`kaos.RefinementLinkHub`, `…Start`, `…End`).
 */
export const KAOS_LINK_KINDS: readonly [
  'kaos.RefinementLink',
  'kaos.ResponsibilityAssignment',
  'kaos.Conflict',
] = ['kaos.RefinementLink', 'kaos.ResponsibilityAssignment', 'kaos.Conflict'];

/** The link kinds declared in KAOS. */
export type KaosDeclaredLinkKind = (typeof KAOS_LINK_KINDS)[number];

/** KAOS's link kinds, with the leg and end kinds its n-ary refinement generates. */
export type KaosLinkKind =
  | KaosDeclaredLinkKind
  | 'kaos.RefinementLinkStart'
  | 'kaos.RefinementLinkEnd';

/** The element kind core generates for the refinement's circle (DSM3 writes this type). */
export const KAOS_REFINEMENT_HUB = 'kaos.RefinementLinkHub' as const;

/** DSM3 fills every KAOS node grey (`rgb(205,205,205)`, language_kaos_shapes.js): `KindShape.fill`. */
export const KAOS_FILL = 'rgb(205,205,205)';

/**
 * Obstacle analysis (van Lamsweerde & Letier, TSE 2000) on the KAOS root, as the
 * `kaosObstacleAnalysis` extension declares it. Not DSM3's: DSM3-goals' KAOS has no obstacles.
 * The root reserves the `kaos.` prefix, so the kinds live under `kaosObstacles.` and are saved
 * as `kaos.*` types (`pistarType`), e.g. `kaos.Obstacle`.
 */
export const KAOS_OBSTACLE_ELEMENT_KINDS: readonly ['kaosObstacles.Obstacle'] = [
  'kaosObstacles.Obstacle',
];

/** The element kinds declared by the obstacle analysis. */
export type KaosObstacleDeclaredElementKind = (typeof KAOS_OBSTACLE_ELEMENT_KINDS)[number];

/** The obstacle analysis's element kinds, with the hub its n-ary obstacle refinement generates. */
export type KaosObstacleElementKind =
  | KaosObstacleDeclaredElementKind
  | 'kaosObstacles.ObstacleRefinementLinkHub';

/**
 * Obstacle analysis link kinds. `kaosObstacles.ObstacleRefinementLink` is n-ary like the goal
 * refinement: sub-obstacles join at a hub (AND), and several hubs on one obstacle are an OR.
 */
export const KAOS_OBSTACLE_LINK_KINDS: readonly [
  'kaosObstacles.ObstacleRefinementLink',
  'kaosObstacles.ObstructionLink',
  'kaosObstacles.ResolutionLink',
] = [
  'kaosObstacles.ObstacleRefinementLink',
  'kaosObstacles.ObstructionLink',
  'kaosObstacles.ResolutionLink',
];

/** The link kinds declared by the obstacle analysis. */
export type KaosObstacleDeclaredLinkKind = (typeof KAOS_OBSTACLE_LINK_KINDS)[number];

/** The obstacle analysis's link kinds, with the leg and end kinds its refinement generates. */
export type KaosObstacleLinkKind =
  | KaosObstacleDeclaredLinkKind
  | 'kaosObstacles.ObstacleRefinementLinkStart'
  | 'kaosObstacles.ObstacleRefinementLinkEnd';

/** The hub kind of an obstacle refinement (saved as `kaos.ObstacleRefinementLinkHub`). */
export const KAOS_OBSTACLE_REFINEMENT_HUB = 'kaosObstacles.ObstacleRefinementLinkHub' as const;
