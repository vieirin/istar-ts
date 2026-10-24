import { describe, expect, test, vi } from 'vitest';
import type { ActionDispatcher, ActionResult, IstarAction } from '@istar-ts/actions';
import { createLogStore } from '../src/lab/log';
import { tagClient } from '../src/lab/tagClient';

const action: IstarAction = { kind: 'applyLabelEdit', labelId: 'a', text: 'New name' };

function fakeDispatcher(result: ActionResult<never>): ActionDispatcher {
  return {
    dispatch: vi.fn<ActionDispatcher['dispatch']>(async () => result),
    subscribe: vi.fn<ActionDispatcher['subscribe']>(() => () => {}),
  };
}

describe('tagClient', () => {
  test('delegates while enabled and logs the client, action and result', async () => {
    const result: ActionResult<never> = { ok: true, createdIds: ['x'] };
    const inner = fakeDispatcher(result);
    const log = createLogStore();
    const tagged = tagClient(inner, 'Script', log);

    const outcome = await tagged.dispatch(action);

    expect(outcome).toBe(result);
    expect(inner.dispatch).toHaveBeenCalledWith(action);
    const [entry] = log.getEntries();
    expect(entry).toMatchObject({ client: 'Script', action, result });
    expect(typeof entry!.durationMs).toBe('number');
  });

  test('setEnabled(false) rejects without delegating, and is logged', async () => {
    const inner = fakeDispatcher({ ok: true, createdIds: [] });
    const log = createLogStore();
    const tagged = tagClient(inner, 'Worker', log);

    tagged.setEnabled(false);
    expect(tagged.isEnabled()).toBe(false);
    const outcome = await tagged.dispatch(action);

    expect(outcome.ok).toBe(false);
    expect(inner.dispatch).not.toHaveBeenCalled();
    const [entry] = log.getEntries();
    expect(entry!.client).toBe('Worker');
    expect(entry!.result.ok).toBe(false);
  });

  test('re-enabling resumes delegating', async () => {
    const result: ActionResult<never> = { ok: true, createdIds: [] };
    const inner = fakeDispatcher(result);
    const tagged = tagClient(inner, 'UI', createLogStore());

    tagged.setEnabled(false);
    tagged.setEnabled(true);
    const outcome = await tagged.dispatch(action);

    expect(outcome).toBe(result);
    expect(inner.dispatch).toHaveBeenCalledTimes(1);
  });

  test('two wrappers over the same dispatcher log under their own client', async () => {
    const inner = fakeDispatcher({ ok: true, createdIds: [] });
    const log = createLogStore();
    const ui = tagClient(inner, 'UI', log);
    const script = tagClient(inner, 'Script', log);

    await ui.dispatch(action);
    await script.dispatch(action);

    expect(log.getEntries().map((e) => e.client)).toEqual(['UI', 'Script']);
  });
});
