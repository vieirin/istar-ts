/**
 * `@istar-ts/dsm3-kaos/metamodel`: the KAOS metamodel, kinds and property schemas without
 * `@istar-ts/react`. Built for `import` and `require`, like `@istar-ts/core`, so CommonJS tools
 * (mocha + ts-node, Node scripts) can load it; the package root stays ESM-only because its
 * extension needs React.
 */
export { KAOS, KAOS_DECLARATION } from './metamodel';
export {
  KAOS_ELEMENT_KINDS,
  KAOS_FILL,
  KAOS_LINK_KINDS,
  KAOS_OBSTACLE_ELEMENT_KINDS,
  KAOS_OBSTACLE_LINK_KINDS,
  KAOS_OBSTACLE_REFINEMENT_HUB,
  KAOS_REFINEMENT_HUB,
} from './kinds';
export { KAOS_OBSTACLES, kaosObstacleAnalysis } from './obstacles';
export type {
  KaosDeclaredElementKind,
  KaosDeclaredLinkKind,
  KaosElementKind,
  KaosLinkKind,
  KaosObstacleDeclaredElementKind,
  KaosObstacleDeclaredLinkKind,
  KaosObstacleElementKind,
  KaosObstacleLinkKind,
} from './kinds';
export {
  KAOS_OBSTACLE_PROPERTY_SCHEMAS,
  KAOS_PROPERTY_SCHEMAS,
  behavioralGoalProperties,
  conflictProperties,
  domainPropertyProperties,
  obstacleProperties,
  refinementProperties,
  resolutionProperties,
  softgoalProperties,
} from './properties';
export type {
  KaosConflictProperties,
  KaosDomainPropertyProperties,
  KaosGoalProperties,
  KaosObstacleProperties,
  KaosRefinementProperties,
  KaosResolutionProperties,
} from './properties';
