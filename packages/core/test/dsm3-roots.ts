/**
 * Minimal DSM3-goals roots for core's tests: the kinds and rules of its KAOS and NFR languages
 * (`language_{kaos,nfr}_metamodel.js` and `_constraints.js`), with file hints and no shapes.
 * The full languages ship as `@istar-ts/dsm3-kaos` and `@istar-ts/dsm3-nfr`.
 */
import type { LinkCheck, LinkRuleContext } from '../src';
import { DSM3_FILE_KEYS, DSM3_TOOL, defineMetamodel, isLinkRef } from '../src';

const DSM3_FILE = { tool: DSM3_TOOL, extra: { metamodelVersion: '1.0' }, keys: DSM3_FILE_KEYS };

/** NFR's contribution and correlation labels; `–` is U+2013, as in DSM3-goals. */
export const NFR_CONTRIBUTION_LABELS: readonly string[] = [
  '++',
  '+',
  'some+',
  'some-',
  '–',
  '– –',
  'unknown',
];

const NFR_TO_OPERATIONALIZATION: Readonly<Record<string, string>> = {
  'nfr.AndRefinementLink': 'you cannot refine an Operationalization with a NFR',
  'nfr.OrRefinementLink': 'you cannot refine an Operationalization with a NFR',
  'nfr.ContributionLink': 'you cannot have a NFR contributing to an Operationalization',
  'nfr.CorrelationLink': 'you cannot have an Operationalization as the target of a Correlation',
};

/** DSM3-goals' `source.isNFR() && target.isOperationalization()` branch, per link kind. */
function notNfrToOperationalization({ kind, source, target }: LinkRuleContext): LinkCheck {
  if (source.kind === 'nfr.NFR' && !isLinkRef(target) && target.kind === 'nfr.Operationalization') {
    return { ok: false, code: 'invalid-target', reason: NFR_TO_OPERATIONALIZATION[kind] ?? '' };
  }
  return { ok: true };
}

const softgoals = ['nfr.NFR', 'nfr.Operationalization'];
const labels = { changeableLabel: true, possibleLabels: NFR_CONTRIBUTION_LABELS };

export const NFR = defineMetamodel({
  name: 'nfr',
  prefix: 'nfr',
  elements: [
    { kind: 'nfr.NFR', category: 'node' },
    { kind: 'nfr.Operationalization', category: 'node' },
    { kind: 'nfr.Claim', category: 'node' },
  ],
  links: [
    {
      kind: 'nfr.AndRefinementLink',
      label: 'And-Refinement',
      rules: { sources: softgoals, targets: softgoals, sameActor: false },
      check: notNfrToOperationalization,
    },
    {
      kind: 'nfr.OrRefinementLink',
      label: 'Or-Refinement',
      rules: { sources: softgoals, targets: softgoals, sameActor: false },
      check: notNfrToOperationalization,
    },
    {
      kind: 'nfr.ContributionLink',
      label: 'Contribution',
      rules: { sources: softgoals, targets: softgoals, sameActor: false },
      check: notNfrToOperationalization,
      info: labels,
    },
    {
      kind: 'nfr.CorrelationLink',
      label: 'Correlation',
      rules: { sources: softgoals, targets: softgoals, sameActor: false, unique: false },
      check: notNfrToOperationalization,
      info: labels,
    },
    {
      kind: 'nfr.ArgumentLink',
      label: 'Argument',
      rules: { sources: ['nfr.Claim'], targets: ['link'], sameActor: false },
    },
  ],
  file: DSM3_FILE,
});

const KAOS_NODE = { canBeInnerElement: false, canBeDependum: false, canBeOnPaper: true };
const KAOS_SIZE = { width: 135, height: 36 };
const kaosNode = <K extends string>(kind: K) =>
  ({ kind, category: 'node', info: KAOS_NODE, size: KAOS_SIZE }) as const;

/** KAOS's element kinds, with the hub its n-ary Refinement generates. */
export type KaosElementKind =
  | 'kaos.BehavioralGoal'
  | 'kaos.Softgoal'
  | 'kaos.Agent'
  | 'kaos.EnvironmentAgent'
  | 'kaos.DomainProperty'
  | 'kaos.RefinementLinkHub';

/** KAOS's link kinds, with the leg and end kinds its n-ary Refinement generates. */
export type KaosLinkKind =
  | 'kaos.RefinementLink'
  | 'kaos.RefinementLinkStart'
  | 'kaos.RefinementLinkEnd'
  | 'kaos.ResponsibilityAssignment'
  | 'kaos.Conflict';

// Generated kinds aren't inferred from the declaration: name them in the type arguments.
export const KAOS = defineMetamodel<KaosElementKind, KaosLinkKind>({
  name: 'kaos',
  prefix: 'kaos',
  elements: [
    kaosNode('kaos.BehavioralGoal'),
    kaosNode('kaos.Softgoal'),
    kaosNode('kaos.Agent'),
    kaosNode('kaos.EnvironmentAgent'),
    kaosNode('kaos.DomainProperty'),
  ],
  links: [
    {
      kind: 'kaos.RefinementLink',
      label: 'Refinement',
      // DSM3-goals' `sourceMultiplicity: -1`: one target, many sources, joined at a hub.
      arity: 'n',
      rules: {
        sources: ['kaos.BehavioralGoal', 'kaos.Softgoal', 'kaos.DomainProperty'],
        targets: ['node'],
        sameActor: false,
        unique: false,
      },
    },
    {
      kind: 'kaos.ResponsibilityAssignment',
      label: 'Responsibility Assignment',
      rules: {
        sources: ['kaos.Agent', 'kaos.EnvironmentAgent'],
        targets: ['node'],
        sameActor: false,
      },
    },
    {
      kind: 'kaos.Conflict',
      rules: { sources: ['node'], targets: ['node'], sameActor: false },
    },
  ],
  file: DSM3_FILE,
});
