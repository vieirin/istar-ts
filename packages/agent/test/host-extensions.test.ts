/**
 * A host's context providers and tools (#175), defined once, in the harness: providers become
 * system-prompt sections; tools are listed and called on backend B (`hostTools`) and backend A
 * (`@istar-ts/glsp`'s MCP launchers' `hostTools`), and in Propose mode a read-only host tool is
 * run straight away, never a review step, while a mutating one's edits are replayed by `apply`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createActionDispatcher, metamodelContext, metamodelContextText } from '@istar-ts/actions';
import type { ActionGuard, HostContextProvider, HostTool } from '@istar-ts/actions';
import { createModelStore, metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type { AnyMetamodel } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import type { ChangeSetTarget, ToolRegistry } from '../src';
import {
  DEFAULT_SYSTEM_PROMPT,
  createActionChangeSet,
  createActionToolRegistry,
  createChatClient,
  createMcpToolRegistry,
  runAgent,
  systemPromptWith,
} from '../src';
import { answer, lastToolResult, startMockModel, toolCalls } from './mock-model';
import type { MockModel, RecordedRequest, Reply } from './mock-model';

const TASK = 'f9035e8c-0294-44a8-a93e-85a349d2f21a';
const welcome = readFileSync(
  join(import.meta.dirname, '../../../fixtures/pistar/welcome.txt'),
  'utf8',
);
const cleanup: (() => unknown)[] = [];
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
const RESOURCE_ONLY: HostContextProvider = {
  name: 'resource-only',
  text: 'Not in the prompt.',
  prompt: false,
};
const CONTEXT = [SKY, SIZE, RESOURCE_ONLY];

const ECHO_FACT: HostTool = {
  name: 'echo-fact',
  description: 'Answers a fact about a topic.',
  inputSchema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  readOnly: true,
  handler: (args) => ({ ok: true, content: { topic: args.topic as string, fact: 'blue' } }),
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
    return result.ok ? { ok: true, content: 'stamped' } : result;
  },
};
const HOST_TOOLS = [ECHO_FACT, STAMP];

const noForbiddenStamp: ActionGuard = (operation) =>
  operation.kind === 'istar.updateProperties' && operation.properties.Stamp === 'forbidden'
    ? [{ elementId: operation.elementId, severity: 'error', message: 'no', code: 'host-guard' }]
    : undefined;

function live() {
  const store = createModelStore(parsePistar(welcome));
  const dispatcher = createActionDispatcher(store, {
    palette: paletteOf(ISTAR_GLSP),
    guards: [noForbiddenStamp],
  });
  return { store, dispatcher };
}

async function model(reply: (request: RecordedRequest, index: number) => Reply) {
  const mock: MockModel = await startMockModel(reply);
  cleanup.push(() => mock.close());
  const client = createChatClient({
    baseUrl: mock.baseUrl,
    model: 'deepseek-flash',
    apiKey: 'test',
  });
  return { mock, client };
}

/** Echo, then stamp (ok), then stamp (refused by the guard), then done. */
const script = (_: RecordedRequest, i: number): Reply =>
  i === 0
    ? toolCalls(
        ['echo-fact', { topic: 'sky' }],
        ['stamp', { elementId: TASK, value: 'ok' }],
        ['stamp', { elementId: TASK, value: 'forbidden' }],
      )
    : answer('Done.');

describe('context providers', () => {
  test("their text is spliced into the system prompt runAgent sends, after the host's", async () => {
    const { store, dispatcher } = live();
    const { mock, client } = await model(() => answer('Hi.'));
    await runAgent({
      client,
      prompt: 'Hello',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      context: CONTEXT,
      getModel: store.getModel,
    });
    const system = mock.requests[0]!.body.messages[0]!;
    expect(system.role).toBe('system');
    const metamodelSection = metamodelContextText(
      metamodelContext(metamodelOf(store.getModel()) as AnyMetamodel),
    );
    expect(system.content).toBe(
      [
        DEFAULT_SYSTEM_PROMPT,
        `## This model's language\n\n${metamodelSection}`,
        '## Sky facts\n\nThe sky is blue in this test domain.',
        `## model-size\n\nThe model has ${store.getModel().elements.size} elements.`,
      ].join('\n\n'),
    );
  });

  test('a provider that reads the model needs getModel', async () => {
    await expect(systemPromptWith('base', [SIZE])).rejects.toThrow(/getModel/);
    await expect(systemPromptWith('base', [SKY])).resolves.toContain('The sky is blue');
  });

  test('is on by default, before the host’s own providers, opt-out: metamodelContext: false', async () => {
    const { store } = live();
    const withDefault = await systemPromptWith('base', [SKY], store.getModel);
    expect(withDefault).toContain("## This model's language");
    expect(withDefault.indexOf("## This model's language")).toBeLessThan(
      withDefault.indexOf('## Sky facts'),
    );
    const optedOut = await systemPromptWith('base', [SKY], store.getModel, false);
    expect(optedOut).not.toContain("This model's language");
  });
});

describe('host tools on backend B', () => {
  test('are listed after the action tools, read-only ones marked', () => {
    const { store, dispatcher } = live();
    const registry = createActionToolRegistry(dispatcher, {
      hostTools: HOST_TOOLS,
      getModel: store.getModel,
    });
    const specs = registry.list();
    expect(specs.slice(-2)).toEqual([
      {
        name: 'echo-fact',
        description: ECHO_FACT.description,
        parameters: ECHO_FACT.inputSchema,
        readOnly: true,
      },
      { name: 'stamp', description: STAMP.description, parameters: STAMP.inputSchema },
    ]);
    expect(() => createActionToolRegistry(dispatcher, { hostTools: HOST_TOOLS })).toThrow(
      /getModel/,
    );
  });

  test('Auto: calls go through the dispatcher and its guards, a refusal typed', async () => {
    const { store, dispatcher } = live();
    const { mock, client } = await model(script);
    const { transcript } = await runAgent({
      client,
      prompt: 'Stamp the task.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher, {
        hostTools: HOST_TOOLS,
        getModel: store.getModel,
      }),
    });
    const calls = transcript.steps[0]!.toolCalls;
    expect(calls.map((c) => [c.name, c.disposition, c.result.ok])).toEqual([
      ['echo-fact', 'read', true],
      ['stamp', 'applied', true],
      ['stamp', 'applied', false],
    ]);
    expect(calls[0]!.result).toMatchObject({ content: { topic: 'sky', fact: 'blue' } });
    expect(lastToolResult(mock.requests[1]!)).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'host-guard', elementId: TASK })],
    });
    expect(store.getModel().elements.get(TASK)?.customProperties?.Stamp).toBe('ok');
    // One undo stack: the host tool's edit is the dispatcher's last step.
    store.undo();
    expect(store.getModel().elements.get(TASK)?.customProperties).not.toHaveProperty('Stamp');
  });

  test('Propose: the read-only tool is no review step; the edit is replayed by apply', async () => {
    const { store, dispatcher } = live();
    const before = toPistar(store.getModel());
    const { client } = await model(script);
    const target = createActionChangeSet({
      dispatcher,
      getModel: store.getModel,
      guards: [noForbiddenStamp],
      hostTools: HOST_TOOLS,
    });
    const { transcript, changeSet } = await runAgent({
      client,
      prompt: 'Stamp the task.',
      changeSet: target,
    });
    expect(transcript.steps[0]!.toolCalls.map((c) => c.disposition)).toEqual([
      'read',
      'proposed',
      'proposed',
    ]);
    expect(changeSet.map((e) => [e.name, e.result.ok])).toEqual([
      ['stamp', true],
      ['stamp', false],
    ]);
    expect(toPistar(store.getModel())).toBe(before);

    const applied = await target.apply(changeSet);
    expect(applied.ok).toBe(true);
    expect(store.getModel().elements.get(TASK)?.customProperties?.Stamp).toBe('ok');
    store.undo();
    expect(toPistar(store.getModel())).toBe(before);
  });
});

describe('host tools on backend A', () => {
  async function mcpTools(): Promise<{ tools: ToolRegistry } & ReturnType<typeof live>> {
    const shared = live();
    const server = serveIstarGlsp({ shared, mcp: { hostTools: HOST_TOOLS, context: CONTEXT } });
    cleanup.push(() => server.close());
    const client = new Client({ name: 'agent-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
    );
    cleanup.push(() => client.close());
    const tools = await createMcpToolRegistry(client, {
      boundArgs: { sessionId: server.sessionId! },
    });
    return { tools, ...shared };
  }

  test('are listed with the istar tools, read-only by their readOnlyHint, sessionId bound', async () => {
    const { tools } = await mcpTools();
    const specs = new Map(tools.list().map((s) => [s.name, s]));
    expect(specs.get('echo-fact')).toMatchObject({ readOnly: true });
    expect(specs.get('echo-fact')?.parameters).toMatchObject({
      properties: { topic: { type: 'string' } },
    });
    expect(specs.get('echo-fact')?.parameters.properties).not.toHaveProperty('sessionId');
    expect(specs.get('stamp')?.readOnly).toBeUndefined();
    expect(specs.has('set-properties')).toBe(true);
    // A provider, listed as a tool (server-mcp's default dataMode), is a read.
    expect(specs.get('sky-facts')).toMatchObject({ readOnly: true });
    expect(await tools.call('sky-facts', {})).toEqual({
      ok: true,
      content: 'The sky is blue in this test domain.',
    });
  });

  test('Propose over MCP: the read-only host tool is no review step', async () => {
    const { tools, store } = await mcpTools();
    const before = toPistar(store.getModel());
    const { client } = await model((_, i) =>
      i === 0 ? toolCalls(['echo-fact', { topic: 'sky' }]) : answer('Blue.'),
    );
    // A scratch over MCP is the host's to provide; the live session stands in for one here.
    const target: ChangeSetTarget = {
      openScratch: () => ({ registry: tools }),
      apply: () => Promise.resolve({ ok: true, content: null }),
    };
    const { transcript, changeSet } = await runAgent({
      client,
      prompt: 'What colour is the sky?',
      changeSet: target,
    });
    const [call] = transcript.steps[0]!.toolCalls;
    expect(call).toMatchObject({ name: 'echo-fact', disposition: 'read' });
    expect(call!.result).toEqual({ ok: true, content: { topic: 'sky', fact: 'blue' } });
    expect(changeSet).toEqual([]);
    expect(toPistar(store.getModel())).toBe(before);
  });

  test('Auto over MCP: a mutating host tool refused by a guard is a typed refusal', async () => {
    const { tools, store } = await mcpTools();
    const refused = await tools.call('stamp', { elementId: TASK, value: 'forbidden' });
    expect(refused).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'host-guard', elementId: TASK })],
    });
    const ok = await tools.call('stamp', { elementId: TASK, value: 'ok' });
    expect(ok.ok).toBe(true);
    expect(store.getModel().elements.get(TASK)?.customProperties?.Stamp).toBe('ok');
  });
});
