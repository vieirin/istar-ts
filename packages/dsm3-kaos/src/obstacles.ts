/**
 * Obstacle analysis on the KAOS root: obstacles, their refinement, obstruction of goals and
 * resolution by goals (van Lamsweerde & Letier, TSE 26(10), 2000). DSM3-goals' KAOS stops at
 * goals, agents and domain properties; these kinds and their file types are istar-ts's own.
 */
import { defineMetamodelExtension, extendMetamodel } from '@istar-ts/core';
import type { Metamodel, MetamodelExtension, NodeKindInfo } from '@istar-ts/core';
import type {
  KaosElementKind,
  KaosLinkKind,
  KaosObstacleDeclaredElementKind,
  KaosObstacleDeclaredLinkKind,
  KaosObstacleElementKind,
  KaosObstacleLinkKind,
} from './kinds';
import { KAOS } from './metamodel';

/** Like every KAOS node, an obstacle lies on the paper. */
const ON_PAPER: NodeKindInfo = {
  canBeInnerElement: false,
  canBeDependum: false,
  canBeOnPaper: true,
};

/** Goals an obstacle obstructs or that resolve one. */
const GOALS = ['kaos.BehavioralGoal', 'kaos.Softgoal'] as const;

/**
 * The obstacle analysis, applied with `extendMetamodel(KAOS, kaosObstacleAnalysis)` (or use
 * `KAOS_OBSTACLES`). Kinds are `kaosObstacles.*`, since the root reserves `kaos.`; files say
 * `kaos.Obstacle`, `kaos.ObstacleRefinementLinkHub/Start/End`, `kaos.ObstructionLink` and
 * `kaos.ResolutionLink`, so `detectFramework` still recognizes a KAOS file.
 */
export const kaosObstacleAnalysis: MetamodelExtension<
  KaosObstacleDeclaredElementKind,
  KaosObstacleDeclaredLinkKind
> = defineMetamodelExtension({
  name: 'kaosObstacles',
  elements: [
    {
      kind: 'kaosObstacles.Obstacle',
      label: 'Obstacle',
      category: 'node',
      info: ON_PAPER,
      // DSM3's KAOS element size.
      size: { width: 135, height: 36 },
      pistarType: 'kaos.Obstacle',
    },
  ],
  links: [
    {
      // An obstacle refined into sub-obstacles and domain properties (KAOSTools' `refinedby`
      // on an obstacle): they join at a hub, as in a goal refinement; several hubs are an OR.
      kind: 'kaosObstacles.ObstacleRefinementLink',
      label: 'Obstacle Refinement',
      arity: 'n',
      pistarType: 'kaos.ObstacleRefinementLink',
      rules: {
        sources: ['kaosObstacles.Obstacle', 'kaos.DomainProperty'],
        targets: ['kaosObstacles.Obstacle'],
        sameActor: false,
        unique: false,
      },
    },
    {
      // An obstacle obstructs a goal or a domain property (KAOSTools' `obstructedby`).
      kind: 'kaosObstacles.ObstructionLink',
      label: 'Obstruction',
      pistarType: 'kaos.ObstructionLink',
      rules: {
        sources: ['kaosObstacles.Obstacle'],
        targets: [...GOALS, 'kaos.DomainProperty'],
        sameActor: false,
        unique: 'kind',
      },
    },
    {
      // A goal resolves an obstacle (KAOSTools' `resolvedby`), drawn from the goal.
      kind: 'kaosObstacles.ResolutionLink',
      label: 'Resolution',
      pistarType: 'kaos.ResolutionLink',
      rules: {
        sources: [...GOALS],
        targets: ['kaosObstacles.Obstacle'],
        sameActor: false,
        unique: 'kind',
      },
    },
  ],
});

/** KAOS with obstacle analysis: reads, creates and checks models that have obstacles. */
export const KAOS_OBSTACLES: Metamodel<
  KaosElementKind | KaosObstacleElementKind,
  KaosLinkKind | KaosObstacleLinkKind
> = extendMetamodel(KAOS, kaosObstacleAnalysis) as Metamodel<
  KaosElementKind | KaosObstacleElementKind,
  KaosLinkKind | KaosObstacleLinkKind
>;
