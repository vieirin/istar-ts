/**
 * Backend A against a fake MCP server: the real `@modelcontextprotocol/sdk` client and server,
 * connected in memory, with a few tools shaped like server-mcp's. Until #128 (D1) lands a browser
 * MCP server in `@istar-ts/glsp`, this is what stands in for it.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createChatClient, createMcpToolRegistry, runAgent } from '../src';
import type { McpToolClient } from '../src';
import { answer, lastToolResult, startMockModel, toolCalls } from './mock-model';
import type { MockModel } from './mock-model';

const TOOLS = [
  {
    name: 'element-types',
    description: 'List the element types.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create-nodes',
    description: 'Create nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { elementTypeId: { type: 'string' }, text: { type: 'string' } },
            required: ['elementTypeId'],
          },
        },
      },
      required: ['nodes'],
    },
  },
  {
    name: 'istar.set-properties',
    description: 'An istar tool (#129) that refuses with diagnostics.',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'save-model', description: 'Save.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'rejects-in-text',
    description: 'Refuses with diagnostics in a JSON text block.',
    inputSchema: { type: 'object', properties: {} },
  },
];

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
});

async function fakeMcp(): Promise<{ client: Client; created: string[] }> {
  const created: string[] = [];
  const server = new Server(
    { name: 'fake-glsp-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    if (name === 'element-types') {
      return { content: [{ type: 'text', text: JSON.stringify({ nodes: ['node:istar.Actor'] }) }] };
    }
    if (name === 'create-nodes') {
      const nodes = (args as { nodes: { elementTypeId: string }[] }).nodes;
      const bad = nodes.find((n) => !n.elementTypeId.startsWith('node:'));
      if (bad) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `unknown element type "${bad.elementTypeId}"; call element-types`,
            },
          ],
        };
      }
      created.push(...nodes.map((n) => n.elementTypeId));
      return { content: [{ type: 'text', text: `${nodes.length} nodes created` }] };
    }
    if (name === 'istar.set-properties') {
      return {
        isError: true,
        content: [{ type: 'image', data: '', mimeType: 'image/png' }],
        structuredContent: {
          diagnostics: [
            { elementId: 'g1', severity: 'error', message: 'bad value', code: 'invalid-property' },
          ],
        },
      };
    }
    if (name === 'rejects-in-text') {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'Rejected: no' },
          {
            type: 'text',
            text: JSON.stringify({
              code: 'rejected',
              diagnostics: [{ elementId: 'a', severity: 'error', message: 'no', code: 'demo' }],
            }),
          },
        ],
      };
    }
    throw new Error(`no tool ${name}`);
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'agent-test', version: '0.0.0' });
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, created };
}

describe('createMcpToolRegistry', () => {
  test('an SDK Client is an McpToolClient', async () => {
    const { client } = await fakeMcp();
    const typed: McpToolClient = client;
    expect(typed).toBe(client);
  });

  test('lists the tools as OpenAI-safe names, marking the read-only ones', async () => {
    const { client } = await fakeMcp();
    const registry = await createMcpToolRegistry(client, {
      exclude: ['save-model', 'rejects-in-text'],
    });
    expect(registry.list().map((s) => [s.name, s.readOnly ?? false])).toEqual([
      ['element-types', true],
      ['create-nodes', false],
      ['istar_set-properties', false],
    ]);
    expect(registry.list()[1]!.parameters).toEqual(TOOLS[1]!.inputSchema);
  });

  test('calls: JSON text is parsed, errors become refusals, typed diagnostics are kept', async () => {
    const { client } = await fakeMcp();
    const registry = await createMcpToolRegistry(client);
    expect(await registry.call('element-types', {})).toEqual({
      ok: true,
      content: { nodes: ['node:istar.Actor'] },
    });
    expect(await registry.call('create-nodes', { nodes: [{ elementTypeId: 'Actor' }] })).toEqual({
      ok: false,
      diagnostics: [
        {
          elementId: '',
          severity: 'error',
          message: 'unknown element type "Actor"; call element-types',
          code: 'tool-error',
        },
      ],
    });
    expect(await registry.call('istar_set-properties', {})).toEqual({
      ok: false,
      diagnostics: [
        { elementId: 'g1', severity: 'error', message: 'bad value', code: 'invalid-property' },
      ],
    });
    expect(await registry.call('rejects-in-text', {})).toEqual({
      ok: false,
      diagnostics: [{ elementId: 'a', severity: 'error', message: 'no', code: 'demo' }],
    });
    expect(await registry.call('nope', {})).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'unknown-tool' }],
    });
  });

  test('drives the loop: a refusal is repaired, then the model answers', async () => {
    const { client, created } = await fakeMcp();
    let mock: MockModel | undefined = await startMockModel((request, i) => {
      if (i === 0) return toolCalls(['create-nodes', { nodes: [{ elementTypeId: 'Actor' }] }]);
      // Refused: look the type ids up, then retry.
      if (i === 1 && lastToolResult(request).ok === false) return toolCalls(['element-types', {}]);
      if (i === 2)
        return toolCalls([
          'create-nodes',
          { nodes: [{ elementTypeId: 'node:istar.Actor', text: 'A' }] },
        ]);
      return answer('Created an actor.');
    });
    closers.push(async () => {
      await mock?.close();
      mock = undefined;
    });
    const { transcript } = await runAgent({
      client: createChatClient({ baseUrl: mock.baseUrl, model: 'm', apiKey: 'k' }),
      prompt: 'Add an actor.',
      approval: 'auto',
      tools: await createMcpToolRegistry(client),
    });
    expect(transcript.stop.reason).toBe('final');
    expect(
      transcript.steps.flatMap((s) => s.toolCalls.map((c) => [c.name, c.disposition, c.result.ok])),
    ).toEqual([
      ['create-nodes', 'applied', false],
      ['element-types', 'read', true],
      ['create-nodes', 'applied', true],
    ]);
    expect(created).toEqual(['node:istar.Actor']);
  });
});
