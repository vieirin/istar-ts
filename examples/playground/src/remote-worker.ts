/**
 * Proves A3 (the transport) and C6 (the canvas as an action client) together: this worker is a
 * remote client of the main thread's `ActionDispatcher`, over the `MessagePort` it is handed.
 * It never touches the model store directly, only the action protocol.
 */
import { createRemoteDispatcher } from '@istar-ts/actions';

self.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
  void run(createRemoteDispatcher(event.data.port));
};

async function run(dispatcher: ReturnType<typeof createRemoteDispatcher>): Promise<void> {
  const actor = await dispatcher.dispatch({
    kind: 'createNode',
    elementTypeId: 'istar.Actor',
    location: { x: 80, y: 80 },
    args: { name: 'Remote worker' },
  });
  const actorId = actor.ok ? actor.createdIds[0] : undefined;
  if (actorId !== undefined) {
    // Each `createNode` is its own dispatch, so the host sees each one as its own undo step.
    await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
      location: { x: 20, y: 60 },
      args: { name: 'Created remotely' },
    });
    await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
      location: { x: 20, y: 130 },
      args: { name: 'Also created remotely' },
    });
  }
  self.postMessage('done');
}
