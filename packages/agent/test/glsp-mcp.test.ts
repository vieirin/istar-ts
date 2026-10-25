/**
 * Backend A for real (#128, D1): `@istar-ts/glsp`'s in-page MCP server, headless over a shared
 * store, server-mcp 2.8.0's tools reached by an MCP SDK client on `server.mcp.fetch`. A guard's
 * rejection comes back as a typed refusal, and refusals stop the loop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionGuard } from '@istar-ts/actions';
import { createModelStore, parsePistar, toPistar } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { createChatClient, createMcpToolRegistry, runAgent } from '../src';
import { answer, lastToolResult, startMockModel, toolCalls } from './mock-model';
import type { RecordedRequest, Reply } from './mock-model';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const welcome = readFileSync(
  join(import.meta.dirname, '../../../fixtures/pistar/welcome.txt'),
  'utf8',
);
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

const goal = (name: string) => ({
  elementTypeId: 'node:istar.Goal',
  position: { x: 300, y: 300 },
  containerId: AGENT,
  args: { name },
});

const refuse: ActionGuard = (operation) =>
  operation.kind === 'createNode'
    ? [{ elementId: AGENT, severity: 'error', message: 'no new nodes today', code: 'demo' }]
    : undefined;

async function setup(guards: ActionGuard[] = []) {
  const store = createModelStore(parsePistar(welcome));
  const dispatcher = createActionDispatcher(store, { palette: paletteOf(ISTAR_GLSP), guards });
  const server = serveIstarGlsp({ shared: { store, dispatcher }, mcp: true });
  cleanup.push(() => server.close());
  const client = new Client({ name: 'agent-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
  );
  cleanup.push(() => client.close());
  const tools = await createMcpToolRegistry(client, {
    boundArgs: { sessionId: server.sessionId! },
    exclude: ['save-model'],
  });
  return { store, tools };
}

async function chat(reply: (request: RecordedRequest, index: number) => Reply) {
  const mock = await startMockModel(reply);
  cleanup.push(() => mock.close());
  return createChatClient({ baseUrl: mock.baseUrl, model: 'deepseek-flash', apiKey: 'test' });
}

describe('backend A over serveIstarGlsp({ mcp: true })', () => {
  test("server-mcp's tools, sessionId bound and hidden from the model", async () => {
    const { tools } = await setup();
    const specs = tools.list();
    const names = specs.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['element-types', 'create-nodes', 'query-elements']),
    );
    expect(names).not.toContain('save-model');
    // Listed by server-mcp, but not servable for istar and no use to a text-only model (#157).
    expect(names).not.toContain('diagram-png');
    expect(names).not.toContain('diagram-svg');
    expect(
      specs
        .filter((s) => s.readOnly)
        .map((s) => s.name)
        .toSorted(),
    ).toEqual([
      'check-edge',
      'count-elements',
      'diagram-model',
      'element-types',
      'get-selection',
      'query-elements',
      'session-info',
      'validate-diagram',
    ]);
    for (const spec of specs) {
      expect(JSON.stringify(spec.parameters)).not.toContain('"sessionId"');
    }
  });

  test('a run creates a node in the shared store through the MCP tools', async () => {
    const { store, tools } = await setup();
    const before = store.getModel();
    const client = await chat((_, i) =>
      i === 0
        ? toolCalls(['element-types', {}])
        : i === 1
          ? toolCalls(['create-nodes', { nodes: [goal('Agent goal')] }])
          : answer('Added a goal.'),
    );
    const { transcript } = await runAgent({
      client,
      prompt: 'Add a goal.',
      approval: 'auto',
      tools,
    });
    expect(transcript.stop.reason).toBe('final');
    expect(
      transcript.steps.flatMap((s) => s.toolCalls.map((c) => [c.name, c.disposition, c.result.ok])),
    ).toEqual([
      ['element-types', 'read', true],
      ['create-nodes', 'applied', true],
    ]);
    const created = [...store.getModel().elements.values()].filter(
      (e) => !before.elements.has(e.id),
    );
    expect(created).toMatchObject([{ kind: 'istar.Goal', name: 'Agent goal', parent: AGENT }]);
  });

  test("a guard's rejection is a refusal; three in a row stop the run", async () => {
    const { store, tools } = await setup([refuse]);
    const before = toPistar(store.getModel());
    const client = await chat((_, i) => toolCalls(['create-nodes', { nodes: [goal(`Try ${i}`)] }]));
    const { transcript } = await runAgent({
      client,
      prompt: 'Add goals.',
      approval: 'auto',
      tools,
    });
    expect(transcript.stop.reason).toBe('refusals');
    expect(transcript.steps).toHaveLength(3);
    expect(transcript.steps.every((s) => s.toolCalls[0]!.result.ok === false)).toBe(true);
    expect(toPistar(store.getModel())).toBe(before);
  });

  test("the model reads the guard's typed diagnostics back", async () => {
    const { tools } = await setup([refuse]);
    const seen: unknown[] = [];
    const client = await chat((request, i) => {
      if (i > 0) seen.push(lastToolResult(request));
      return i === 0 ? toolCalls(['create-nodes', { nodes: [goal('Refused')] }]) : answer('ok');
    });
    await runAgent({ client, prompt: 'Add a goal.', approval: 'auto', tools });
    expect(seen[0]).toEqual({
      ok: false,
      diagnostics: [
        { elementId: AGENT, severity: 'error', message: 'no new nodes today', code: 'demo' },
      ],
    });
  });
});
