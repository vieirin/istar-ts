/**
 * #249: a session over a dispatcher on the other end of a port (`createRemoteDispatcher`, no
 * `isDirty`), and a session closed while its live server still waits on that dispatcher.
 */
import { afterEach, describe, expect, test } from 'vitest';
import type { ActionDispatcher } from '@istar-ts/actions';
import {
  connectDispatcher,
  createActionDispatcher,
  createMirrorStore,
  createRemoteDispatcher,
} from '@istar-ts/actions';
import { createModelStore, metamodelOf } from '@istar-ts/core';
import type { AnyMetamodel, ModelStore } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { openGlspMcpSession } from '../src/glsp';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).toReversed()) fn();
});

/** The rejections nobody handles while `run` runs (and for `settle` ms after). */
async function unhandledDuring(run: () => Promise<void>, settle: number): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', listener);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, settle));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return seen;
}

/** A model and dispatcher behind a `MessageChannel`, and a mirror of it on this end. */
async function remote() {
  const store = createModelStore() as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(store, {
    palette: paletteOf(ISTAR_GLSP),
    sendModel: true,
  });
  await dispatcher.dispatch({
    kind: 'createNode',
    elementTypeId: 'istar.Actor',
    location: { x: 0, y: 0 },
    args: { id: 'lab', name: 'Lab' },
  });
  const { port1, port2 } = new MessageChannel();
  const disconnect = connectDispatcher(port1, dispatcher);
  const remoteDispatcher = createRemoteDispatcher<string, string, MessageEvent>(port2);
  const mirror = createMirrorStore(remoteDispatcher);
  await mirror.ready;
  cleanup.push(() => {
    disconnect();
    port1.close();
    port2.close();
  });
  return { store, mirror, remoteDispatcher };
}

describe('a GLSP session over a remote dispatcher (#249)', () => {
  test('works without isDirty', async () => {
    const { store, mirror, remoteDispatcher } = await remote();
    const session = await openGlspMcpSession(() => ({
      store: mirror as unknown as ModelStore<string, string>,
      dispatcher: remoteDispatcher,
      metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
    }));
    cleanup.push(() => session.close());
    const result = await session.liveRegistry.call('create-nodes', {
      nodes: [
        {
          elementTypeId: 'node:istar.Task',
          position: { x: 40, y: 40 },
          containerId: 'lab',
          args: { name: 'Remote task' },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect([...store.getModel().elements.values()].map((e) => e.name)).toContain('Remote task');
  });

  test('closing right after opening raises no unhandled rejection', async () => {
    const { store, mirror, remoteDispatcher } = await remote();
    // Past the live validation's 100ms debounce, and the remote round trips after it.
    const unhandled = await unhandledDuring(async () => {
      const session = await openGlspMcpSession(() => ({
        store: mirror as unknown as ModelStore<string, string>,
        dispatcher: remoteDispatcher,
        metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
      }));
      session.close();
    }, 300);
    expect(unhandled).toEqual([]);
  });

  test('closing while a live validation waits on the dispatcher raises no unhandled rejection', async () => {
    const { store, mirror, remoteDispatcher } = await remote();
    let validating!: () => void;
    const started = new Promise<void>((resolve) => {
      validating = resolve;
    });
    // Answers `requestMarkers` (the live validation's) only after the session has closed.
    const slow: ActionDispatcher<string, string> = {
      async dispatch(action, options) {
        if (action.kind !== 'requestMarkers') return remoteDispatcher.dispatch(action, options);
        validating();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return remoteDispatcher.dispatch(action, options);
      },
      subscribe: (listener) => remoteDispatcher.subscribe(listener),
    };
    const unhandled = await unhandledDuring(async () => {
      const session = await openGlspMcpSession(() => ({
        store: mirror as unknown as ModelStore<string, string>,
        dispatcher: slow,
        metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
      }));
      await started;
      session.close();
    }, 200);
    expect(unhandled).toEqual([]);
  });
});
