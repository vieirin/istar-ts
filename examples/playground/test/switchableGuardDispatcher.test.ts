import { describe, expect, test } from 'vitest';
import { createModelStore } from '@istar-ts/core';
import { maxChildrenGuard } from '../src/lab/guards';
import { createSwitchableGuardDispatcher } from '../src/lab/switchableGuardDispatcher';

describe('createSwitchableGuardDispatcher', () => {
  test('the guard only rejects once switched on, and the model/undo history survive the switch', async () => {
    const store = createModelStore();
    const dispatcher = createSwitchableGuardDispatcher(store, maxChildrenGuard(1));

    const actor = await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    if (!actor.ok) throw new Error('setup failed');
    const actorId = actor.createdIds[0]!;
    await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
    });

    // Off by default: a second child is accepted.
    const secondOff = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Task',
      containerId: actorId,
    });
    expect(secondOff.ok).toBe(true);
    expect(store.getModel().elements.size).toBe(3);
    expect(store.canUndo()).toBe(true);

    dispatcher.setGuardEnabled(true);
    expect(dispatcher.guardEnabled()).toBe(true);

    const thirdOn = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Task',
      containerId: actorId,
    });
    expect(thirdOn.ok).toBe(false);
    // Still the same 3 elements, undo history from before the switch intact.
    expect(store.getModel().elements.size).toBe(3);
    expect(store.canUndo()).toBe(true);
    store.undo();
    store.undo();
    store.undo();
    expect(store.getModel().elements.size).toBe(0);
  });

  test('a listener subscribed before the switch keeps hearing model changes after it', async () => {
    const store = createModelStore();
    const dispatcher = createSwitchableGuardDispatcher(store, maxChildrenGuard(1));
    let changes = 0;
    dispatcher.subscribe((action) => {
      if (action.kind === 'sourceModelChanged') changes += 1;
    });

    await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    expect(changes).toBe(1);

    dispatcher.setGuardEnabled(true);
    await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    expect(changes).toBe(2);
  });
});
