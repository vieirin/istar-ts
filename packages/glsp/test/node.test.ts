/**
 * The Node launcher (`@istar-ts/glsp/node`): a WebSocket GLSP server a stock client connects to,
 * and its MCP opt-in.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RequestModelAction } from '@eclipse-glsp/server';
import { ISTAR_GLSP, createIstarSharedModel } from '../src';
import type { IstarGlspNodeServer } from '../src/node';
import { diskPistarFiles, startIstarGlspServer } from '../src/node';
import { fixture } from './fixtures';
import { connect } from './glsp-client';
import { next } from './server';

const welcome = fixture('pistar/welcome.txt').text;
const running: Array<{ close(): Promise<unknown> | unknown }> = [];

afterEach(async () => {
  for (const thing of running.splice(0).toReversed()) await thing.close();
});

async function start(
  ...args: Parameters<typeof startIstarGlspServer>
): Promise<IstarGlspNodeServer> {
  const server = await startIstarGlspServer(...args);
  running.push(server);
  return server;
}

async function client(url: string) {
  const connection = await connect(url);
  running.push({ close: () => connection.socket.close() });
  return connection;
}

describe('the Node launcher', () => {
  test('accepts a connection and answers initialize with protocol version 1.0.0', async () => {
    const server = await start();
    expect(server.url).toBe(`ws://127.0.0.1:${server.port}/istar`);
    const { client: glsp } = await client(server.url);
    const result = await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
    expect(result.protocolVersion).toBe('1.0.0');
    expect(Object.keys(result.serverActions)).toContain('istar');
  });

  test('a session on a shared model gets its GModel', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const server = await start({ shared });
    const { client: glsp, received } = await client(server.url);
    await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
    await glsp.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    glsp.sendActionMessage({ clientId: 's1', action: RequestModelAction.create() });
    const { action } = await next(received, 'setModel');
    expect(JSON.stringify(action)).toContain('fcf67803-5e5a-4bae-8690-1f12af4446d6');
  });

  test('diskPistarFiles reads under its root and refuses anything outside it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'istar-glsp-'));
    writeFileSync(join(root, 'model.txt'), welcome);
    const files = diskPistarFiles(root);
    expect(await files.read('model.txt')).toBe(welcome);
    expect(await files.read(`file://${join(root, 'model.txt')}`)).toBe(welcome);
    expect(() => files.read('../model.txt')).toThrow(/outside/);
    expect(() => files.read('/etc/hosts')).toThrow(/outside/);
  });
});

describe('MCP', () => {
  test('is off by default', async () => {
    const server = await start();
    const { client: glsp } = await client(server.url);
    const result = await glsp.initializeServer({ applicationId: 'test', protocolVersion: '1.0.0' });
    expect(result).not.toHaveProperty('mcpServer');
  });

  test('opted in, session-info and element-types answer', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const server = await start({ shared, mcp: true });
    const { client: glsp } = await client(server.url);
    const result = (await glsp.initializeServer({
      applicationId: 'test',
      protocolVersion: '1.0.0',
    })) as { mcpServer?: { url: string } };
    const url = result.mcpServer!.url;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    await glsp.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });

    const mcp = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(url)));
    running.push(mcp);
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['session-info', 'element-types']));

    const info = await mcp.callTool({ name: 'session-info', arguments: {} });
    expect(info.isError).toBeFalsy();
    expect(info.structuredContent).toMatchObject({
      sessions: [{ sessionId: 's1', diagramType: 'istar' }],
    });

    const types = await mcp.callTool({ name: 'element-types', arguments: { sessionId: 's1' } });
    expect(types.isError).toBeFalsy();
    const content = types.structuredContent as {
      nodeTypes: Array<{ id: string }>;
      edgeTypes: Array<{ id: string }>;
    };
    expect(content.nodeTypes.map((t) => t.id)).toContain('node:istar.Goal');
    expect(content.edgeTypes.map((t) => t.id)).toContain('edge:istar.DependencyLink');
  });

  // #223: one tool call, one undo step — over the Node launcher as in-page and in the worker.
  test('create-nodes with text is one undo step', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const server = await start({ shared, mcp: true });
    const { client: glsp, received } = await client(server.url);
    const result = (await glsp.initializeServer({
      applicationId: 'test',
      protocolVersion: '1.0.0',
    })) as { mcpServer?: { url: string } };
    await glsp.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    glsp.sendActionMessage({ clientId: 's1', action: RequestModelAction.create() });
    await next(received, 'setModel');
    const mcp = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(result.mcpServer!.url)));
    running.push(mcp);

    const before = shared.store.getModel();
    const created = await mcp.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: 's1',
        nodes: [
          {
            elementTypeId: 'node:istar.Goal',
            position: { x: 300, y: 300 },
            containerId: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
            text: 'G1',
          },
        ],
      },
    });
    expect(created.isError).toBeFalsy();
    const names = [...shared.store.getModel().elements.values()]
      .filter((e) => !before.elements.has(e.id))
      .map((e) => e.name);
    expect(names).toEqual(['G1']);
    const undo = await mcp.callTool({ name: 'undo', arguments: { sessionId: 's1' } });
    expect(undo.isError).toBeFalsy();
    expect(shared.store.getModel()).toBe(before);
  });

  // #225: a tool call before the GLSP client's own `requestModel` must still create the node
  // (the shared model is already there) — never report success without an effect.
  test('create-nodes before requestModel still creates the node', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: welcome });
    const server = await start({ shared, mcp: true });
    const { client: glsp } = await client(server.url);
    const result = (await glsp.initializeServer({
      applicationId: 'test',
      protocolVersion: '1.0.0',
    })) as { mcpServer?: { url: string } };
    await glsp.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    // Deliberately no `RequestModelAction` here.

    const mcp = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(result.mcpServer!.url)));
    running.push(mcp);

    const before = shared.store.getModel();
    const created = await mcp.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: 's1',
        nodes: [
          {
            elementTypeId: 'node:istar.Goal',
            position: { x: 300, y: 300 },
            containerId: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
            text: 'G1',
          },
        ],
      },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({ errors: [] });
    const names = [...shared.store.getModel().elements.values()]
      .filter((e) => !before.elements.has(e.id))
      .map((e) => e.name);
    expect(names).toEqual(['G1']);
  });

  // #225 follow-up: a file-backed (non-shared) session has no model at all before `requestModel`
  // loads one — that must answer a typed tool error, never a success with no effect.
  test('create-nodes on a file-backed session before requestModel answers a typed error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'istar-glsp-'));
    writeFileSync(join(root, 'model.txt'), welcome);
    const files = diskPistarFiles(root);
    const server = await start({ files, mcp: true });
    const { client: glsp } = await client(server.url);
    const result = (await glsp.initializeServer({
      applicationId: 'test',
      protocolVersion: '1.0.0',
    })) as { mcpServer?: { url: string } };
    await glsp.initializeClientSession({
      clientSessionId: 's1',
      diagramType: 'istar',
      clientActionKinds: ['setModel', 'updateModel'],
    });
    // Deliberately no `RequestModelAction` here.

    const mcp = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(result.mcpServer!.url)));
    running.push(mcp);

    const created = await mcp.callTool({
      name: 'create-nodes',
      arguments: {
        sessionId: 's1',
        nodes: [
          {
            elementTypeId: 'node:istar.Goal',
            position: { x: 300, y: 300 },
            text: 'G1',
          },
        ],
      },
    });
    expect(created.isError).toBe(true);
    expect(JSON.stringify(created.content)).toContain('no-model');
  });
});
