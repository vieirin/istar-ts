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

export type KaosElementKind = (typeof KAOS_ELEMENT_KINDS)[number];

/**
 * KAOS link kinds. `kaos.RefinementLink` is n-ary (DSM3's `sourceMultiplicity: -1`): core
 * generates its hub, leg and end kinds (`kaos.RefinementLinkHub`, `…Start`, `…End`).
 */
export const KAOS_LINK_KINDS: readonly [
  'kaos.RefinementLink',
  'kaos.ResponsibilityAssignment',
  'kaos.Conflict',
] = ['kaos.RefinementLink', 'kaos.ResponsibilityAssignment', 'kaos.Conflict'];

export type KaosLinkKind = (typeof KAOS_LINK_KINDS)[number];

/** The element kind core generates for the refinement's circle (DSM3 writes this type). */
export const KAOS_REFINEMENT_HUB = 'kaos.RefinementLinkHub' as const;
