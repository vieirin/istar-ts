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

/**
 * Base descriptions of the NFR Framework's kinds, written in our own words from Chung, Nixon,
 * Yu & Mylopoulos, *Non-Functional Requirements in Software Engineering* (Kluwer, 2000). The
 * exact split of labels between Contribution and Correlation, and the Claim/Argument wording,
 * are from general knowledge of the book rather than a page reference — flagged as uncertain in
 * the PR body.
 */
const NFR_ELEMENT_DESCRIPTIONS: Readonly<Record<NfrElementKind, string>> = {
  'nfr.NFR':
    'A non-functional requirement treated as a softgoal: an objective (e.g. security, ' +
    'performance) with no clear-cut satisfaction criterion, judged "satisficed" by a ' +
    'preponderance of positive over negative evidence rather than strictly proven (Chung, ' +
    'Nixon, Yu & Mylopoulos 2000).',
  'nfr.Operationalization':
    'A concrete design or implementation decision — an "operationalizing softgoal" — put ' +
    'forward as a way to satisfice one or more NFR softgoals (Chung et al. 2000).',
  'nfr.Claim':
    'A justification softgoal recording the rationale for a Contribution or Correlation ' +
    'judgement; it argues for a link via an Argument rather than contributing to other ' +
    'softgoals itself (Chung et al. 2000).',
};

/** Base descriptions of the NFR Framework's link kinds (see `NFR_ELEMENT_DESCRIPTIONS` for the source). */
const NFR_LINK_DESCRIPTIONS: Readonly<Record<NfrLinkKind, string>> = {
  'nfr.AndRefinementLink':
    'Decomposes a softgoal or operationalization into sub-elements that must all be ' +
    'satisficed for the parent to be satisficed (Chung et al. 2000).',
  'nfr.OrRefinementLink':
    'Decomposes a softgoal or operationalization into alternative sub-elements, any one of ' +
    'which suffices to satisfice the parent (Chung et al. 2000).',
  'nfr.ContributionLink':
    'Expresses how satisficing one softgoal or operationalization affects another, labelled ' +
    'with a strength and polarity: "++"/"+" (sufficient/partial positive) or "– –"/"–" ' +
    '(sufficient/partial negative), plus "some+"/"some-" for unquantified partial evidence and ' +
    '"unknown" for an undetermined effect (Chung et al. 2000).',
  'nfr.CorrelationLink':
    'Like a Contribution, but records a side-effect relationship the modeller observes ' +
    'between two softgoals rather than one deliberately designed in (Chung et al. 2000).',
  'nfr.ArgumentLink':
    'Links a Claim to the Contribution or Correlation link it justifies (Chung et al. 2000).',
};

export const NFR_DECLARATION: RootMetamodelDeclaration<NfrElementKind, NfrLinkKind> = {
  name: 'nfr',
  prefix: 'nfr',
  elements: [
    {
      kind: 'nfr.NFR',
      label: 'NFR softgoal',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: NFR_ELEMENT_DESCRIPTIONS['nfr.NFR'],
    },
    {
      kind: 'nfr.Operationalization',
      label: 'Operationalization',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: NFR_ELEMENT_DESCRIPTIONS['nfr.Operationalization'],
    },
    {
      kind: 'nfr.Claim',
      label: 'Claim',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: NFR_ELEMENT_DESCRIPTIONS['nfr.Claim'],
    },
  ],
  links: [
    {
      kind: 'nfr.AndRefinementLink',
      label: 'And-Refinement',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization('you cannot refine an Operationalization with a NFR'),
      description: NFR_LINK_DESCRIPTIONS['nfr.AndRefinementLink'],
    },
    {
      kind: 'nfr.OrRefinementLink',
      label: 'Or-Refinement',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization('you cannot refine an Operationalization with a NFR'),
      description: NFR_LINK_DESCRIPTIONS['nfr.OrRefinementLink'],
    },
    {
      kind: 'nfr.ContributionLink',
      label: 'Contribution',
      rules: softgoalRules('kind'),
      check: notNfrToOperationalization(
        'you cannot have a NFR contributing to an Operationalization',
      ),
      info: LABELS,
      description: NFR_LINK_DESCRIPTIONS['nfr.ContributionLink'],
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
      description: NFR_LINK_DESCRIPTIONS['nfr.CorrelationLink'],
    },
    {
      // ArgumentLink.isValid: from a Claim, towards a link. DSM3's uniqueness check looks for a
      // ContributionLink between the Claim and the link, which never exists (an upstream slip);
      // one Argument per Claim and link is what it means.
      kind: 'nfr.ArgumentLink',
      label: 'Argument',
      rules: { sources: ['nfr.Claim'], targets: [LINK_SELECTOR], sameActor: false, unique: 'kind' },
      description: NFR_LINK_DESCRIPTIONS['nfr.ArgumentLink'],
    },
  ],
  file: { tool: DSM3_TOOL, extra: { metamodelVersion: '1.0' }, keys: DSM3_FILE_KEYS },
};

/** The NFR root metamodel: parse, create and check NFR models with it. */
export const NFR: Metamodel<NfrElementKind, NfrLinkKind> = defineMetamodel(NFR_DECLARATION);
