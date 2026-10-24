import { describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import { dryRun, planFor } from '../src/lab/agent';
import { maxChildrenGuard } from '../src/lab/guards';

describe('planFor', () => {
  test('is five steps towards a stated goal', () => {
    const plan = planFor();
    expect(plan.steps).toHaveLength(5);
    expect(plan.goal.length).toBeGreaterThan(0);
  });
});

describe('dryRun', () => {
  test('leaves the live model untouched', async () => {
    const store = createModelStore();
    const before = store.getModel();

    await dryRun(before, planFor().steps);

    expect(store.getModel()).toBe(before);
  });

  test('accepts every step of the unmodified plan, without guards', async () => {
    const store = createModelStore();
    const entries = await dryRun(store.getModel(), planFor().steps);
    expect(entries.map((e) => e.result.ok)).toEqual([true, true, true, true, true]);
  });

  test('rejects with the guard switched on, matching the live dispatcher', async () => {
    const store = createModelStore();
    const guard = maxChildrenGuard(1);
    const entries = await dryRun(store.getModel(), planFor().steps, [guard]);
    // Step 1 creates the actor; steps 2-4 each add a child to it, so the guard (max 1 child)
    // accepts the first (the goal) and rejects the second and third (the task, the other
    // goal) — and step 5's edge, which needs that rejected task, is rejected too.
    expect(entries.map((e) => e.result.ok)).toEqual([true, true, false, false, false]);
  });
});

describe('applying the plan as one compound', () => {
  test('a bad member changes nothing', async () => {
    const store = createModelStore();
    const dispatcher = createActionDispatcher(store);
    const before = store.getModel();

    const steps = planFor().steps;
    // Drop the actor-creation step: every later step's containerId/sourceElementId now points
    // at an actor that was never created, so the whole compound should be rejected.
    const broken = steps.slice(1);

    const result = await dispatcher.dispatch({
      kind: 'compound',
      operationList: broken.map((step) => step.operation),
    });

    expect(result.ok).toBe(false);
    expect(store.getModel()).toBe(before);
  });

  test('applies cleanly when dry-run accepted every step', async () => {
    const store = createModelStore();
    const dispatcher = createActionDispatcher(store);
    const steps = planFor().steps;

    const preview = await dryRun(store.getModel(), steps);
    expect(preview.every((entry) => entry.result.ok)).toBe(true);

    const result = await dispatcher.dispatch({
      kind: 'compound',
      operationList: steps.map((step) => step.operation),
    });

    expect(result.ok).toBe(true);
    expect(store.getModel().elements.size).toBe(4);
    expect(store.getModel().links.size).toBe(1);
  });
});
