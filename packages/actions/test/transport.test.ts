import { describe, expect, test, vi } from 'vitest';
import { ISTAR_2_0, createModelStore } from '@istar-ts/core';
import type { ActionDispatcher, IstarAction, ModelSourceChangedAction } from '../src';
import {
  connectDispatcher,
  createActionDispatcher,
  createRemoteDispatcher,
  withDirtyState,
} from '../src';

let next = 0;
const createId = (): string => `id${++next}`;

/** An actor with a goal, connected client/server over a real `MessageChannel`. */
function setup() {
  next = 0;
  const store = createModelStore(undefined, { metamodel: ISTAR_2_0, createId });
  store.transaction(() => {
    store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
    store.addElement({ kind: 'istar.Goal', id: 'g1', x: 10, y: 10, parent: 'a' });
  });
  store.clearHistory();

  const server = createActionDispatcher(store);
  const { port1, port2 } = new MessageChannel();
  const dispose = connectDispatcher(port1, server);
  const client: ActionDispatcher = createRemoteDispatcher(port2);
  return { store, server, client, port1, port2, dispose };
}

describe('connectDispatcher / createRemoteDispatcher', () => {
  test('a createNode dispatched through the remote dispatcher', async () => {
    const { client, store } = setup();
    const result = await client.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Quality',
      containerId: 'a',
      args: { name: 'Fast' },
    });
    expect(result).toEqual({ ok: true, createdIds: ['id1'] });
    expect(store.getModel().elements.get('id1')?.name).toBe('Fast');
  });

  test('a rejection carries its diagnostics and leaves the model untouched', async () => {
    const { client, store } = setup();
    const before = store.getModel();
    const result = await client.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.NoSuchKind' as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(store.getModel()).toBe(before);
  });

  test('a request/response pair (requestModel)', async () => {
    const { client } = setup();
    const result = await client.dispatch({ kind: 'requestModel', requestId: 'r1' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a success');
    expect(result.response?.kind).toBe('setModel');
    expect(result.response?.responseId).toBe('r1');
    expect(result.response?.newRoot.actors).toBeDefined();
  });

  test('subscribe receives sourceModelChanged when the store changes', async () => {
    const { client, store } = setup();
    const received: IstarAction[] = [];
    const unsubscribe = client.subscribe((action) => received.push(action));

    store.addElement({ kind: 'istar.Task', id: 'extra', x: 0, y: 0 });

    // The notification crosses a MessageChannel, which isn't ordered before a timer: poll.
    const changed = await vi.waitFor(() => {
      const found = received.find(
        (a): a is ModelSourceChangedAction => a.kind === 'sourceModelChanged',
      );
      expect(found).toBeDefined();
      return found;
    });
    expect(changed?.source).toBe('edit');
    unsubscribe();
  });

  test('origin round-trips: given to the client, heard on the server-side notification', async () => {
    const { client } = setup();
    const received: IstarAction[] = [];
    const unsubscribe = client.subscribe((action) => received.push(action));

    await client.dispatch(
      { kind: 'createNode', elementTypeId: 'istar.Quality', containerId: 'a' },
      { origin: 'canvas' },
    );

    const changed = await vi.waitFor(() => {
      const found = received.find(
        (a): a is ModelSourceChangedAction => a.kind === 'sourceModelChanged',
      );
      expect(found).toBeDefined();
      return found;
    });
    expect(changed?.origin).toBe('canvas');
    unsubscribe();
  });

  test('an unknown method answers a JSON-RPC error, not a hang', async () => {
    const { port2 } = setup();
    const response = await new Promise<{ error?: { code: number } }>((resolve) => {
      port2.onmessage = (ev) => resolve(ev.data);
      port2.postMessage({ jsonrpc: '2.0', id: 'bad-1' });
    });
    expect(response.error?.code).toBe(-32601);
  });

  test('disposing the connection stops forwarding and detaches onmessage', async () => {
    const { client, store, dispose, port1 } = setup();
    dispose();
    expect(port1.onmessage).toBeNull();

    const received: IstarAction[] = [];
    client.subscribe((action) => received.push(action));
    store.addElement({ kind: 'istar.Task', id: 'extra', x: 0, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([]);
  });
});

describe('withDirtyState (#249)', () => {
  test("a remote dispatcher's dirty state, tracked from setDirtyState", async () => {
    const { client, server } = setup();
    const tracked = withDirtyState(client);
    expect(tracked.isDirty()).toBe(false);
    await tracked.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Quality',
      containerId: 'a',
      args: { name: 'Fast' },
    });
    // The notification arrives before the result.
    expect(server.isDirty()).toBe(true);
    expect(tracked.isDirty()).toBe(true);
    await tracked.dispatch({ kind: 'glspUndo' });
    expect(tracked.isDirty()).toBe(false);

    tracked.dispose();
    await client.dispatch({ kind: 'glspRedo' });
    expect(server.isDirty()).toBe(true);
    expect(tracked.isDirty()).toBe(false);
  });

  test('a dispatcher with isDirty and dispose is returned as is', () => {
    const { server } = setup();
    expect(withDirtyState(server)).toBe(server);
  });
});
