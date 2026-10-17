/**
 * KAOS as DSM3-goals defines it (`language_kaos_metamodel.js` and `language_kaos_constraints.js`,
 * https://www.cin.ufpe.br/~jhcp/dsm3goals/): a root metamodel under the `kaos` prefix.
 */
import { defineMetamodel } from '@istar-ts/core';
import type { Metamodel, NodeKindInfo, RootMetamodelDeclaration } from '@istar-ts/core';
import type { KaosElementKind, KaosLinkKind } from './kinds';

/** KAOS nodes lie on the paper: KAOS has no actors to put them in. */
const ON_PAPER: NodeKindInfo = {
  canBeInnerElement: false,
  canBeDependum: false,
  canBeOnPaper: true,
};

/** DSM3's element size (`size: {width: 135, height: 36}` in `language_kaos_shapes.js`). */
const SIZE = { width: 135, height: 36 } as const;

/** The top-level keys of a DSM3-goals file, in the order DSM3 writes them. */
export const DSM3_FILE_KEYS: readonly string[] = [
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

export const KAOS_DECLARATION: RootMetamodelDeclaration<KaosElementKind, KaosLinkKind> = {
  name: 'kaos',
  prefix: 'kaos',
  elements: [
    {
      kind: 'kaos.BehavioralGoal',
      label: 'Behavioral Goal',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
    },
    { kind: 'kaos.Softgoal', label: 'Softgoal', category: 'node', info: ON_PAPER, size: SIZE },
    { kind: 'kaos.Agent', label: 'Agent', category: 'node', info: ON_PAPER, size: SIZE },
    {
      kind: 'kaos.EnvironmentAgent',
      label: 'Environment Agent',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
    },
    {
      kind: 'kaos.DomainProperty',
      label: 'Domain Property',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
    },
  ],
  links: [
    {
      // DSM3's RefinementLink.isValid: not onto itself, not from an agent, any element target.
      // DSM3 leaves the "one per pair" check commented out. Its several sub-goals (DSM3's
      // `sourceMultiplicity: -1`) arrive with core's n-ary links.
      kind: 'kaos.RefinementLink',
      label: 'Refinement',
      rules: {
        sources: ['kaos.BehavioralGoal', 'kaos.Softgoal', 'kaos.DomainProperty'],
        targets: ['node'],
        sameActor: false,
        unique: false,
      },
    },
    {
      // ResponsibilityAssignment.isValid: from an Agent or Environment Agent, one per pair.
      kind: 'kaos.ResponsibilityAssignment',
      label: 'Responsibility Assignment',
      rules: {
        sources: ['kaos.Agent', 'kaos.EnvironmentAgent'],
        targets: ['node'],
        sameActor: false,
        unique: 'kind',
      },
    },
    {
      // Conflict.isValid: between any two elements, one per pair (in either direction).
      kind: 'kaos.Conflict',
      label: 'Conflict',
      rules: { sources: ['node'], targets: ['node'], sameActor: false, unique: 'kind' },
    },
  ],
  file: { tool: 'dsm3-goals', extra: { metamodelVersion: '1.0' }, keys: DSM3_FILE_KEYS },
};

/** The KAOS root metamodel: parse, create and check KAOS models with it. */
export const KAOS: Metamodel<KaosElementKind, KaosLinkKind> = defineMetamodel(KAOS_DECLARATION);
