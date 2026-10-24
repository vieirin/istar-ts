import { describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import { DEMO_GUARD_MAX_CHILDREN, maxChildrenGuard } from '../src/lab/guards';

describe('maxChildrenGuard', () => {
  test('rejects a createNode once the container already has maxChildren children, with its own diagnostic', async () => {
    const store = createModelStore();
    const dispatcher = createActionDispatcher(store, {
      guards: [maxChildrenGuard(DEMO_GUARD_MAX_CHILDREN)],
    });

    const actor = await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    if (!actor.ok) throw new Error('setup failed');
    const actorId = actor.createdIds[0]!;

    const first = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
    });
    expect(first.ok).toBe(true);

    const second = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Task',
      containerId: actorId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.diagnostics).toEqual([
      {
        elementId: actorId,
        severity: 'error',
        message: `"${actorId}" already has 1 child element(s); this guard allows at most ${DEMO_GUARD_MAX_CHILDREN}`,
        code: 'max-children',
      },
    ]);
    // Rejected: the model is untouched, no second child.
    expect(store.getModel().elements.size).toBe(2);
  });

  test('does not look at createNode without a container, or other operations', () => {
    const guard = maxChildrenGuard(0);
    const model = createModelStore().getModel();
    expect(guard({ kind: 'createNode', elementTypeId: 'istar.Actor' }, model)).toBeUndefined();
    expect(guard({ kind: 'deleteElement', elementIds: ['x'] }, model)).toBeUndefined();
  });
});
