/**
 * `startIstarGlspWorker({ mcp: true })` (#134): the GLSP server in a Web Worker, with MCP
 * reached through server-mcp 2.8.0's `McpWorkerBridge` over a separate `MessagePort`
 * (`connectWorkerMcp`, alongside `connectWorkerDispatcher`'s). A Node `MessageChannel` stands in
 * for the Worker boundary, as `test/browser.test.ts`'s `startIstarGlspWorker` suite does.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ActionMessage } from '@eclipse-glsp/server';
import { BaseJsonrpcGLSPClient, RequestModelAction } from '@eclipse-glsp/server';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';
import type { ActionGuard } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore, parsePistar } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '../src';
import type { GlspPortLike } from '../src/browser';
import { startIstarGlspWorker } from '../src/browser';
import type { WorkerMcp } from '../src/page';
import { connectWorkerMcp } from '../src/page';
import { fixture } from './fixtures';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
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

async function mcpClient(mcp: WorkerMcp): Promise<Client> {
  const client = new Client({ name: 'istar-glsp-worker-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcp.url, { fetch: mcp.fetch }));
  cleanup.push(() => client.close());
  return client;
}

/**
 * MCP's launcher activates (and `McpWorkerBridge.bindLauncher` runs) on the GLSP server's own
 * `initialize`, the same as the in-page server (`browser-mcp.test.ts`'s "next to a GLSP client"
 * suite) — a worker with MCP still needs a GLSP client on the worker port, as `?server=worker`'s
 * stock client provides in the playground.
 */
async function initializeWorker(port: unknown): Promise<ActionMessage[]> {
  const glsp = new BaseJsonrpcGLSPClient({
    id: 'worker-mcp-test',
    connectionProvider: createMessageConnection(
      new BrowserMessageReader(port as never),
      new BrowserMessageWriter(port as never),
    ),
  });
  await glsp.start();
  const received: ActionMessage[] = [];
  glsp.onActionMessage((message) => received.push(message));
  await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
  await glsp.initializeClientSession({
    clientSessionId: 'worker-mcp-test',
    diagramType: 'istar',
    clientActionKinds: ['setModel', 'updateModel'],
  });
  glsp.sendActionMessage({ clientId: 'worker-mcp-test', action: RequestModelAction.create() });
  await vi.waitFor(() => {
    if (!received.some((m) => m.action.kind === 'setModel')) throw new Error('no setModel yet');
  });
  return received;
}

const goal = (name: string) => ({
  elementTypeId: 'node:istar.Goal',
  position: { x: 300, y: 300 },
  containerId: AGENT,
  args: { name },
});

const refuseCreate: ActionGuard = (operation) =>
  operation.kind === 'createNode'
    ? [{ elementId: AGENT, severity: 'error', message: 'no new nodes today', code: 'demo' }]
    : undefined;

describe('startIstarGlspWorker with mcp', () => {
  test('tools/list and create-nodes reach the worker’s model', async () => {
    const { port1: page, port2: self } = channel();
    const worker = startIstarGlspWorker({
      model: welcome,
      sourceUri: 'welcome.txt',
      scope: self as unknown as GlspPortLike,
      mcp: true,
    });
    await initializeWorker(page);
    const mcp = connectWorkerMcp({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => mcp.close());

    const client = await mcpClient(mcp);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['create-nodes', 'session-info']));

    const { shared } = await worker;
    const before = shared.store.getModel();
    const result = await client.callTool({
      name: 'create-nodes',
      arguments: { sessionId: 'worker-mcp-test', nodes: [goal('Worker goal')] },
    });
    expect(result.isError).toBeFalsy();
    const model = shared.store.getModel();
    expect(model.elements.size).toBe(before.elements.size + 1);
    const created = [...model.elements.values()].find((e) => !before.elements.has(e.id));
    expect(created).toMatchObject({ kind: 'istar.Goal', parent: AGENT, x: 300, y: 300 });
  });

  test('an operation a guard rejects answers the tool call with an error', async () => {
    const { port1: page, port2: self } = channel();
    const parsed = parsePistar(welcome);
    const store = createModelStore(parsed);
    const dispatcher = createActionDispatcher(store, {
      palette: paletteOf(ISTAR_GLSP),
      guards: [refuseCreate],
    });
    const worker = startIstarGlspWorker({
      shared: { store, dispatcher },
      sourceUri: 'welcome.txt',
      scope: self as unknown as GlspPortLike,
      mcp: true,
    });
    await initializeWorker(page);
    const mcp = connectWorkerMcp({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => mcp.close());

    const client = await mcpClient(mcp);
    // #136: list first, as any agent harness does — the SDK client caches `create-nodes`' output
    // schema and validates a rejection's `structuredContent` against it even when `isError` is true.
    await client.listTools();
    const { shared } = await worker;
    const before = shared.store.getModel();
    const result = await client.callTool({
      name: 'create-nodes',
      arguments: { sessionId: 'worker-mcp-test', nodes: [goal('Refused')] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('no new nodes today');
    expect(result.structuredContent).toBeUndefined();
    expect(shared.store.getModel()).toBe(before);
  });

  // #223: one tool call, one undo step, all or nothing — in the worker as in-page
  // (`mcp-one-undo.test.ts`).
  test('create-nodes with text is one undo step', async () => {
    const { port1: page, port2: self } = channel();
    const worker = startIstarGlspWorker({
      model: welcome,
      sourceUri: 'welcome.txt',
      scope: self as unknown as GlspPortLike,
      mcp: true,
    });
    await initializeWorker(page);
    const mcp = connectWorkerMcp({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => mcp.close());
    const client = await mcpClient(mcp);
    const { shared } = await worker;
    const before = shared.store.getModel();
    const result = await client.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: 'worker-mcp-test',
        nodes: [{ ...goal('unused'), args: undefined, text: 'G1' }, goal('G2')],
      },
    });
    expect(result.isError).toBeFalsy();
    const created = [...shared.store.getModel().elements.values()]
      .filter((e) => !before.elements.has(e.id))
      .map((e) => e.name);
    expect(created).toEqual(['G1', 'G2']);
    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(before);
  });

  test('a refused item of a multi-item call leaves the model, and the client’s GModel, unchanged', async () => {
    const { port1: page, port2: self } = channel();
    const store = createModelStore(parsePistar(welcome));
    const refuseOne: ActionGuard = (operation) =>
      operation.kind === 'createNode' && operation.args?.name === 'Refused'
        ? [{ elementId: AGENT, severity: 'error', message: 'not this one', code: 'demo' }]
        : undefined;
    const dispatcher = createActionDispatcher(store, {
      palette: paletteOf(ISTAR_GLSP),
      guards: [refuseOne],
    });
    void startIstarGlspWorker({
      shared: { store, dispatcher },
      sourceUri: 'welcome.txt',
      scope: self as unknown as GlspPortLike,
      mcp: true,
    });
    const received = await initializeWorker(page);
    const mcp = connectWorkerMcp({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => mcp.close());
    const client = await mcpClient(mcp);
    await client.listTools();
    const before = store.getModel();
    const result = await client.callTool({
      name: 'create-nodes',
      arguments: { sessionId: 'worker-mcp-test', nodes: [goal('Drafted'), goal('Refused')] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not this one');
    expect(store.getModel()).toBe(before);
    // The client saw the draft while the call ran, then the store's model again.
    const updates = () => received.filter((m) => m.action.kind === 'updateModel');
    await vi.waitFor(() => {
      expect(updates().some((m) => JSON.stringify(m.action).includes('Drafted'))).toBe(true);
    });
    await vi.waitFor(() => {
      expect(JSON.stringify(updates().at(-1)?.action)).not.toContain('Drafted');
    });
  });
});
