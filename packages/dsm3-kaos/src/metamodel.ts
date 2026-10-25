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

/**
 * Base descriptions of KAOS's kinds, written in our own words from van Lamsweerde's
 * *Requirements Engineering: From System Goals to UML Models to Software Specifications*
 * (Wiley, 2009) and the KAOS glossary transcribed in
 * `../goal-controller/docs/papers/respectit-kaos-tutorial.md` §6.2 (Respect-IT, *A KAOS
 * Tutorial*, 2007).
 */
export const KAOS_ELEMENT_DESCRIPTIONS: Readonly<Record<KaosDeclaredElementKind, string>> = {
  'kaos.BehavioralGoal':
    'A prescriptive statement of an objective the system-to-be must meet, with a clear-cut ' +
    'criterion for whether it is satisfied (van Lamsweerde 2009; KAOS Tutorial glossary, ' +
    "'Goal'). Unlike a Softgoal, it can be objectively judged met or not.",
  'kaos.Softgoal':
    'A goal-like objective with no clear-cut satisfaction criterion, satisficed to a ' +
    'sufficient degree rather than strictly met (van Lamsweerde 2009; cf. the NFR ' +
    "Framework's softgoal). Use it instead of a Behavioral Goal for qualities such as " +
    'usability or performance that admit degrees.',
  'kaos.Agent':
    'An active object that performs operations to achieve goals, whether part of the ' +
    "software-to-be or of its environment (KAOS Tutorial glossary, 'Agent').",
  'kaos.EnvironmentAgent':
    'An Agent that lies in the environment of the software-to-be rather than inside it — a ' +
    'human, organisation or external system the goal model depends on but does not control ' +
    "(KAOS Tutorial glossary, 'Agent', 'Environment').",
  'kaos.DomainProperty':
    'A descriptive assertion about the environment — a domain invariant that always holds ' +
    '(e.g. a physical law) or a hypothesis assumed to hold — used in a Refinement to justify ' +
    "how the subgoals entail the goal they refine (KAOS Tutorial glossary, 'Domain Property').",
};

/** Base descriptions of KAOS's link kinds (see `KAOS_ELEMENT_DESCRIPTIONS` for the sources). */
export const KAOS_LINK_DESCRIPTIONS: Readonly<Record<KaosDeclaredLinkKind, string>> = {
  'kaos.RefinementLink':
    'Links a goal, softgoal or domain property to the subgoals whose conjunction is meant to ' +
    "entail it (KAOS Tutorial glossary, 'Refinement'; van Lamsweerde 2009): the sources join " +
    'at a hub (AND-refinement); several hubs on the same target are alternative, OR-related ' +
    'refinements.',
  'kaos.ResponsibilityAssignment':
    'Assigns an Agent or Environment Agent the responsibility of achieving a goal, turning it ' +
    "into a requirement or expectation (KAOS Tutorial glossary, 'Responsibility', " +
    "'Requirement', 'Expectation').",
  'kaos.Conflict':
    'Marks two elements as conflicting: under some boundary condition they cannot be achieved ' +
    "together (KAOS Tutorial glossary, 'Conflict').",
};

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
      description: KAOS_ELEMENT_DESCRIPTIONS['kaos.BehavioralGoal'],
    },
    {
      kind: 'kaos.Softgoal',
      label: 'Softgoal',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: KAOS_ELEMENT_DESCRIPTIONS['kaos.Softgoal'],
    },
    {
      kind: 'kaos.Agent',
      label: 'Agent',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: KAOS_ELEMENT_DESCRIPTIONS['kaos.Agent'],
    },
    {
      kind: 'kaos.EnvironmentAgent',
      label: 'Environment Agent',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: KAOS_ELEMENT_DESCRIPTIONS['kaos.EnvironmentAgent'],
    },
    {
      kind: 'kaos.DomainProperty',
      label: 'Domain Property',
      category: 'node',
      info: ON_PAPER,
      size: SIZE,
      description: KAOS_ELEMENT_DESCRIPTIONS['kaos.DomainProperty'],
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
      description: KAOS_LINK_DESCRIPTIONS['kaos.RefinementLink'],
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
      description: KAOS_LINK_DESCRIPTIONS['kaos.ResponsibilityAssignment'],
    },
    {
      // Conflict.isValid: between any two elements, one per pair (in either direction).
      kind: 'kaos.Conflict',
      label: 'Conflict',
      rules: { sources: ['node'], targets: ['node'], sameActor: false, unique: 'kind' },
      description: KAOS_LINK_DESCRIPTIONS['kaos.Conflict'],
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
