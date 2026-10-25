/**
 * The istar-specific MCP diagram tools (#129, D2 of the agent epic #126): `set-properties`,
 * `set-link-value` and `check-edge`, loaded into every session's container next to server-mcp's
 * own tools (`src/mcp-tools.ts`).
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ISTAR_GLSP, createIstarSharedModel } from '../src';
import type { IstarGlspMcp } from '../src/browser';
import { serveIstarGlsp } from '../src/browser';
import { fixture } from './fixtures';

const ACTOR_1 = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
const ACTOR_2 = 'bda083fe-1fb4-41cf-aea9-449c0d4044b5';
const TASK = 'f9035e8c-0294-44a8-a93e-85a349d2f21a';
const CONTRIBUTION_LINK = '5c3a554c-5988-48ec-b2c7-293b8e1db746';
const welcome = fixture('pistar/welcome.txt').text;
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

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

describe('set-properties', () => {
  test('sets and clears custom properties, visible through requestModel afterwards', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    await mcp.listTools();
    const result = await mcp.callTool({
      name: 'set-properties',
      arguments: {
        sessionId: server.sessionId,
        elementId: TASK,
        properties: { Since: null, Extra: 'added' },
      },
    });
    expect(result.isError).toBeFalsy();
    const element = shared.store.getModel().elements.get(TASK);
    expect(element?.customProperties).toMatchObject({ Extra: 'added' });
    expect(element?.customProperties).not.toHaveProperty('Since');
  });

  test('an unknown element id is a tool error, nothing changed', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    await mcp.listTools();
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'set-properties',
      arguments: { sessionId: server.sessionId, elementId: 'no-such-id', properties: { a: 'b' } },
    });
    expect(result.isError).toBe(true);
    expect(shared.store.getModel()).toBe(before);
  });
});

describe('set-link-value', () => {
  test('accepts a value of the link kind’s declared set', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    await mcp.listTools();
    const result = await mcp.callTool({
      name: 'set-link-value',
      arguments: { sessionId: server.sessionId, linkId: CONTRIBUTION_LINK, value: 'make' },
    });
    expect(result.isError).toBeFalsy();
    expect(shared.store.getModel().links.get(CONTRIBUTION_LINK)?.label).toBe('make');
  });

  test('a guard rejection (a value outside the declared set) is a tool error, not a thrown schema error', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    // #136: listing tools first caches the output schema the SDK would otherwise validate a
    // rejection's `structuredContent` against — our tools must not carry one either.
    await mcp.listTools();
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'set-link-value',
      arguments: { sessionId: server.sessionId, linkId: CONTRIBUTION_LINK, value: 'bogus' },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain('bogus');
    expect(shared.store.getModel()).toBe(before);
  });
});

describe('check-edge', () => {
  test('a valid candidate edge answers true, without creating anything', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    await mcp.listTools();
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'check-edge',
      arguments: {
        sessionId: server.sessionId,
        edgeType: 'edge:istar.DependencyLink',
        sourceElementId: ACTOR_1,
        targetElementId: ACTOR_2,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ isValid: true });
    expect(shared.store.getModel()).toBe(before);
  });

  test('an invalid candidate edge answers false with a reason, without creating anything', async () => {
    const { server, shared } = headless();
    const mcp = await mcpClient(server.mcp);
    await mcp.listTools();
    const before = shared.store.getModel();
    const result = await mcp.callTool({
      name: 'check-edge',
      arguments: {
        sessionId: server.sessionId,
        edgeType: 'edge:istar.DependencyLink',
        sourceElementId: ACTOR_1,
        targetElementId: ACTOR_1,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ isValid: false });
    expect((result.structuredContent as { reason?: string }).reason).toBeTruthy();
    expect(shared.store.getModel()).toBe(before);
  });
});

describe('tools/list', () => {
  test('includes set-properties, set-link-value and check-edge alongside the server-mcp defaults', async () => {
    const { server } = headless();
    const mcp = await mcpClient(server.mcp);
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'set-properties',
        'set-link-value',
        'check-edge',
        'create-nodes',
        'create-edges',
      ]),
    );
  });
});
