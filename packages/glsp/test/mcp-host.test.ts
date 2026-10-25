/**
 * A host's tools and context providers (#175), defined once here, served by every MCP launcher
 * (in-page, worker, Node) next to the istar tools: listed, callable, a mutating tool's edits
 * through the session's dispatcher and its guards (one undo stack), a refusal a typed error.
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
import type { ActionGuard, HostContextProvider, HostTool } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore, parsePistar } from '@istar-ts/core';
import type { IstarMcpBaseOptions, IstarSharedModel } from '../src';
import { ISTAR_GLSP, paletteOf } from '../src';
import type { GlspPortLike } from '../src/browser';
import { serveIstarGlsp, startIstarGlspWorker } from '../src/browser';
import { startIstarGlspServer } from '../src/node';
import { connectWorkerMcp } from '../src/page';
import { fixture } from './fixtures';
import { connect } from './glsp-client';

const TASK = 'f9035e8c-0294-44a8-a93e-85a349d2f21a';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

// ---------------------------------------------------------------------------------------------
// The host's extensions, defined once

const SKY: HostContextProvider = {
  name: 'sky-facts',
  title: 'Sky facts',
  text: 'The sky is blue in this test domain.',
};

const SIZE: HostContextProvider = {
  name: 'model-size',
  text: (model) => `The model has ${model.elements.size} elements.`,
};

const ECHO_FACT: HostTool = {
  name: 'echo-fact',
  description: 'Answers a fact about a topic.',
  inputSchema: {
    type: 'object',
    properties: { topic: { type: 'string', description: 'What the fact is about.' } },
    required: ['topic'],
  },
  readOnly: true,
  handler: (args, { getModel }) => ({
    ok: true,
    content: { topic: args.topic as string, fact: 'blue', elements: getModel().elements.size },
  }),
};

const STAMP: HostTool = {
  name: 'stamp',
  description: 'Stamps an element with a value, as its Stamp custom property.',
  inputSchema: {
    type: 'object',
    properties: { elementId: { type: 'string' }, value: { type: 'string' } },
    required: ['elementId', 'value'],
  },
  handler: async (args, { dispatcher }) => {
    const result = await dispatcher.dispatch({
      kind: 'istar.updateProperties',
      elementId: args.elementId as string,
      properties: { Stamp: args.value as string },
    });
    return result.ok ? { ok: true, content: `Stamped ${args.elementId as string}.` } : result;
  },
};

/** Claims to be read-only, but tries to edit: its dispatcher refuses. */
const SNEAKY: HostTool = {
  ...STAMP,
  name: 'sneaky',
  readOnly: true,
};

const HOST: IstarMcpBaseOptions = {
  hostTools: [ECHO_FACT, STAMP, SNEAKY],
  context: [SKY, SIZE],
};

const noForbiddenStamp: ActionGuard = (operation) =>
  operation.kind === 'istar.updateProperties' && operation.properties.Stamp === 'forbidden'
    ? [{ elementId: operation.elementId, severity: 'error', message: 'no', code: 'host-guard' }]
    : undefined;

function sharedModel(): IstarSharedModel {
  const store = createModelStore(parsePistar(welcome));
  const dispatcher = createActionDispatcher(store, {
    palette: paletteOf(ISTAR_GLSP),
    guards: [noForbiddenStamp],
  });
  return { store, dispatcher };
}

async function mcpClient(url: URL, fetch?: typeof globalThis.fetch): Promise<Client> {
  const client = new Client({ name: 'istar-glsp-host-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, fetch ? { fetch } : {}));
  cleanup.push(() => client.close());
  return client;
}

/** The checks every launcher must pass, on an MCP client of `shared`'s session `sessionId`. */
async function checkHostExtensions(
  client: Client,
  sessionId: string,
  shared: IstarSharedModel,
): Promise<void> {
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  expect([...byName.keys()]).toEqual(
    expect.arrayContaining(['set-properties', 'echo-fact', 'stamp', 'sky-facts', 'model-size']),
  );
  expect(byName.get('echo-fact')?.annotations?.readOnlyHint).toBe(true);
  expect(byName.get('stamp')?.annotations?.readOnlyHint).toBe(false);
  // Context providers, listed as tools in server-mcp's default dataMode, are reads.
  expect(byName.get('sky-facts')?.annotations?.readOnlyHint).toBe(true);
  expect(byName.get('echo-fact')?.inputSchema).toMatchObject({
    properties: { sessionId: { type: 'string' }, topic: { type: 'string' } },
    required: expect.arrayContaining(['sessionId', 'topic']),
  });

  const elements = shared.store.getModel().elements.size;
  const echo = await client.callTool({ name: 'echo-fact', arguments: { sessionId, topic: 'sky' } });
  expect(echo.isError).toBeFalsy();
  expect(JSON.parse((echo.content as [{ text: string }])[0].text)).toEqual({
    topic: 'sky',
    fact: 'blue',
    elements,
  });

  const sky = await client.callTool({ name: 'sky-facts', arguments: { sessionId } });
  expect(JSON.stringify(sky.content)).toContain('The sky is blue in this test domain.');
  const size = await client.callTool({ name: 'model-size', arguments: { sessionId } });
  expect(JSON.stringify(size.content)).toContain(`The model has ${elements} elements.`);

  const stamped = await client.callTool({
    name: 'stamp',
    arguments: { sessionId, elementId: TASK, value: 'ok' },
  });
  expect(stamped.isError).toBeFalsy();
  expect(shared.store.getModel().elements.get(TASK)?.customProperties?.Stamp).toBe('ok');

  // The guard refuses, as a typed error; nothing changed.
  const before = shared.store.getModel();
  const refused = await client.callTool({
    name: 'stamp',
    arguments: { sessionId, elementId: TASK, value: 'forbidden' },
  });
  expect(refused.isError).toBe(true);
  const blocks = refused.content as Array<{ text: string }>;
  expect(JSON.parse(blocks[1]!.text)).toEqual({
    code: 'rejected',
    diagnostics: [expect.objectContaining({ code: 'host-guard', elementId: TASK })],
  });
  expect(shared.store.getModel()).toBe(before);

  // A read-only tool's dispatcher takes requests only.
  const sneaky = await client.callTool({
    name: 'sneaky',
    arguments: { sessionId, elementId: TASK, value: 'sneaked' },
  });
  expect(sneaky.isError).toBe(true);
  expect(JSON.stringify(sneaky.content)).toContain('read-only-tool');
  expect(shared.store.getModel()).toBe(before);

  // One undo stack: the session's `undo` takes the host tool's edit back.
  const undo = await client.callTool({ name: 'undo', arguments: { sessionId } });
  expect(undo.isError).toBeFalsy();
  await vi.waitFor(() => {
    expect(shared.store.getModel().elements.get(TASK)?.customProperties).not.toHaveProperty(
      'Stamp',
    );
  });
}

describe('host tools and context providers over MCP', () => {
  test('in the page', async () => {
    const shared = sharedModel();
    const server = serveIstarGlsp({ shared, mcp: HOST });
    cleanup.push(() => server.close());
    const client = await mcpClient(server.mcp.url, server.mcp.fetch);
    await expect(checkHostExtensions(client, server.sessionId!, shared)).resolves.toBeUndefined();
  });

  test('in a worker', async () => {
    const ch = new MessageChannel();
    cleanup.push(() => {
      ch.port1.close();
      ch.port2.close();
    });
    const { port1: page, port2: self } = ch;
    const shared = sharedModel();
    const worker = startIstarGlspWorker({
      shared,
      scope: self as unknown as GlspPortLike,
      mcp: HOST,
    });
    const glsp = new BaseJsonrpcGLSPClient({
      id: 'host-test',
      connectionProvider: createMessageConnection(
        new BrowserMessageReader(page as never),
        new BrowserMessageWriter(page as never),
      ),
    });
    await glsp.start();
    cleanup.push(() => glsp.stop());
    const received: ActionMessage[] = [];
    glsp.onActionMessage((message) => received.push(message));
    await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
    await glsp.initializeClientSession({
      clientSessionId: 'host-test',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    glsp.sendActionMessage({ clientId: 'host-test', action: RequestModelAction.create() });
    await vi.waitFor(() => {
      if (!received.some((m) => m.action.kind === 'setModel')) throw new Error('no setModel yet');
    });
    await worker;
    const mcp = connectWorkerMcp({
      postMessage: (message, transfer) => page.postMessage(message, transfer as never),
    });
    cleanup.push(() => mcp.close());
    const client = await mcpClient(mcp.url, mcp.fetch);
    await expect(checkHostExtensions(client, 'host-test', shared)).resolves.toBeUndefined();
  });

  test('on Node', async () => {
    const shared = sharedModel();
    const server = await startIstarGlspServer({ shared, mcp: HOST });
    cleanup.push(() => server.close());
    const connection = await connect(server.url);
    cleanup.push(() => connection.socket.close());
    const result = (await connection.client.initializeServer({
      applicationId: 'test',
      protocolVersion: '1.0.0',
    })) as { mcpServer?: { url: string } };
    await connection.client.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    connection.client.sendActionMessage({
      clientId: 's1',
      action: RequestModelAction.create(),
    });
    const client = await mcpClient(new URL(result.mcpServer!.url));
    await expect(checkHostExtensions(client, 's1', shared)).resolves.toBeUndefined();
  });

  test("dataMode 'resources' serves a context provider as an MCP resource", async () => {
    const shared = sharedModel();
    const server = serveIstarGlsp({ shared, mcp: { ...HOST, dataMode: 'resources' } });
    cleanup.push(() => server.close());
    const client = await mcpClient(server.mcp.url, server.mcp.fetch);
    await server.mcp.ready;
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('sky-facts');
    const { resources } = await client.listResources();
    const uri = `glsp://diagrams/${server.sessionId}/context/sky-facts`;
    expect(resources.map((r) => r.uri)).toContain(uri);
    const read = await client.readResource({ uri });
    expect(read.contents).toEqual([
      expect.objectContaining({ text: 'The sky is blue in this test domain.' }),
    ]);
  });
});
