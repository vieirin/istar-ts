/**
 * How KAOS looks and what its palette offers, as a react registry extension. Labels and titles
 * come from DSM3-goals' `language_kaos_ui.metamodel.js`, shapes from `language_kaos_shapes.js`.
 */
import type {
  ElementToolEntryDescription,
  LinkToolEntryDescription,
  PaletteEntryDescription,
} from '@istar-ts/core';
import { linkIcon } from '@istar-ts/react';
import type { IstarExtension } from '@istar-ts/react';
import { AssignmentGlyph, ConflictGlyph } from './glyphs';
import type {
  KaosElementKind,
  KaosLinkKind,
  KaosObstacleElementKind,
  KaosObstacleLinkKind,
} from './kinds';
import { KAOS_OBSTACLES_PALETTE } from './palette';
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

/** An element's palette entry (`KAOS_OBSTACLES_PALETTE`), with the title piStar-ext shows. */
function addNode(
  value: PaletteEntryDescription | readonly ElementToolEntryDescription[] | false,
  article: string,
) {
  const entry = value as PaletteEntryDescription;
  return {
    ...entry,
    title: `Adding ${entry.label}: click on the diagram to add ${article} ${entry.label}`,
  };
}

/** A link kind's single palette entry (`KAOS_OBSTACLES_PALETTE`), with its title. */
function addLink(entries: readonly LinkToolEntryDescription[] | false, title: string) {
  const entry = (entries as readonly LinkToolEntryDescription[])[0]!;
  return [{ ...entry, title }];
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
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaos.BehavioralGoal'], 'a'),
    },
    'kaos.Softgoal': {
      shape: KAOS_SHAPES['kaos.Softgoal'],
      properties: softgoalProperties,
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaos.Softgoal'], 'a'),
    },
    'kaos.Agent': {
      shape: KAOS_SHAPES['kaos.Agent'],
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaos.Agent'], 'an'),
    },
    'kaos.EnvironmentAgent': {
      shape: KAOS_SHAPES['kaos.EnvironmentAgent'],
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaos.EnvironmentAgent'], 'an'),
    },
    // The refinement's circle: drawn and inspected by react's hub defaults; its schema is the
    // refinement's, as DSM3 saves the refinement's properties on it.
    'kaos.RefinementLinkHub': { properties: refinementProperties },
    'kaos.DomainProperty': {
      shape: KAOS_SHAPES['kaos.DomainProperty'],
      properties: domainPropertyProperties,
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaos.DomainProperty'], 'a'),
    },
    // Obstacle analysis (KAOS_OBSTACLES).
    'kaosObstacles.Obstacle': {
      shape: KAOS_OBSTACLE_SHAPES['kaosObstacles.Obstacle'],
      properties: obstacleProperties,
      palette: addNode(KAOS_OBSTACLES_PALETTE.elements['kaosObstacles.Obstacle'], 'an'),
    },
  },
  links: {
    'kaos.RefinementLink': {
      // The hub's end draws like its base link: DSM3's filled triangle at the refined goal.
      line: { marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      // Defaults for a new refinement's hub (react puts them there when connecting).
      properties: refinementProperties,
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaos.RefinementLink'],
        'Add Refinement link: drag from a sub-goal to the goal it refines; drop on the circle of an existing refinement to add a leg',
      ),
    },
    'kaos.ResponsibilityAssignment': {
      line: { marker: false },
      // The palette shows the glyph the canvas draws at the link's middle.
      icon: linkIcon('kaos.ResponsibilityAssignment', undefined, {
        marker: null,
        glyph: KAOS_ASSIGNMENT_GLYPH,
      }),
      labelComponent: AssignmentGlyph,
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaos.ResponsibilityAssignment'],
        'Add Responsibility Assignment: drag from the agent to the element it is responsible for',
      ),
    },
    'kaos.Conflict': {
      line: { marker: false },
      // The palette shows the glyph the canvas draws at the link's middle.
      icon: linkIcon('kaos.Conflict', undefined, { marker: null, glyph: KAOS_CONFLICT_GLYPH }),
      labelComponent: ConflictGlyph,
      properties: conflictProperties,
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaos.Conflict'],
        'Add Conflict link: drag from one conflicting element to the other',
      ),
    },
    // Obstacle analysis (KAOS_OBSTACLES).
    'kaosObstacles.ObstacleRefinementLink': {
      line: { marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaosObstacles.ObstacleRefinementLink'],
        'Add Obstacle Refinement link: drag from a sub-obstacle or domain property to the obstacle it refines; drop on the circle of an existing refinement to add a leg',
      ),
    },
    'kaosObstacles.ObstructionLink': {
      line: { marker: KAOS_OBSTRUCTION_MARKER },
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaosObstacles.ObstructionLink'],
        'Add Obstruction link: drag from the obstacle to the goal it obstructs',
      ),
    },
    'kaosObstacles.ResolutionLink': {
      line: { dash: KAOS_RESOLUTION_DASH, marker: KAOS_REFINEMENT_MARKER, markerFilled: true },
      properties: resolutionProperties,
      palette: addLink(
        KAOS_OBSTACLES_PALETTE.links['kaosObstacles.ResolutionLink'],
        'Add Resolution link: drag from the resolving goal to the obstacle',
      ),
    },
  },
};
