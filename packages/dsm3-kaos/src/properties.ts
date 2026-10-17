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
  readonly SysRef: PropertyType<string>;
  readonly Status: PropertyType<string>;
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

/** Every KAOS schema, e.g. for core's `validateModelProperties`. */
export const KAOS_PROPERTY_SCHEMAS: readonly PropertySchema<PropertyShape, string>[] = [
  behavioralGoalProperties,
  softgoalProperties,
  refinementProperties,
  conflictProperties,
];
