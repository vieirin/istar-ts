import { describe, expect, test } from 'vitest';
import { ISTAR_2_0, createModelStore } from '@istar-ts/core';
import { createActionDispatcher } from '../src';
import type { ActionGuard, ActionPostGuard } from '../src';

// Mirrors the "worked example" fenced block in docs/action-protocol.md. Keep the two in sync.
describe('docs: action-protocol.md worked guard example', () => {
  test('a guard that blocks a kind rejects, others pass', async () => {
    const noTasks: ActionGuard = (operation) => {
      if (operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task') {
        return [{ elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' }];
      }
    };

    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const dispatcher = createActionDispatcher(store, { guards: [noTasks] });
    const actor = await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    if (!actor.ok) throw new Error('setup failed');
    const [actorId] = actor.createdIds;

    const rejected = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Task',
      containerId: actorId,
    });
    expect(rejected).toEqual({
      ok: false,
      diagnostics: [
        { elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' },
      ],
    });

    const accepted = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
    });
    expect(accepted.ok).toBe(true);
  });
});

// Mirrors the "postGuards" worked example in docs/action-protocol.md. Keep the two in sync.
describe('docs: action-protocol.md worked postGuard example', () => {
  test('a postGuard that blocks a name rejects, leaving the model and undo stack untouched', async () => {
    const noForbiddenName: ActionPostGuard = (operation, modelAfter) => {
      if (operation.kind !== 'applyLabelEdit') return;
      if ([...modelAfter.elements.values()].some((e) => e.name === 'forbidden')) {
        return [{ elementId: '', severity: 'error', message: 'that name is reserved' }];
      }
    };

    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const dispatcher = createActionDispatcher(store, { postGuards: [noForbiddenName] });
    const actor = await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    if (!actor.ok) throw new Error('setup failed');
    const [actorId] = actor.createdIds;
    if (actorId === undefined) throw new Error('setup failed');

    const before = store.getModel();
    const undoable = store.canUndo();
    const rejected = await dispatcher.dispatch({
      kind: 'applyLabelEdit',
      labelId: actorId,
      text: 'forbidden',
    });
    expect(rejected).toEqual({
      ok: false,
      diagnostics: [{ elementId: '', severity: 'error', message: 'that name is reserved' }],
    });
    expect(store.getModel()).toBe(before);
    expect(store.canUndo()).toBe(undoable);
  });
});
