/**
 * How KAOS looks and what its palette offers, as a react registry extension. Labels and titles
 * come from DSM3-goals' `language_kaos_ui.metamodel.js`, shapes from `language_kaos_shapes.js`.
 */
import { linkIcon } from '@istar-ts/react';
import type { IstarExtension } from '@istar-ts/react';
import { AssignmentGlyph, ConflictGlyph } from './glyphs';
import type {
  KaosElementKind,
  KaosLinkKind,
  KaosObstacleElementKind,
  KaosObstacleLinkKind,
} from './kinds';
import {
  behavioralGoalProperties,
  conflictProperties,
  domainPropertyProperties,
  obstacleProperties,
  refinementProperties,
  resolutionProperties,
  softgoalProperties,
} from './properties';
import {
  KAOS_ASSIGNMENT_GLYPH,
  KAOS_CONFLICT_GLYPH,
  KAOS_OBSTACLE_SHAPES,
  KAOS_OBSTRUCTION_MARKER,
  KAOS_REFINEMENT_MARKER,
  KAOS_RESOLUTION_DASH,
  KAOS_SHAPES,
} from './shapes';

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
 * the canvas. It also carries the obstacle analysis's parts, used when the model's metamodel is
 * `KAOS_OBSTACLES`; with plain `KAOS` the registry has no such kinds and skips them.
 */
export const kaosExtension: IstarExtension<
  KaosElementKind | KaosObstacleElementKind,
  KaosLinkKind | KaosObstacleLinkKind
> = {
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
    // The refinement's circle: drawn and inspected by react's hub defaults; its schema is the
    // refinement's, as DSM3 saves the refinement's properties on it.
    'kaos.RefinementLinkHub': { properties: refinementProperties },
    'kaos.DomainProperty': {
      shape: KAOS_SHAPES['kaos.DomainProperty'],
      properties: domainPropertyProperties,
      palette: addNode('Domain Property', 'a', 14),
    },
    // Obstacle analysis (KAOS_OBSTACLES).
    'kaosObstacles.Obstacle': {
      shape: KAOS_OBSTACLE_SHAPES['kaosObstacles.Obstacle'],
      properties: obstacleProperties,
      palette: addNode('Obstacle', 'an', 15),
    },
  },
  links: {
    'kaos.RefinementLink': {
      // The hub's end draws like its base link: DSM3's filled triangle at the refined goal.
      line: { marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      // Defaults for a new refinement's hub (react puts them there when connecting).
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
      line: { marker: false },
      // The palette shows the glyph the canvas draws at the link's middle.
      icon: linkIcon('kaos.ResponsibilityAssignment', undefined, {
        marker: null,
        glyph: KAOS_ASSIGNMENT_GLYPH,
      }),
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
      line: { marker: false },
      // The palette shows the glyph the canvas draws at the link's middle.
      icon: linkIcon('kaos.Conflict', undefined, { marker: null, glyph: KAOS_CONFLICT_GLYPH }),
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
    // Obstacle analysis (KAOS_OBSTACLES).
    'kaosObstacles.ObstacleRefinementLink': {
      line: { marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      palette: [
        {
          label: 'Obstacle Refinement',
          title:
            'Add Obstacle Refinement link: drag from a sub-obstacle or domain property to the obstacle it refines; drop on the circle of an existing refinement to add a leg',
          order: 43,
          section: 'elements',
        },
      ],
    },
    'kaosObstacles.ObstructionLink': {
      line: { marker: KAOS_OBSTRUCTION_MARKER },
      palette: [
        {
          label: 'Obstruction',
          title: 'Add Obstruction link: drag from the obstacle to the goal it obstructs',
          order: 44,
          section: 'elements',
        },
      ],
    },
    'kaosObstacles.ResolutionLink': {
      line: { dash: KAOS_RESOLUTION_DASH, marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      properties: resolutionProperties,
      palette: [
        {
          label: 'Resolution',
          title: 'Add Resolution link: drag from the resolving goal to the obstacle',
          order: 45,
          section: 'elements',
        },
      ],
    },
  },
};
