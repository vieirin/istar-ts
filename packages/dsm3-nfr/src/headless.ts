/**
 * `@istar-ts/dsm3-nfr/metamodel`: the NFR metamodel, kinds and contribution labels without
 * `@istar-ts/react`. Built for `import` and `require`, like `@istar-ts/core`, so CommonJS tools
 * (mocha + ts-node, Node scripts) can load it; the package root stays ESM-only because its
 * extension needs React.
 */
export { NFR, NFR_DECLARATION, notNfrToOperationalization } from './metamodel';
export { NFR_CONTRIBUTION_LABELS, NFR_ELEMENT_KINDS, NFR_LINK_KINDS } from './kinds';
export type { NfrContributionLabel, NfrElementKind, NfrLinkKind } from './kinds';
