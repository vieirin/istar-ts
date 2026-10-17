/**
 * Minimal DSM3-goals roots for core's tests: the kinds and rules of its KAOS and NFR languages
 * (`language_{kaos,nfr}_metamodel.js` and `_constraints.js`), with file hints and no shapes.
 * The full languages ship as `@istar-ts/dsm3-kaos` and `@istar-ts/dsm3-nfr`.
 */
import type { LinkCheck, LinkRuleContext } from '../src';
import { defineMetamodel, isLinkRef } from '../src';

/** DSM3-goals' top-level key order (`fileManager.js`). */
export const DSM3_KEYS: readonly string[] = [
  'actors',
  'orphans',
  'dependencies',
  'links',
  'display',
  'tool',
  'metamodelVersion',
  'saveDate',
  'diagram',
];

const DSM3_FILE = { tool: 'dsm3-goals', extra: { metamodelVersion: '1.0' }, keys: DSM3_KEYS };

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
