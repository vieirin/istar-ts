/**
 * Typed custom properties of KAOS kinds, from DSM3-goals' `language_kaos_metamodel.js`. Every
 * value is a string on disk; keys a schema doesn't know (such as DSM3's `Description`) are kept.
 */
import { defineProperties, prop } from '@istar-ts/core';
import type { PropertySchema, PropertyShape, PropertyType } from '@istar-ts/core';
import { KAOS_REFINEMENT_HUB } from './kinds';

/** The eight properties DSM3 gives Behavioral goals and Softgoals. */
export interface KaosGoalProperties extends PropertyShape {
  readonly Type: PropertyType<string>;
  readonly Category: PropertyType<string>;
  readonly Source: PropertyType<string>;
  readonly Priority: PropertyType<string>;
  readonly Issue: PropertyType<string>;
  readonly FormalSpec: PropertyType<string>;
  readonly FitCriterion: PropertyType<string>;
  readonly Stability: PropertyType<string>;
}

/** A free-text property that new elements get empty, as DSM3 creates them. */
function text(): PropertyType<string> {
  return prop.string({ default: '' });
}

function goalProperties(type: string): KaosGoalProperties {
  // DSM3 creates goals with every key present and empty, Softgoals with Type 'softgoal'.
  return {
    Type: prop.string({ default: type }),
    Category: text(),
    Source: text(),
    Priority: text(),
    Issue: text(),
    FormalSpec: text(),
    FitCriterion: text(),
    Stability: text(),
  };
}

export const behavioralGoalProperties: PropertySchema<KaosGoalProperties, 'kaos.BehavioralGoal'> =
  defineProperties('kaos.BehavioralGoal', goalProperties(''));

export const softgoalProperties: PropertySchema<KaosGoalProperties, 'kaos.Softgoal'> =
  defineProperties('kaos.Softgoal', goalProperties('softgoal'));

export interface KaosRefinementProperties extends PropertyShape {
  /**
   * The system reference: the design option the refinement belongs to (Heaven & Letier, RE
   * 2011). A dialect may type it.
   */
  readonly SysRef: PropertyType<string>;
  readonly Status: PropertyType<string>;
  /**
   * The refinement tactic or pattern (milestone-driven, case-driven, …; KAOSTools'
   * `refinedby [milestone]`). Free text here; a dialect types its values.
   */
  readonly Tactic: PropertyType<string>;
}

/**
 * A refinement's properties. DSM3 declares them on the refinement link and saves them on its
 * hub, so the schema's kind is the hub's.
 */
export const refinementProperties: PropertySchema<
  KaosRefinementProperties,
  'kaos.RefinementLinkHub'
> = defineProperties(KAOS_REFINEMENT_HUB, {
  SysRef: text(),
  Status: text(),
  Tactic: text(),
});

export interface KaosConflictProperties extends PropertyShape {
  readonly BoundaryCondition: PropertyType<string>;
}

export const conflictProperties: PropertySchema<KaosConflictProperties, 'kaos.Conflict'> =
  defineProperties('kaos.Conflict', { BoundaryCondition: text() });

export interface KaosDomainPropertyProperties extends PropertyShape {
  /**
   * Whether the domain property is an invariant or a hypothesis (the book and Objectiver
   * distinguish them on one concept, KAOSTools by declaration). Not DSM3's: optional and
   * without a default, so DSM3 files and new domain properties don't gain the key. A dialect
   * types its values (`invariant | hypothesis`).
   */
  readonly Kind: PropertyType<string>;
  /**
   * The domain property's formal specification (the book, ch. 17; KAOSTools' `formalspec`).
   * Not DSM3's: optional and without a default, so DSM3 files and new domain properties don't
   * gain the key. A dialect types it as a formula.
   */
  readonly FormalSpec: PropertyType<string>;
}

export const domainPropertyProperties: PropertySchema<
  KaosDomainPropertyProperties,
  'kaos.DomainProperty'
> = defineProperties('kaos.DomainProperty', {
  Kind: prop.string({ optional: true }),
  FormalSpec: prop.string({ optional: true }),
});

/** Every KAOS schema, e.g. for core's `validateModelProperties`. */
export const KAOS_PROPERTY_SCHEMAS: readonly PropertySchema<PropertyShape, string>[] = [
  behavioralGoalProperties,
  softgoalProperties,
  refinementProperties,
  conflictProperties,
  domainPropertyProperties,
];

// ---------------------------------------------------------------------------------------------
// Obstacle analysis (`kaosObstacleAnalysis`): istar-ts's keys, all text, as DSM3's are. Values
// such as a probability or a resolution strategy's name are a dialect's to type.

export interface KaosObstacleProperties extends PropertyShape {
  readonly Description: PropertyType<string>;
  /** The obstacle's formal definition; a string, as core has no formula language. */
  readonly FormalSpec: PropertyType<string>;
  readonly Category: PropertyType<string>;
}

export const obstacleProperties: PropertySchema<KaosObstacleProperties, 'kaosObstacles.Obstacle'> =
  defineProperties('kaosObstacles.Obstacle', {
    Description: text(),
    FormalSpec: text(),
    Category: text(),
  });

export interface KaosResolutionProperties extends PropertyShape {
  /** The resolution strategy (TSE'00's, KAOSTools' `prevention | mitigation`, …). */
  readonly ResolutionType: PropertyType<string>;
  /**
   * The goal a mitigation restores, by id. Text here; a dialect types it as
   * `prop.reference({ kinds: ['kaos.BehavioralGoal'] })`.
   */
  readonly Anchor: PropertyType<string>;
}

export const resolutionProperties: PropertySchema<
  KaosResolutionProperties,
  'kaosObstacles.ResolutionLink'
> = defineProperties('kaosObstacles.ResolutionLink', {
  ResolutionType: text(),
  Anchor: text(),
});

/** The obstacle analysis's schemas, for models read with `KAOS_OBSTACLES`. */
export const KAOS_OBSTACLE_PROPERTY_SCHEMAS: readonly PropertySchema<PropertyShape, string>[] = [
  obstacleProperties,
  resolutionProperties,
];
