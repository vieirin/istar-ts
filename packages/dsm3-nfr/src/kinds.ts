/**
 * NFR Framework kind names, as DSM3-goals' `language_nfr_metamodel.js` declares them under the
 * `nfr` prefix. The metamodel (`metamodel.ts`) declares exactly these kinds; the shapes and
 * registry parts are typed with them.
 */

/** NFR node kinds. The NFR Framework has no containers: every node lies on the paper. */
export const NFR_ELEMENT_KINDS: readonly ['nfr.NFR', 'nfr.Operationalization', 'nfr.Claim'] = [
  'nfr.NFR',
  'nfr.Operationalization',
  'nfr.Claim',
];

export type NfrElementKind = (typeof NFR_ELEMENT_KINDS)[number];

/** NFR link kinds. `nfr.ArgumentLink` goes from a Claim to another link. */
export const NFR_LINK_KINDS: readonly [
  'nfr.AndRefinementLink',
  'nfr.OrRefinementLink',
  'nfr.ContributionLink',
  'nfr.CorrelationLink',
  'nfr.ArgumentLink',
] = [
  'nfr.AndRefinementLink',
  'nfr.OrRefinementLink',
  'nfr.ContributionLink',
  'nfr.CorrelationLink',
  'nfr.ArgumentLink',
];

export type NfrLinkKind = (typeof NFR_LINK_KINDS)[number];

/**
 * The labels of Contribution and Correlation links, as DSM3 writes them: `–` is U+2013 EN DASH,
 * not a hyphen.
 */
export const NFR_CONTRIBUTION_LABELS: readonly [
  '++',
  '+',
  'some+',
  'some-',
  '–',
  '– –',
  'unknown',
] = ['++', '+', 'some+', 'some-', '–', '– –', 'unknown'];

export type NfrContributionLabel = (typeof NFR_CONTRIBUTION_LABELS)[number];
