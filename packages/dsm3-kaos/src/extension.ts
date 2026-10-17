/**
 * How KAOS looks and what its palette offers, as a react registry extension. Labels and titles
 * come from DSM3-goals' `language_kaos_ui.metamodel.js`, shapes from `language_kaos_shapes.js`.
 */
import type { IstarExtension } from '@istar-ts/react';
import { AssignmentGlyph, ConflictGlyph } from './glyphs';
import type { KaosElementKind, KaosLinkKind } from './kinds';
import {
  behavioralGoalProperties,
  conflictProperties,
  refinementProperties,
  softgoalProperties,
} from './properties';
import { KAOS_REFINEMENT_MARKER, KAOS_SHAPES } from './shapes';

function addNode(label: string, article: string, order: number) {
  return {
    label,
    title: `Adding ${label}: click on the diagram to add ${article} ${label}`,
    order,
    section: 'elements',
  };
}

/**
 * The KAOS registry parts. Apply them after the registry is completed for the KAOS metamodel
 * (`applyExtensions(registryForMetamodel(KAOS), [kaosExtension])`), or pass the extension to
 * the canvas.
 */
export const kaosExtension: IstarExtension<KaosElementKind, KaosLinkKind> = {
  name: 'dsm3-kaos',
  elements: {
    'kaos.BehavioralGoal': {
      shape: KAOS_SHAPES['kaos.BehavioralGoal'],
      properties: behavioralGoalProperties,
      palette: addNode('Behavioral Goal', 'a', 10),
    },
    'kaos.Softgoal': {
      shape: KAOS_SHAPES['kaos.Softgoal'],
      properties: softgoalProperties,
      palette: addNode('Softgoal', 'a', 11),
    },
    'kaos.Agent': {
      shape: KAOS_SHAPES['kaos.Agent'],
      palette: addNode('Agent', 'an', 12),
    },
    'kaos.EnvironmentAgent': {
      shape: KAOS_SHAPES['kaos.EnvironmentAgent'],
      palette: addNode('Environment Agent', 'an', 13),
    },
    'kaos.DomainProperty': {
      shape: KAOS_SHAPES['kaos.DomainProperty'],
      palette: addNode('Domain Property', 'a', 14),
    },
  },
  links: {
    'kaos.RefinementLink': {
      label: 'Refinement',
      // The hub's end draws like its base link: DSM3's filled triangle at the refined goal.
      line: { marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      properties: refinementProperties,
      palette: [
        {
          label: 'Refinement',
          title:
            'Add Refinement link: drag from a sub-goal to the goal it refines; drop on the circle of an existing refinement to add a leg',
          order: 40,
          section: 'elements',
        },
      ],
    },
    'kaos.ResponsibilityAssignment': {
      label: 'Responsibility Assignment',
      line: { marker: false },
      labelComponent: AssignmentGlyph,
      palette: [
        {
          label: 'Responsibility Assignment',
          title:
            'Add Responsibility Assignment: drag from the agent to the element it is responsible for',
          order: 41,
          section: 'elements',
        },
      ],
    },
    'kaos.Conflict': {
      label: 'Conflict',
      line: { marker: false },
      labelComponent: ConflictGlyph,
      properties: conflictProperties,
      palette: [
        {
          label: 'Conflict',
          title: 'Add Conflict link: drag from one conflicting element to the other',
          order: 42,
          section: 'elements',
        },
      ],
    },
  },
};
