import { describe, expect, it } from 'vitest';
import {
  KAOS_PROPERTY_SCHEMAS,
  behavioralGoalProperties,
  conflictProperties,
  refinementProperties,
  softgoalProperties,
} from '../src';

const GOAL_KEYS = [
  'Type',
  'Category',
  'Source',
  'Priority',
  'Issue',
  'FormalSpec',
  'FitCriterion',
  'Stability',
];

describe('KAOS property schemas', () => {
  it('creates goals with DSM3’s keys, all empty', () => {
    const defaults = behavioralGoalProperties.defaults();
    expect(Object.keys(defaults)).toEqual(GOAL_KEYS);
    expect(Object.values(defaults).every((v) => v === '')).toBe(true);
  });

  it('types a new Softgoal as softgoal', () => {
    expect(softgoalProperties.defaults()).toMatchObject({ Type: 'softgoal', Category: '' });
  });

  it('keeps keys it does not declare, such as DSM3’s Description', () => {
    const current = { Description: 'Keep me', Type: '' };
    expect(behavioralGoalProperties.write(current, { Priority: 'high' })).toEqual({
      Description: 'Keep me',
      Type: '',
      Priority: 'high',
    });
  });

  it('puts the refinement’s properties on its hub, where DSM3 saves them', () => {
    expect(refinementProperties.kind).toBe('kaos.RefinementLinkHub');
    expect(Object.keys(refinementProperties.defaults())).toEqual(['SysRef', 'Status', 'Tactic']);
  });

  it('gives Conflict its boundary condition', () => {
    expect(conflictProperties.defaults()).toEqual({ BoundaryCondition: '' });
  });

  it('lists every schema once', () => {
    expect(KAOS_PROPERTY_SCHEMAS.map((s) => s.kind)).toEqual([
      'kaos.BehavioralGoal',
      'kaos.Softgoal',
      'kaos.RefinementLinkHub',
      'kaos.Conflict',
    ]);
  });
});
