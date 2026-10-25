/**
 * One MCP tool call is one undo step, all or nothing (#223): whatever operations a tool
 * dispatches (server-mcp's `create-nodes` a node, then its label), the store hears one change.
 * In-page here; the worker launcher is covered in `worker-mcp.test.ts`.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ActionGuard, IstarAction } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore, parsePistar } from '@istar-ts/core';
import type { IstarSharedModel } from '../src';
import { ISTAR_GLSP, createIstarSharedModel, paletteOf } from '../src';
import type { IstarGlspMcp } from '../src/browser';
import { serveIstarGlsp } from '../src/browser';
import { fixture } from './fixtures';

const ACTOR_1 = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const ACTOR_2 = 'bda083fe-1fb4-41cf-aea9-449c0d4044b5';
const TASK = 'f9035e8c-0294-44a8-a93e-85a349d2f21a';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

async function mcpClient(mcp: IstarGlspMcp): Promise<Client> {
  const client = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcp.url, { fetch: mcp.fetch }));
  // #136: list first, as any agent harness does, so a rejection's answer is checked against
  // the cached output schemas.
  await client.listTools();
  cleanup.push(() => client.close());
  return client;
}

async function headless(
  shared: IstarSharedModel = createIstarSharedModel(ISTAR_GLSP, { model: welcome }),
) {
  const server = serveIstarGlsp({ shared, mcp: true });
  cleanup.push(() => server.close());
  const changes: IstarAction<string, string>[] = [];
  cleanup.push(
    shared.dispatcher.subscribe((action) => {
      if (action.kind === 'sourceModelChanged') changes.push(action);
    }),
  );
  const mcp = await mcpClient(server.mcp);
  const call = (name: string, args: Record<string, unknown>) =>
    mcp.callTool({ name, arguments: { sessionId: server.sessionId, ...args } });
  return { server, shared, changes, call };
}

const goal = (x: number, extra: Record<string, unknown> = {}) => ({
  elementTypeId: 'node:istar.Goal',
  position: { x, y: 300 },
  containerId: ACTOR_1,
  ...extra,
});

/** The `{ code: 'rejected', diagnostics }` block of a rejection's answer (#136). */
function rejection(content: unknown): unknown {
  for (const block of content as Array<{ text?: string }>) {
    try {
      const value = block.text ? (JSON.parse(block.text) as { code?: unknown }) : undefined;
      if (value?.code === 'rejected') return value;
    } catch {
      // Not JSON.
    }
  }
  return undefined;
}

describe('one MCP tool call, one undo step', () => {
  test('create-nodes with text: one glspUndo removes the named node', async () => {
    const { shared, changes, call } = await headless();
    const before = shared.store.getModel();
    const result = await call('create-nodes', { nodes: [goal(300, { text: 'G1' })] });
    expect(result.isError).toBeFalsy();
    const created = [...shared.store.getModel().elements.values()].filter(
      (e) => !before.elements.has(e.id),
    );
    expect(created).toMatchObject([{ kind: 'istar.Goal', name: 'G1', parent: ACTOR_1 }]);
    expect(changes).toHaveLength(1);

    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(before);
  });

  test('create-nodes with three nodes: one undo, through the undo tool too', async () => {
    const { shared, changes, call } = await headless();
    const before = shared.store.getModel();
    const result = await call('create-nodes', {
      nodes: [goal(200, { text: 'A' }), goal(300), goal(400, { text: 'C' })],
    });
    expect(result.isError).toBeFalsy();
    expect(shared.store.getModel().elements.size).toBe(before.elements.size + 3);
    expect(changes).toHaveLength(1);

    const undo = await call('undo', {});
    expect(undo.isError).toBeFalsy();
    expect(shared.store.getModel()).toBe(before);
  });

  test('modify-nodes over two nodes: one undo', async () => {
    const { shared, changes, call } = await headless();
    const before = shared.store.getModel();
    const result = await call('modify-nodes', {
      nodes: [
        { elementId: TASK, position: { x: 600, y: 400 } },
        { elementId: ACTOR_2, text: 'Renamed' },
      ],
    });
    expect(result.isError).toBeFalsy();
    const model = shared.store.getModel();
    expect(model.elements.get(TASK)).toMatchObject({ x: 600, y: 400 });
    expect(model.elements.get(ACTOR_2)).toMatchObject({ name: 'Renamed' });
    expect(changes).toHaveLength(1);

    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(before);
  });

  test('a node created and then edited by later calls: each call its own undo step', async () => {
    const { shared, call } = await headless();
    const before = shared.store.getModel();
    await call('create-nodes', { nodes: [goal(300, { text: 'G1' })] });
    const afterCreate = shared.store.getModel();
    await call('modify-nodes', { nodes: [{ elementId: TASK, position: { x: 700, y: 500 } }] });
    expect(shared.store.getModel().elements.get(TASK)).toMatchObject({ x: 700, y: 500 });

    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(afterCreate);
    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(before);
  });

  test('a guard refusing one item of a multi-item call: a typed error, nothing applied', async () => {
    const store = createModelStore(parsePistar(welcome));
    const refuse: ActionGuard = (operation) =>
      operation.kind === 'createNode' && operation.args?.name === 'Refused'
        ? [{ elementId: ACTOR_1, severity: 'error', message: 'not this one', code: 'demo' }]
        : undefined;
    const dispatcher = createActionDispatcher(store, {
      palette: paletteOf(ISTAR_GLSP),
      guards: [refuse],
    });
    const { changes, call } = await headless({ store, dispatcher });
    const before = store.getModel();
    const result = await call('create-nodes', {
      nodes: [goal(200, { text: 'Kept?' }), goal(300, { args: { name: 'Refused' } })],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(rejection(result.content)).toMatchObject({
      code: 'rejected',
      diagnostics: [{ code: 'demo', elementId: ACTOR_1, message: 'not this one' }],
    });
    expect(store.getModel()).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(changes).toHaveLength(0);
  });

  test('canLink refusing one edge of a multi-edge call: a typed error, nothing applied', async () => {
    const { shared, changes, call } = await headless();
    const accepted = await call('check-edge', {
      edgeType: 'edge:istar.DependencyLink',
      sourceElementId: ACTOR_1,
      targetElementId: ACTOR_2,
    });
    expect(accepted.structuredContent).toMatchObject({ isValid: true });
    const before = shared.store.getModel();
    const result = await call('create-edges', {
      edges: [
        // Accepted on its own: a dependency between the two actors.
        {
          elementTypeId: 'edge:istar.DependencyLink',
          sourceElementId: ACTOR_1,
          targetElementId: ACTOR_2,
        },
        // Refused: an actor can't be refined.
        {
          elementTypeId: 'edge:istar.AndRefinementLink',
          sourceElementId: TASK,
          targetElementId: ACTOR_2,
        },
      ],
    });
    expect(result.isError).toBe(true);
    expect(rejection(result.content)).toMatchObject({ code: 'rejected' });
    expect(shared.store.getModel()).toBe(before);
    expect(changes).toHaveLength(0);
  });

  test('an unknown id midway through a call: nothing applied', async () => {
    const { shared, changes, call } = await headless();
    const before = shared.store.getModel();
    const result = await call('modify-nodes', {
      nodes: [
        { elementId: ACTOR_1, position: { x: 900, y: 900 } },
        { elementId: 'no-such-id', position: { x: 10, y: 10 } },
      ],
    });
    expect(result.isError).toBe(true);
    expect(shared.store.getModel()).toBe(before);
    expect(changes).toHaveLength(0);
  });

  test('an istar tool (set-properties) is one step too', async () => {
    const { shared, changes, call } = await headless();
    const before = shared.store.getModel();
    const result = await call('set-properties', {
      elementId: TASK,
      properties: { A: '1', B: '2' },
    });
    expect(result.isError).toBeFalsy();
    expect(shared.store.getModel().elements.get(TASK)?.customProperties).toMatchObject({
      A: '1',
      B: '2',
    });
    expect(changes).toHaveLength(1);
    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(shared.store.getModel()).toBe(before);
  });
});
