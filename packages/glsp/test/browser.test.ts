/**
 * The browser launchers (`@istar-ts/glsp/browser`) on Node's `MessageChannel`: the page side is
 * a GLSP client on one port (protocol's `BaseJsonrpcGLSPClient`, as a stock client connects to a
 * worker) and, for the worker, an istar-ts action client on a second port
 * (`connectWorkerDispatcher`).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ActionMessage, GLSPClient } from '@eclipse-glsp/server';
import { BaseJsonrpcGLSPClient, RequestModelAction } from '@eclipse-glsp/server';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';
import type { IstarAction } from '@istar-ts/actions';
import { ISTAR_GLSP, createIstarSharedModel } from '../src';
import type { GlspPortLike } from '../src/browser';
import { serveIstarGlsp, startIstarGlspWorker } from '../src/browser';
import { connectWorkerDispatcher } from '../src/page';
import { fixture } from './fixtures';
import { next } from './server';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0).toReversed()) fn();
  vi.unstubAllGlobals();
});

function channel(): MessageChannel {
  const ch = new MessageChannel();
  cleanup.push(() => {
    ch.port1.close();
    ch.port2.close();
  });
  return ch;
}

/** A GLSP client on `port`, initialized, with a session on the `istar` diagram. */
async function glspClient(port: unknown, clientId: string) {
  const client: GLSPClient = new BaseJsonrpcGLSPClient({
    id: clientId,
    connectionProvider: createMessageConnection(
      new BrowserMessageReader(port as never),
      new BrowserMessageWriter(port as never),
    ),
  });
  await client.start();
  const received: ActionMessage[] = [];
  client.onActionMessage((message) => received.push(message));
  const result = await client.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
  await client.initializeClientSession({
    clientSessionId: clientId,
    diagramType: 'istar',
    clientActionKinds: ['setModel', 'updateModel', 'setDirtyState'],
  });
  client.sendActionMessage({ clientId, action: RequestModelAction.create() });
  await next(received, 'setModel');
  return { client, received, result };
}

const createGoal = (x: number): IstarAction<string, string> => ({
  kind: 'createNode',
  elementTypeId: 'istar.Goal',
  containerId: AGENT,
  location: { x, y: 200 },
});

describe('serveIstarGlsp, in the page', () => {
  test('two GLSP clients and the page’s own dispatcher edit one shared model', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const [one, two] = [channel(), channel()];
    for (const ch of [one, two]) {
      const server = serveIstarGlsp(ch.port2 as unknown as GlspPortLike, { shared });
      cleanup.push(() => server.close());
    }
    const a = await glspClient(one.port1, 'a');
    const b = await glspClient(two.port1, 'b');
    expect(a.result.protocolVersion).toBe('1.0.0');

    // The canvas's edit: straight on the shared dispatcher.
    const created = await shared.dispatcher.dispatch(createGoal(700));
    expect(created.ok).toBe(true);
    const id = created.ok ? created.createdIds?.[0] : undefined;
    for (const client of [a, b]) {
      const { action } = await next(client.received, 'updateModel');
      expect(JSON.stringify(action)).toContain(id);
    }
  });
});

describe('startIstarGlspWorker', () => {
  test('GLSP on the worker and a dispatcher port share the worker’s model', async () => {
    const { port1: page, port2: self } = channel();
    // The model loads from a URL: GLSP messages sent meanwhile wait for the server.
    let respond!: (text: string) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () => new Promise((resolve) => (respond = (text) => resolve({ text: async () => text }))),
      ),
    );
    const worker = startIstarGlspWorker({
      url: '/models/welcome.txt',
      scope: self as unknown as GlspPortLike,
    });
    const remote = connectWorkerDispatcher({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => remote.close());
    const glsp = glspClient(page, 'glsp');
    await new Promise((resolve) => setTimeout(resolve, 20));
    respond(welcome);
    const { shared } = await worker;
    const { received } = await glsp;
    expect(JSON.stringify(received[0]!.action)).toContain(AGENT);

    // An edit through the dispatcher port reaches the GLSP client…
    const heard: string[] = [];
    remote.subscribe((action) => heard.push(action.kind));
    const created = await remote.dispatch(createGoal(640));
    expect(created.ok).toBe(true);
    const id = created.ok ? created.createdIds?.[0] : undefined;
    expect(shared.store.getModel().elements.has(id!)).toBe(true);
    const { action } = await next(received, 'updateModel');
    expect(JSON.stringify(action)).toContain(id);
    // …and the port hears the change, as a remote canvas would.
    expect(heard).toContain('sourceModelChanged');

    // Saving through the port writes the worker's file.
    const saved = await remote.dispatch({ kind: 'saveModel' });
    expect(saved.ok).toBe(true);
  });
});
