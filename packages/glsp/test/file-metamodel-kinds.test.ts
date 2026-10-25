/**
 * #97: kinds a file's own `"metamodel"` block declares (`fileMetamodel: true`, the default) must
 * be creatable through GLSP, offered in its palette and type hints, and listed by the MCP
 * `element-types` tool — not just renderable, which `fixtures/extensions/fileMetamodel.txt`
 * already proved before this fix (the GModel followed `metamodelOf(model)` all along).
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { metamodelOf, parsePistar } from '@istar-ts/core';
import {
  CreateEdgeOperation,
  CreateNodeOperation,
  RequestContextActions,
} from '@eclipse-glsp/server';
import type { PaletteItem } from '@eclipse-glsp/server';
import { ISTAR_GLSP, createIstarServerModules, createIstarSharedModel } from '../src';
import { serveIstarGlsp } from '../src/browser';
import { fixture } from './fixtures';
import { files, next, open, openOn, startServer, validationSettled } from './server';

const FIXTURE_NAME = 'extensions/fileMetamodel.txt';
const AGENT = 'a1';
const PLANNING = 'p1'; // kind ra4.Planning (its pistarType maps "istar.Planning" onto it)
const PLAN = 'x1'; // kind ra4.Plan

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

describe('GLSP create operations for a file-declared kind', () => {
  test('createNode and createEdge succeed for kinds only the file’s own metamodel block adds', async () => {
    const fileMap = new Map([[FIXTURE_NAME, fixture(FIXTURE_NAME).text]]);
    const s = await open(ISTAR_GLSP, FIXTURE_NAME, { files: fileMap });
    expect(s.state.model.elements.get(PLANNING)?.kind).toBe('ra4.Planning');
    expect(s.state.model.elements.get(PLAN)?.kind).toBe('ra4.Plan');

    const before = s.state.model;
    await s.send(
      CreateNodeOperation.create('node:ra4.Plan', {
        containerId: AGENT,
        location: { x: 500, y: 400 },
      }),
    );
    const created = [...s.state.model.elements.values()].find(
      (e) => !before.elements.has(e.id) && e.kind === 'ra4.Plan',
    );
    expect(created).toBeDefined();

    await s.send(
      CreateEdgeOperation.create({
        elementTypeId: 'edge:ra4.GeneratesLink',
        sourceElementId: PLANNING,
        targetElementId: created!.id,
      }),
    );
    const link = [...s.state.model.links.values()].find(
      (l) => l.kind === 'ra4.GeneratesLink' && l.source === PLANNING && l.target === created!.id,
    );
    expect(link).toBeDefined();
  });

  test('an unknown type is still rejected, with a diagnostic', async () => {
    const fileMap = new Map([[FIXTURE_NAME, fixture(FIXTURE_NAME).text]]);
    const s = await open(ISTAR_GLSP, FIXTURE_NAME, { files: fileMap });
    const from = s.sent.length;
    const before = s.state.model;
    await s.send(CreateNodeOperation.create('node:ra4.Nothing'));
    expect(s.state.model).toBe(before);
    const message = s.sent.slice(from).find((m) => m.action.kind === 'message')!
      .action as unknown as { severity: string; message: string };
    expect(message.severity).toBe('ERROR');
    expect(message.message).toContain('is not a element type of');
  });

  test('the palette includes an entry for a file-declared kind the contribution never declared', async () => {
    const fileMap = new Map([[FIXTURE_NAME, fixture(FIXTURE_NAME).text]]);
    const s = await open(ISTAR_GLSP, FIXTURE_NAME, { files: fileMap });
    const from = s.sent.length;
    await s.send(
      RequestContextActions.create({
        contextId: 'tool-palette',
        editorContext: { selectedElementIds: [] },
      }),
    );
    const { actions } = s.sent.slice(from).find((m) => m.action.kind === 'setContextActions')!
      .action as unknown as { actions: { children: PaletteItem[] }[] };
    const entries = actions.flatMap((a) => a.children);
    const label = metamodelOf(s.state.model).elements.get('ra4.Plan')!.label;
    expect(entries.some((e) => e.label === label)).toBe(true);
  });
});

describe('MCP element-types for a file-declared kind', () => {
  test('lists the file’s own kinds alongside the contribution’s', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP, { model: fixture(FIXTURE_NAME).text });
    const server = serveIstarGlsp({ shared, mcp: true });
    cleanup.push(() => server.close());
    const client = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
    );
    cleanup.push(() => client.close());
    const types = await client.callTool({
      name: 'element-types',
      arguments: { sessionId: server.sessionId! },
    });
    const content = types.structuredContent as {
      nodeTypes: Array<{ id: string }>;
      edgeTypes: Array<{ id: string }>;
    };
    expect(content.nodeTypes.map((t) => t.id)).toContain('node:ra4.Plan');
    expect(content.edgeTypes.map((t) => t.id)).toContain('edge:ra4.GeneratesLink');
  });
});

describe('type hints follow the loaded model, even after the fact', () => {
  test('a shared store’s load that extends the metamodel re-sends setTypeHints to a session already open', async () => {
    const shared = createIstarSharedModel(ISTAR_GLSP);
    const { server, sent } = await startServer(files, createIstarServerModules({ shared }));
    const a = await openOn(server, sent, ISTAR_GLSP, undefined, { clientId: 'a' });
    await validationSettled(sent, 'a');
    expect(
      a.root.children?.some((c) => (c as { type?: string }).type === 'node:ra4.Plan'),
    ).toBeFalsy();

    const from = sent.length;
    const extended = parsePistar(fixture(FIXTURE_NAME).text, {
      metamodel: ISTAR_GLSP.metamodel,
      fileMetamodel: true,
    });
    shared.store.load(extended);

    const hints = await next(sent, 'setTypeHints', from, 'a');
    const shapeHints = (hints.action as unknown as { shapeHints: { elementTypeId: string }[] })
      .shapeHints;
    expect(shapeHints.map((h) => h.elementTypeId)).toContain('node:ra4.Plan');
  });
});
