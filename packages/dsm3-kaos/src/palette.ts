/**
 * KAOS's palette data (label, grouping, ordering) as a `PaletteDescription` (`@istar-ts/core`),
 * React-free so a headless host can answer "what can I add here"
 * (`contextActionsFor`, `@istar-ts/actions`) without `@istar-ts/react`. `kaosExtension`
 * (`extension.ts`) derives its palette entries from it, adding icons, titles and components.
 */
import type {
  LinkToolEntryDescription,
  PaletteDescription,
  PaletteEntryDescription,
} from '@istar-ts/core';
import type {
  KaosElementKind,
  KaosLinkKind,
  KaosObstacleElementKind,
  KaosObstacleLinkKind,
} from './kinds';

const ELEMENTS: Readonly<Record<KaosElementKind, PaletteEntryDescription | false>> = {
  'kaos.BehavioralGoal': { label: 'Behavioral Goal', order: 10, section: 'elements' },
  'kaos.Softgoal': { label: 'Softgoal', order: 11, section: 'elements' },
  'kaos.Agent': { label: 'Agent', order: 12, section: 'elements' },
  'kaos.EnvironmentAgent': { label: 'Environment Agent', order: 13, section: 'elements' },
  'kaos.DomainProperty': { label: 'Domain Property', order: 14, section: 'elements' },
  // The refinement's circle: drawn and inspected as the link, never added by itself.
  'kaos.RefinementLinkHub': false,
};

const LINKS: Readonly<Record<KaosLinkKind, readonly LinkToolEntryDescription[] | false>> = {
  'kaos.RefinementLink': [{ label: 'Refinement', order: 40, section: 'elements' }],
  'kaos.ResponsibilityAssignment': [
    { label: 'Responsibility Assignment', order: 41, section: 'elements' },
  ],
  'kaos.Conflict': [{ label: 'Conflict', order: 42, section: 'elements' }],
  // Drawn with the refinement's tool: never a toolbar entry of their own.
  'kaos.RefinementLinkStart': false,
  'kaos.RefinementLinkEnd': false,
};

/** KAOS's palette data, as DSM3-goals' toolbar presents it. */
export const KAOS_PALETTE: PaletteDescription<KaosElementKind, KaosLinkKind> = {
  elements: ELEMENTS,
  links: LINKS,
  groups: {},
};

/** `KAOS_PALETTE` with the obstacle analysis's kinds (`KAOS_OBSTACLES`). */
export const KAOS_OBSTACLES_PALETTE: PaletteDescription<
  KaosElementKind | KaosObstacleElementKind,
  KaosLinkKind | KaosObstacleLinkKind
> = {
  elements: {
    ...ELEMENTS,
    'kaosObstacles.Obstacle': { label: 'Obstacle', order: 15, section: 'elements' },
    'kaosObstacles.ObstacleRefinementLinkHub': false,
  },
  links: {
    ...LINKS,
    'kaosObstacles.ObstacleRefinementLink': [
      { label: 'Obstacle Refinement', order: 43, section: 'elements' },
    ],
    'kaosObstacles.ObstructionLink': [{ label: 'Obstruction', order: 44, section: 'elements' }],
    'kaosObstacles.ResolutionLink': [{ label: 'Resolution', order: 45, section: 'elements' }],
    'kaosObstacles.ObstacleRefinementLinkStart': false,
    'kaosObstacles.ObstacleRefinementLinkEnd': false,
  },
  groups: {},
};
