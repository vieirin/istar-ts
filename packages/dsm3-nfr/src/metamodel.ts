/**
 * The NFR Framework as DSM3-goals defines it (`language_nfr_metamodel.js` and
 * `language_nfr_constraints.js`, https://www.cin.ufpe.br/~jhcp/dsm3goals/): a root metamodel
 * under the `nfr` prefix.
 */
import {
  DSM3_FILE_KEYS,
  DSM3_TOOL,
  LINK_SELECTOR,
  defineMetamodel,
  isLinkRef,
} from '@istar-ts/core';
import type {
  LinkCheck,
  LinkRuleContext,
  LinkRules,
  Metamodel,
  NodeKindInfo,
  RootMetamodelDeclaration,
} from '@istar-ts/core';
import { NFR_CONTRIBUTION_LABELS } from './kinds';
import type { NfrElementKind, NfrLinkKind } from './kinds';

/** NFR nodes lie on the paper: the NFR Framework has no actors to put them in. */
const ON_PAPER: NodeKindInfo = {
  canBeInnerElement: false,
  canBeDependum: false,
  canBeOnPaper: true,
};

/** DSM3's element size (`size: {width: 90, height: 55}` in `language_nfr_shapes.js`). */
const SIZE = { width: 90, height: 55 } as const;

/**
 * Refinements, contributions and correlations join softgoals and operationalizations; Claims
 * only take part in Argument links (DSM3: "Claims cannot be a part of … links").
 */
function softgoalRules(unique: LinkRules['unique']): LinkRules {
  return {
    sources: ['nfr.NFR', 'nfr.Operationalization'],
    targets: ['nfr.NFR', 'nfr.Operationalization'],
    sameActor: false,
    unique,
  };
}

/**
 * DSM3's rule that an NFR softgoal never refines, contributes to or correlates with an
 * Operationalization; `reason` is DSM3's message for the link kind.
 */
export function notNfrToOperationalization(
  reason: string,
): (context: LinkRuleContext) => LinkCheck {
  return ({ source, target }) =>
    source.kind === 'nfr.NFR' && !isLinkRef(target) && target.kind === 'nfr.Operationalization'
      ? { ok: false, code: 'invalid-target', reason }
      : { ok: true };
}

const LABELS = { changeableLabel: true, possibleLabels: NFR_CONTRIBUTION_LABELS } as const;

export const NFR_DECLARATION: RootMetamodelDeclaration<NfrElementKind, NfrLinkKind> = {
  name: 'nfr',
  prefix: 'nfr',
  elements: [
    { kind: 'nfr.NFR', label: 'NFR softgoal', category: 'node', info: ON_PAPER, size: SIZE },
    {
      kind: 'nfr.Operationalization',
      label: 'Operationalization',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
    },
    { kind: 'nfr.Claim', label: 'Claim', category: 'node', info: ON_PAPER, size: SIZE },
  ],
  links: [
    {
      kind: 'nfr.AndRefinementLink',
      label: 'And-Refinement',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization('you cannot refine an Operationalization with a NFR'),
    },
    {
      kind: 'nfr.OrRefinementLink',
      label: 'Or-Refinement',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization('you cannot refine an Operationalization with a NFR'),
    },
    {
      kind: 'nfr.ContributionLink',
      label: 'Contribution',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization(
        'you cannot have a NFR contributing to an Operationalization',
      ),
      info: LABELS,
    },
    {
      // DSM3's CorrelationLink.isValid has no "one per pair" check.
      kind: 'nfr.CorrelationLink',
      label: 'Correlation',
      rules: softgoalRules(false),
      check: notNfrToOperationalization(
        'you cannot have an Operationalization as the target of a Correlation',
      ),
      info: LABELS,
    },
    {
      // ArgumentLink.isValid: from a Claim, towards a link. DSM3's uniqueness check looks for a
      // ContributionLink between the Claim and the link, which never exists (an upstream slip);
      // one Argument per Claim and link is what it means.
      kind: 'nfr.ArgumentLink',
      label: 'Argument',
      rules: { sources: ['nfr.Claim'], targets: [LINK_SELECTOR], sameActor: false, unique: 'kind' },
    },
  ],
  file: { tool: DSM3_TOOL, extra: { metamodelVersion: '1.0' }, keys: DSM3_FILE_KEYS },
};

/** The NFR root metamodel: parse, create and check NFR models with it. */
export const NFR: Metamodel<NfrElementKind, NfrLinkKind> = defineMetamodel(NFR_DECLARATION);
