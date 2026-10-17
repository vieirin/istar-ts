/**
 * KAOS as DSM3-goals defines it (`language_kaos_metamodel.js` and `language_kaos_constraints.js`,
 * https://www.cin.ufpe.br/~jhcp/dsm3goals/): a root metamodel under the `kaos` prefix.
 */
import { DSM3_FILE_KEYS, DSM3_TOOL, defineMetamodel } from '@istar-ts/core';
import type { Metamodel, NodeKindInfo, RootMetamodelDeclaration } from '@istar-ts/core';
import type {
  KaosDeclaredElementKind,
  KaosDeclaredLinkKind,
  KaosElementKind,
  KaosLinkKind,
} from './kinds';

/** KAOS nodes lie on the paper: KAOS has no actors to put them in. */
const ON_PAPER: NodeKindInfo = {
  canBeInnerElement: false,
  canBeDependum: false,
  canBeOnPaper: true,
};

/** DSM3's element size (`size: {width: 135, height: 36}` in `language_kaos_shapes.js`). */
const SIZE = { width: 135, height: 36 } as const;

export const KAOS_DECLARATION: RootMetamodelDeclaration<
  KaosDeclaredElementKind,
  KaosDeclaredLinkKind
> = {
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
      // DSM3's RefinementLink.isValid: not onto itself, not from an agent, any element target;
      // it leaves the "one per pair" check commented out. Several sub-goals join at a hub
      // (DSM3's `sourceMultiplicity: -1`): core generates kaos.RefinementLinkHub, …Start
      // (legs, one per source) and …End, with DSM3's file types.
      kind: 'kaos.RefinementLink',
      label: 'Refinement',
      arity: 'n',
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
  file: { tool: DSM3_TOOL, extra: { metamodelVersion: '1.0' }, keys: DSM3_FILE_KEYS },
};

/**
 * The KAOS root metamodel: parse, create and check KAOS models with it. Its kind types include
 * the generated hub, leg and end kinds, which core doesn't infer from the declaration.
 */
export const KAOS: Metamodel<KaosElementKind, KaosLinkKind> = defineMetamodel<
  KaosElementKind,
  KaosLinkKind
>(KAOS_DECLARATION);
