import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionDispatcher, IstarAction } from '@istar-ts/actions';
import { ISTAR_2_0, createModelStore, parsePistar, toPistar } from '@istar-ts/core';
import type { IstarModel } from '@istar-ts/core';
import {
  createActionChangeSet,
  createActionToolRegistry,
  createChatClient,
  costPerMillionTokens,
  runAgent,
} from '../src';
import type { ChatClient } from '../src';
import { answer, lastToolResult, startMockModel, toolCalls, toolResults } from './mock-model';
import type { MockModel, Reply, RecordedRequest } from './mock-model';

const FAKE_KEY = 'sk-test-0123456789abcdefFAKEKEY';

let mock: MockModel | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function model(
  reply: (request: RecordedRequest, index: number) => Reply,
  config: { stream?: boolean } = {},
): Promise<ChatClient> {
  mock = await startMockModel(reply);
  return createChatClient({
    baseUrl: mock.baseUrl,
    model: 'deepseek-flash',
    apiKey: FAKE_KEY,
    ...config,
  });
}

function liveStore(initial?: IstarModel) {
  const store = initial
    ? createModelStore(initial)
    : createModelStore(undefined, { metamodel: ISTAR_2_0 });
  const dispatcher = createActionDispatcher(store);
  return { store, dispatcher };
}

function welcome(): IstarModel {
  const text = readFileSync(
    join(import.meta.dirname, '../../../fixtures/pistar/welcome.txt'),
    'utf8',
  );
  return parsePistar(text);
}

function spy(dispatcher: ActionDispatcher): {
  dispatcher: ActionDispatcher;
  sent: IstarAction[];
} {
  const sent: IstarAction[] = [];
  return {
    sent,
    dispatcher: {
      dispatch: (action) => {
        sent.push(action);
        return dispatcher.dispatch(action);
      },
      subscribe: (listener) => dispatcher.subscribe(listener),
    },
  };
}

const chunk = (delta: unknown, finish: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
});

describe('runAgent', () => {
  test('a full tool-call round trip: request a tool, run it, append the result, answer', async () => {
    const client = await model((_, i) =>
      i === 0
        ? toolCalls(['createNode', { elementTypeId: 'istar.Actor', args: { name: 'Auditor' } }])
        : answer('Added the Auditor actor.'),
    );
    const { store, dispatcher } = liveStore();
    const { transcript, changeSet } = await runAgent({
      client,
      prompt: 'Add an auditor.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
    });

    expect(transcript.stop).toEqual({ reason: 'final' });
    expect(transcript.steps).toHaveLength(2);
    expect(changeSet).toEqual([]);
    const actor = [...store.getModel().elements.values()].find((e) => e.name === 'Auditor');
    expect(actor?.kind).toBe('istar.Actor');

    // The second request carries the tool result, with the created id.
    const second = mock!.requests[1]!;
    expect(lastToolResult(second)).toEqual({ ok: true, result: { createdIds: [actor!.id] } });
    expect(second.body.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    // The tools reach the model in OpenAI's shape, dots replaced.
    const names = mock!.requests[0]!.body.tools!.map((t) => t.function.name);
    expect(names).toContain('createNode');
    expect(names).toContain('istar_setLinkValue');

    const [call] = transcript.steps[0]!.toolCalls;
    expect(call).toMatchObject({
      name: 'createNode',
      disposition: 'applied',
      result: { ok: true },
    });
    expect(transcript.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'Added the Auditor actor.',
    });
    expect(transcript.usage).toEqual({
      promptTokens: 200,
      completionTokens: 40,
      totalTokens: 240,
      cacheHitTokens: 0,
      reasoningTokens: 0,
    });
  });

  test('a refused call reaches the model as typed diagnostics it can repair against', async () => {
    const client = await model((request, i) => {
      if (i === 0) return toolCalls(['createNode', { elementTypeId: 'istar.Goal' }]);
      const last = lastToolResult(request);
      // The model reacts to the diagnostic's code: a goal must be inside an actor, so it creates
      // one, then the goal in it.
      if (i === 1 && last.ok === false && last.diagnostics[0]?.code === 'container') {
        return toolCalls(['createNode', { elementTypeId: 'istar.Actor', args: { id: 'a1' } }]);
      }
      if (i === 2) {
        return toolCalls(['createNode', { elementTypeId: 'istar.Goal', containerId: 'a1' }]);
      }
      return answer('done');
    });
    const { store, dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'Add a goal.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
    });
    expect(transcript.stop.reason).toBe('final');
    expect(transcript.steps[0]!.toolCalls[0]!.result).toEqual({
      ok: false,
      diagnostics: [
        {
          elementId: '',
          severity: 'error',
          message: 'a Goal must be created inside an actor',
          code: 'container',
        },
      ],
    });
    expect([...store.getModel().elements.values()].map((e) => e.kind).toSorted()).toEqual([
      'istar.Actor',
      'istar.Goal',
    ]);
  });

  test('three refusals in a row stop the loop; a success in between resets the count', async () => {
    const bad = toolCalls([
      'createEdge',
      {
        elementTypeId: 'istar.AndRefinementLink',
        sourceElementId: 'nope',
        targetElementId: 'nada',
      },
    ]);
    const client = await model((_, i) => (i === 1 ? toolCalls(['requestModel', {}]) : bad));
    const { dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'Link them.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
    });
    // refused, ok, refused, refused, refused → stop.
    expect(transcript.stop).toEqual({
      reason: 'refusals',
      message: '3 tool calls in a row were refused',
    });
    expect(mock!.requests).toHaveLength(5);
  });

  test('refusals within one response count too, and leftover calls are answered', async () => {
    const call = ['istar_removeLeg', { legId: 'missing' }] as const;
    const client = await model(() => toolCalls(call, call, call, call));
    const { dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'x',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      maxRefusals: 2,
    });
    expect(transcript.stop.reason).toBe('refusals');
    expect(transcript.steps[0]!.toolCalls).toHaveLength(2);
    // Every tool call id has an answer, so the conversation can be continued.
    const tools = transcript.messages.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(4);
    expect(JSON.parse(tools[3]!.content).diagnostics[0].code).toBe('not-run');
  });

  test('maxSteps stops the loop mid-run', async () => {
    const client = await model(() => toolCalls(['requestModel', {}]));
    const { dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'Keep reading.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      maxSteps: 2,
    });
    expect(transcript.stop).toEqual({ reason: 'max-steps' });
    expect(mock!.requests).toHaveLength(2);
    expect(transcript.steps.flatMap((s) => s.toolCalls)).toHaveLength(2);
  });

  test('an AbortSignal stops the loop between steps', async () => {
    const client = await model(() => toolCalls(['requestModel', {}]));
    const { dispatcher } = liveStore();
    const controller = new AbortController();
    const { transcript } = await runAgent({
      client,
      prompt: 'Keep reading.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'tool-call') controller.abort();
      },
    });
    expect(transcript.stop).toEqual({ reason: 'aborted' });
    expect(mock!.requests).toHaveLength(1);
  });

  test('an AbortSignal stops a model call in flight', async () => {
    const client = await model((_, i) =>
      i === 0 ? toolCalls(['requestModel', {}]) : { hang: true },
    );
    const { dispatcher } = liveStore();
    const controller = new AbortController();
    const run = runAgent({
      client,
      prompt: 'Keep reading.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      signal: controller.signal,
    });
    while (mock!.requests.length < 2) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const { transcript } = await run;
    expect(transcript.stop).toEqual({ reason: 'aborted' });
    expect(transcript.steps).toHaveLength(1);
  });

  test('a token budget stops the loop before the next model call', async () => {
    const client = await model(() => toolCalls(['requestModel', {}]));
    const { dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'x',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      budget: { maxTokens: 300 },
    });
    // 120 tokens a response: 120, 240, 360 ≥ 300.
    expect(transcript.stop).toEqual({ reason: 'budget' });
    expect(mock!.requests).toHaveLength(3);
  });

  test('a cost budget, from per-million prices', async () => {
    const client = await model(() => toolCalls(['requestModel', {}]));
    const { dispatcher } = liveStore();
    const cost = costPerMillionTokens({ input: 1000, output: 10_000 });
    const { transcript } = await runAgent({
      client,
      prompt: 'x',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      budget: { cost, maxCost: 0.5 },
    });
    // (100 × 1000 + 20 × 10 000) / 1e6 = 0.3 a response.
    expect(transcript.stop.reason).toBe('budget');
    expect(transcript.cost).toBeCloseTo(0.6);
    expect(mock!.requests).toHaveLength(2);
  });

  test('a failing chat API stops the run with an error, without the key in it', async () => {
    const client = await model((request) => ({
      status: 401,
      text: `bad key, you sent ${request.headers.authorization}`,
    }));
    const { dispatcher } = liveStore();
    const { transcript } = await runAgent({
      client,
      prompt: 'x',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
    });
    expect(transcript.stop.reason).toBe('error');
    expect(transcript.stop.message).toContain('401');
    expect(transcript.stop.message).toContain('[redacted]');
    expect(JSON.stringify(transcript)).not.toContain(FAKE_KEY);
  });

  test('streaming: text deltas and tool calls in fragments are assembled', async () => {
    const client = await model(
      (_, i) =>
        i === 0
          ? {
              sse: [
                chunk({ role: 'assistant', content: 'Let me ' }),
                chunk({ content: 'look.' }),
                chunk({
                  tool_calls: [
                    {
                      index: 0,
                      id: 'c1',
                      type: 'function',
                      function: { name: 'createNode', arguments: '' },
                    },
                  ],
                }),
                chunk({ tool_calls: [{ index: 0, function: { arguments: '{"elementTypeId":' } }] }),
                chunk({ tool_calls: [{ index: 0, function: { arguments: '"istar.Actor"}' } }] }),
                chunk({}, 'tool_calls'),
                {
                  choices: [],
                  usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
                },
              ],
            }
          : { sse: [chunk({ content: 'Done.' }, 'stop')] },
      { stream: true },
    );
    const { store, dispatcher } = liveStore();
    const deltas: string[] = [];
    const { transcript } = await runAgent({
      client,
      prompt: 'x',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
      onEvent: (event) => {
        if (event.type === 'delta' && event.delta.content) deltas.push(event.delta.content);
      },
    });
    expect(mock!.requests[0]!.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(deltas).toEqual(['Let me ', 'look.', 'Done.']);
    expect(transcript.steps[0]!.message).toEqual({
      role: 'assistant',
      content: 'Let me look.',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'createNode', arguments: '{"elementTypeId":"istar.Actor"}' },
        },
      ],
    });
    expect(transcript.steps[0]!.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    });
    expect(store.getModel().elements.size).toBe(1);
    expect(transcript.stop.reason).toBe('final');
  });

  test('the transcript, serialized, contains no substring of the API key', async () => {
    const client = await model((_, i) =>
      i === 0 ? toolCalls(['createNode', { elementTypeId: 'istar.Actor' }]) : answer('ok'),
    );
    const { dispatcher } = liveStore();
    const run = await runAgent({
      client,
      prompt: 'Add an actor.',
      approval: 'auto',
      tools: createActionToolRegistry(dispatcher),
    });
    // The key was used...
    expect(mock!.requests[0]!.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    // ...but no 6-character piece of it is anywhere in the run.
    const json = JSON.stringify(run);
    for (let i = 0; i + 6 <= FAKE_KEY.length; i++) {
      expect(json).not.toContain(FAKE_KEY.slice(i, i + 6));
    }
    // Nor on the client object itself.
    expect(JSON.stringify(client)).not.toContain(FAKE_KEY);
    expect(Object.values(client)).not.toContain(FAKE_KEY);
  });
});

describe('runAgent, Propose mode', () => {
  test('the dry run leaves the live model byte-identical; applying is one compound', async () => {
    // The mock creates an actor, a goal in it and a task, then refines the goal with the task,
    // addressing the ids the dry run's tool results report.
    const client = await model((request, i) => {
      const created = (n: number) => toolResults(request)[n]?.content.result.createdIds[0];
      switch (i) {
        case 0:
          return toolCalls(
            ['requestModel', {}],
            ['createNode', { elementTypeId: 'istar.Actor', args: { name: 'Auditor' } }],
          );
        case 1: {
          const actor = created(1);
          return toolCalls(
            [
              'createNode',
              {
                elementTypeId: 'istar.Goal',
                containerId: actor,
                args: { name: 'Review requests' },
              },
            ],
            [
              'createNode',
              { elementTypeId: 'istar.Task', containerId: actor, args: { name: 'Log activity' } },
            ],
            ['createNode', { elementTypeId: 'istar.Goal' }], // refused: not in an actor
          );
        }
        case 2:
          return toolCalls([
            'createEdge',
            {
              elementTypeId: 'istar.AndRefinementLink',
              sourceElementId: created(3),
              targetElementId: created(2),
            },
          ]);
        default:
          return answer('Proposed an auditor with an audit goal.');
      }
    });
    const live = liveStore(welcome());
    const before = toPistar(live.store.getModel());
    const { dispatcher, sent } = spy(live.dispatcher);
    const changeSetTarget = createActionChangeSet({ dispatcher, getModel: live.store.getModel });

    const { transcript, changeSet } = await runAgent({
      client,
      prompt: 'Give the model an auditor.',
      changeSet: changeSetTarget,
    });

    expect(transcript.approval).toBe('propose');
    expect(transcript.stop.reason).toBe('final');
    expect(sent).toEqual([]);
    expect(toPistar(live.store.getModel())).toBe(before);
    expect(live.store.canUndo()).toBe(false);

    // requestModel ran (on the scratch copy), but is not part of the change set.
    expect(transcript.steps[0]!.toolCalls[0]!.disposition).toBe('read');
    expect(changeSet.map((e) => [e.name, e.result.ok])).toEqual([
      ['createNode', true],
      ['createNode', true],
      ['createNode', true],
      ['createNode', false],
      ['createEdge', true],
    ]);

    const applied = await changeSetTarget.apply(changeSet);
    expect(applied.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe('compound');
    expect((sent[0] as Extract<IstarAction, { kind: 'compound' }>).operationList).toHaveLength(4);

    // The live model now has what the dry run created, with the dry run's ids.
    const proposedIds = changeSet
      .filter((e) => e.result.ok)
      .flatMap((e) => (e.result.ok ? (e.result.createdIds ?? []) : []));
    expect(proposedIds).toHaveLength(4);
    for (const id of proposedIds) {
      expect(live.store.getModel().elements.has(id) || live.store.getModel().links.has(id)).toBe(
        true,
      );
    }
    // One undo step takes all of it back.
    live.store.undo();
    expect(toPistar(live.store.getModel())).toBe(before);
    expect(live.store.canUndo()).toBe(false);
  });

  test('undo and redo in the dry run are played out in the applied compound', async () => {
    const client = await model((_, i) => {
      switch (i) {
        case 0:
          return toolCalls(['createNode', { elementTypeId: 'istar.Actor', args: { name: 'A' } }]);
        case 1:
          return toolCalls(
            ['createNode', { elementTypeId: 'istar.Actor', args: { name: 'B' } }],
            ['glspUndo', {}],
          );
        case 2:
          return toolCalls(['createNode', { elementTypeId: 'istar.Actor', args: { name: 'C' } }]);
        default:
          return answer('ok');
      }
    });
    const live = liveStore();
    const target = createActionChangeSet({
      dispatcher: live.dispatcher,
      getModel: live.store.getModel,
    });
    const { changeSet } = await runAgent({ client, prompt: 'x', changeSet: target });
    expect((await target.apply(changeSet)).ok).toBe(true);
    expect([...live.store.getModel().elements.values()].map((e) => e.name).toSorted()).toEqual([
      'A',
      'C',
    ]);
  });

  test('the scratch copy keeps the guards: a guard refusal shows in the dry run', async () => {
    const client = await model((_, i) =>
      i === 0 ? toolCalls(['createNode', { elementTypeId: 'istar.Actor' }]) : answer('ok'),
    );
    const live = liveStore();
    const target = createActionChangeSet({
      dispatcher: live.dispatcher,
      getModel: live.store.getModel,
      guards: [
        () => [{ elementId: '', severity: 'error', message: 'read-only demo', code: 'shield' }],
      ],
    });
    const { changeSet } = await runAgent({ client, prompt: 'x', changeSet: target });
    expect(changeSet[0]!.result).toEqual({
      ok: false,
      diagnostics: [
        { elementId: '', severity: 'error', message: 'read-only demo', code: 'shield' },
      ],
    });
  });
});
