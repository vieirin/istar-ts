/**
 * The in-page MCP server (`serveIstarGlsp`'s `mcp`): an MCP SDK client on the server's
 * same-realm `fetch`, over a shared store, headless or next to a GLSP client on a
 * `MessageChannel`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BaseJsonrpcGLSPClient } from '@eclipse-glsp/server';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';
import type { ActionGuard } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore, parsePistar } from '@istar-ts/core';
import { ISTAR_GLSP, createIstarSharedModel, paletteOf } from '../src';
import type { GlspPortLike, IstarGlspMcp } from '../src/browser';
import { ISTAR_MCP_SESSION_ID, serveIstarGlsp } from '../src/browser';
import { fixture } from './fixtures';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
// welcome.txt: a task inside AGENT, away from both the origin and AGENT's own x/y (530, 55).
const AGENT_TASK = 'f9035e8c-0294-44a8-a93e-85a349d2f21a';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

/** server-mcp 2.8.0's default tools (server and diagram scope; no `layout` without an engine). */
const DEFAULT_TOOLS = [
  'session-info',
  'element-types',
  'create-nodes',
  'create-edges',
  'delete-elements',
  'save-model',
  'validate-diagram',
  'diagram-model',
  'query-elements',
  'count-elements',
  'modify-nodes',
  'modify-edges',
  'undo',
  'redo',
  'get-selection',
  'set-selection',
  'set-view',
];

async function mcpClient(mcp: IstarGlspMcp): Promise<Client> {
  const client = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcp.url, { fetch: mcp.fetch }));
  cleanup.push(() => client.close());
  return client;
}

function headless(shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome })) {
  const server = serveIstarGlsp({ shared, mcp: true });
  cleanup.push(() => server.close());
  return { server, shared };
}

const goal = (name: string) => ({
  elementTypeId: 'node:istar.Goal',
  position: { x: 300, y: 300 },
  containerId: AGENT,
  args: { name },
});

const childrenOf = (model: { elements: ReadonlyMap<string, { parent?: string }> }, id: string) =>
  [...model.elements.values()].filter((e) => e.parent === id).length;

describe('serveIstarGlsp with mcp, headless', () => {
  test('tools/list answers server-mcp’s default tools', async () => {
    const { server } = headless();
    expect(server.sessionId).toBe(ISTAR_MCP_SESSION_ID);
    const mcp = await mcpClient(server.mcp);
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(DEFAULT_TOOLS));

    const info = await mcp.callTool({ name: 'session-info', arguments: {} });
    expect(info.structuredContent).toMatchObject({
      sessions: [{ sessionId: ISTAR_MCP_SESSION_ID, diagramType: 'istar' }],
    });
  });

  test('create-nodes creates the node in the shared store', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'create-nodes',
      arguments: { sessionId: server.sessionId, nodes: [goal('Agent goal')] },
    });
    expect(result.isError).toBeFalsy();
    const model = shared.store.getModel();
    expect(model.elements.size).toBe(before.elements.size + 1);
    const created = [...model.elements.values()].find((e) => !before.elements.has(e.id));
    expect(created).toMatchObject({ kind: 'istar.Goal', parent: AGENT, x: 300, y: 300 });
  });

  test('an operation a guard rejects answers the tool call with an error', async () => {
    const parsed = parsePistar(welcome);
    const store = createModelStore(parsed);
    const refuseCreate: ActionGuard = (operation) =>
      operation.kind === 'createNode'
        ? [{ elementId: AGENT, severity: 'error', message: 'no new nodes today', code: 'demo' }]
        : undefined;
    const dispatcher = createActionDispatcher(store, {
      palette: paletteOf(ISTAR_GLSP),
      guards: [refuseCreate],
    });
    const { server } = headless({ store, dispatcher });
    const mcp = await mcpClient(server.mcp);
    // #136: the SDK client caches `create-nodes`' output schema on `listTools()` and validates
    // a rejection's `structuredContent` against it even when `isError` is true — list first, as
    // any agent harness does, so this covers that path.
    await mcp.listTools();
    const before = store.getModel();
    const result = await mcp.callTool({
      name: 'create-nodes',
      arguments: { sessionId: server.sessionId, nodes: [goal('Refused')] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('no new nodes today');
    expect(result.structuredContent).toBeUndefined();
    const diagnosticsBlock = (result.content as Array<{ text?: string }>)
      .map((block) => {
        try {
          return block.text ? JSON.parse(block.text) : undefined;
        } catch {
          return undefined;
        }
      })
      .find((value) => Array.isArray((value as { diagnostics?: unknown })?.diagnostics));
    expect(diagnosticsBlock).toMatchObject({
      code: 'rejected',
      diagnostics: [{ code: 'demo', elementId: AGENT }],
    });
    expect(store.getModel()).toBe(before);
    expect(childrenOf(store.getModel(), AGENT)).toBe(childrenOf(before, AGENT));

    // The next call, accepted, is not an error.
    const query = await mcp.callTool({
      name: 'count-elements',
      arguments: { sessionId: server.sessionId },
    });
    expect(query.isError).toBeFalsy();
  });

  // #158: create-nodes' `position` is documented as absolute diagram coordinates; it already
  // lands exactly there (the `create-nodes creates the node...` test above asserts `x`/`y`
  // against AGENT's own non-zero origin). This covers the same contract without a container.
  test('create-nodes without a containerId creates the node at the given absolute position', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: server.sessionId,
        nodes: [{ elementTypeId: 'node:istar.Actor', position: { x: 120, y: 90 } }],
      },
    });
    expect(result.isError).toBeFalsy();
    const model = shared.store.getModel();
    const created = [...model.elements.values()].find((e) => !before.elements.has(e.id));
    expect(created).toMatchObject({ kind: 'istar.Actor', x: 120, y: 90 });
  });

  // #158: the default `MarkdownMcpModelSerializer` reports a `GNode`'s `position` straight from
  // the GModel tree, which is relative to an actor's boundary for its children — `IstarMcpModelSerializer`
  // reads the model's own (always absolute) x/y instead.
  test('query-elements reports a nested element’s absolute model position, not its GModel-relative one', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    const task = shared.store.getModel().elements.get(AGENT_TASK)!;
    const result = await mcp.callTool({
      name: 'query-elements',
      arguments: { sessionId: server.sessionId, elementIds: [AGENT_TASK] },
    });
    expect(result.isError).toBeFalsy();
    const elements = (
      result.structuredContent as { elements: Array<{ type: string; position: unknown }> }
    ).elements;
    const reported = elements.find((e) => e.type !== 'label')!;
    expect(reported).toMatchObject({ position: { x: task.x, y: task.y } });
  });

  // #158: `modify-nodes` documents `position` as parent-relative, matching `query-elements` —
  // but every agent-facing coordinate is absolute instead (`IstarModifyNodesMcpToolHandler`
  // converts it to parent-relative before building the `ChangeBoundsOperation`).
  test('modify-nodes moves a nested element to the given absolute position', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    const result = await mcp.callTool({
      name: 'modify-nodes',
      // The alias service falls back to the real id verbatim when it was never aliased.
      arguments: {
        sessionId: server.sessionId,
        nodes: [{ elementId: AGENT_TASK, position: { x: 600, y: 400 } }],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(shared.store.getModel().elements.get(AGENT_TASK)).toMatchObject({ x: 600, y: 400 });
  });

  // #158's actual repro: query an element's position, then create a new one there with the same
  // containerId — the agent's flow from the screenshot.
  test('create-nodes at a position read back from query-elements lands exactly there', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    const before = shared.store.getModel();
    const query = await mcp.callTool({
      name: 'query-elements',
      arguments: { sessionId: server.sessionId, elementIds: [AGENT_TASK] },
    });
    const elements = (
      query.structuredContent as {
        elements: Array<{ type: string; position: { x: number; y: number } }>;
      }
    ).elements;
    const reported = elements.find((e) => e.type !== 'label')!;
    const result = await mcp.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: server.sessionId,
        nodes: [
          { elementTypeId: 'node:istar.Goal', position: reported.position, containerId: AGENT },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const model = shared.store.getModel();
    const created = [...model.elements.values()].find((e) => !before.elements.has(e.id));
    expect(created).toMatchObject({
      kind: 'istar.Goal',
      x: reported.position.x,
      y: reported.position.y,
    });
  });
});

describe('serveIstarGlsp with mcp, next to a GLSP client', () => {
  test('the MCP server starts with the client’s initialize and acts on its session', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const { port1, port2 } = new MessageChannel();
    const server = serveIstarGlsp(port2 as unknown as GlspPortLike, { shared, mcp: true });
    cleanup.push(() => {
      server.close();
      port1.close();
    });
    let ready = false;
    void server.mcp.ready.then(() => (ready = true));
    const glsp = new BaseJsonrpcGLSPClient({
      id: 'page',
      connectionProvider: createMessageConnection(
        new BrowserMessageReader(port1 as never),
        new BrowserMessageWriter(port1 as never),
      ),
    });
    await glsp.start();
    await Promise.resolve();
    expect(ready).toBe(false);
    await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
    await glsp.initializeClientSession({
      clientSessionId: 'page',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    await server.mcp.ready;

    const mcp = await mcpClient(server.mcp);
    const info = await mcp.callTool({ name: 'session-info', arguments: {} });
    expect(info.structuredContent).toMatchObject({
      sessions: [{ sessionId: 'page', diagramType: 'istar' }],
    });
  });
});
