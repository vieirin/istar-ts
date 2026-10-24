import { contextActionsFor } from '@istar-ts/actions';
import { describe, expect, it } from 'vitest';
import { KAOS, KAOS_PALETTE } from '../src';

describe('KAOS_PALETTE', () => {
  it('lists KAOS kinds as context actions, React-free', () => {
    const { actions } = contextActionsFor(KAOS_PALETTE, KAOS);
    const labels = actions.map((action) => action.label);
    expect(labels).toEqual([
      'Behavioral Goal',
      'Softgoal',
      'Agent',
      'Environment Agent',
      'Domain Property',
      'Refinement',
      'Responsibility Assignment',
      'Conflict',
    ]);
    // The hub, leg and end kinds core generates for the n-ary refinement are never offered.
    for (const action of actions) {
      expect(action.label).not.toMatch(/Hub|Start|End/);
    }
  });
});
