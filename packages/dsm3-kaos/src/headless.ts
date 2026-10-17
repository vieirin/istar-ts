/**
 * `@istar-ts/dsm3-kaos/metamodel`: the KAOS metamodel, kinds and property schemas without
 * `@istar-ts/react`. Built for `import` and `require`, like `@istar-ts/core`, so CommonJS tools
 * (mocha + ts-node, Node scripts) can load it; the package root stays ESM-only because its
 * extension needs React.
 */
export { KAOS, KAOS_DECLARATION } from './metamodel';
export { KAOS_ELEMENT_KINDS, KAOS_LINK_KINDS, KAOS_REFINEMENT_HUB } from './kinds';
export type {
  KaosDeclaredElementKind,
  KaosDeclaredLinkKind,
  KaosElementKind,
  KaosLinkKind,
} from './kinds';
export {
  KAOS_PROPERTY_SCHEMAS,
  behavioralGoalProperties,
  conflictProperties,
  refinementProperties,
  softgoalProperties,
} from './properties';
export type {
  KaosConflictProperties,
  KaosGoalProperties,
  KaosRefinementProperties,
} from './properties';
