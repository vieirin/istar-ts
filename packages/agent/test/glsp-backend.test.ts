/**
 * The host's Propose mode over backend A (#155, #156, #232): a run that creates a node, refines
 * into it, renames it and moves it applies to the live model as one compound, with the scratch
 * run's ids; its read-only calls are not steps. A guard's rejection surfaces at preview time, on
 * the scratch session, before any dry-run step is ever applied to the live model.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import type {
  ActionGuard,
  ActionPostGuard,
  HostContextProvider,
  HostTool,
} from '@istar-ts/actions';
import { createModelStore, metamodelOf } from '@istar-ts/core';
import type { AnyMetamodel } from '@istar-ts/core';
import type { ModelStore } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { runAgent } from '../src';
import type { ChatClient, ChatMessage, JsonValue } from '../src';
import { openGlspMcpSession } from '../src/glsp';
import type { GlspMcpSession } from '../src/glsp';

const sessions: GlspMcpSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
});

/** A chat client that answers with `script[i]`'s tool call (or a final answer past its end),
 * given the conversation so far. */
function scripted(
  script: readonly ((messages: readonly ChatMessage[]) => readonly [string, JsonValue])[],
): ChatClient {
  let index = 0;
  return {
    model: 'scripted',
    baseUrl: 'about:blank',
    async complete({ messages }) {
      const next = script[index];
      index += 1;
      if (!next) {
        return { message: { role: 'assistant', content: 'Done.' }, finishReason: 'stop' };
      }
      const [name, args] = next(messages);
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${index}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finishReason: 'tool_calls',
      };
    },
  };
}

/** The last tool message's result, as the model reads it. */
function lastResult(messages: readonly ChatMessage[]): { result: Record<string, unknown> } {
  const tool = messages.findLast((m) => m.role === 'tool');
  return JSON.parse(String(tool?.content)) as { result: Record<string, unknown> };
}

async function setup(
  overrides: {
    readonly guards?: readonly ActionGuard<string, string>[];
    readonly postGuards?: readonly ActionPostGuard<string, string>[];
    readonly hostTools?: readonly HostTool[];
    readonly context?: readonly HostContextProvider[];
  } = {},
) {
  const store = createModelStore() as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(store, { palette: paletteOf(ISTAR_GLSP) });
  const seeded = await dispatcher.dispatch({
    kind: 'compound',
    operationList: [
      {
        kind: 'createNode',
        elementTypeId: 'istar.Actor',
        location: { x: 0, y: 0 },
        args: { id: 'lab', name: 'Lab' },
      },
      {
        kind: 'createNode',
        elementTypeId: 'istar.Task',
        containerId: 'lab',
        location: { x: 40, y: 60 },
        args: { id: 'collect', name: 'Collect sample' },
      },
    ],
  });
  expect(seeded.ok).toBe(true);
  const session = await openGlspMcpSession(() => ({
    store,
    dispatcher,
    guards: overrides.guards ?? [],
    postGuards: overrides.postGuards,
    hostTools: overrides.hostTools,
    context: overrides.context,
    metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
  }));
  sessions.push(session);
  return { store, dispatcher, session };
}

describe('Propose mode over backend A', () => {
  test('applies a node, an edge to it, a rename and a move with the scratch ids', async () => {
    const { store, dispatcher, session } = await setup();
    let alias = '';
    const client = scripted([
      () => ['query-elements', {}],
      () => [
        'create-nodes',
        {
          nodes: [
            {
              elementTypeId: 'node:istar.Task',
              position: { x: 200, y: 100 },
              containerId: 'lab',
              args: { name: 'T8' },
            },
          ],
        },
      ],
      (messages) => {
        const created = lastResult(messages).result.createdNodes as { id: string }[];
        alias = created[0]!.id;
        return [
          'check-edge',
          {
            edgeType: 'edge:istar.AndRefinementLink',
            sourceElementId: 'collect',
            targetElementId: alias,
          },
        ];
      },
      () => [
        'create-edges',
        {
          edges: [
            {
              elementTypeId: 'edge:istar.AndRefinementLink',
              sourceElementId: 'collect',
              targetElementId: alias,
            },
          ],
        },
      ],
      () => ['modify-nodes', { nodes: [{ elementId: alias, text: 'T8: Pickup Sample' }] }],
      () => ['modify-nodes', { nodes: [{ elementId: alias, position: { x: 120, y: 160 } }] }],
    ]);

    const before = store.getModel();
    const run = await runAgent({ client, prompt: 'Add T8.', changeSet: session.changeSet });
    expect(run.transcript.stop.reason).toBe('final');
    expect(store.getModel()).toBe(before);

    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(run.changeSet.map((e) => e.name)).toEqual([
      'create-nodes',
      'create-edges',
      'modify-nodes',
      'modify-nodes',
    ]);
    expect(steps.every((s) => s !== undefined)).toBe(true);
    const [createdNode] = steps[0]!.createdIds;
    expect(steps.map((s) => s!.description)).toEqual([
      ["create Task 'T8' in Actor 'Lab'"],
      ["add And-Refinement from Task 'Collect sample' to Task 'T8'"],
      ["rename Task 'T8' to 'T8: Pickup Sample'"],
      [expect.stringMatching(/^move Task 'T8: Pickup Sample' to \(\d+, \d+\)$/)],
    ]);

    const applied = await session.changeSet.apply(run.changeSet);
    expect(applied).toMatchObject({ ok: true });
    const scratchIds = steps.flatMap((s) => s!.createdIds);
    expect(applied.ok && applied.createdIds).toEqual(scratchIds);

    const live = store.getModel();
    const node = live.elements.get(createdNode!);
    expect(node).toMatchObject({ kind: 'istar.Task', name: 'T8: Pickup Sample', parent: 'lab' });
    // Moved: `modify-nodes` takes positions relative to the actor, here at the origin.
    expect({ x: node!.x, y: node!.y }).toEqual({ x: 120, y: 160 });
    const refinement = [...live.links.values()].find((l) => l.kind === 'istar.AndRefinementLink');
    expect(refinement).toMatchObject({ source: 'collect', target: createdNode });

    // One undo step for the whole change set.
    await dispatcher.dispatch({ kind: 'glspUndo' });
    expect([...store.getModel().elements.keys()]).toEqual([...before.elements.keys()]);
    expect(store.getModel().links.size).toBe(0);
  });

  test('an undone step is dropped from the change set (#163)', async () => {
    const { store, session } = await setup();
    const client = scripted([
      () => [
        'create-nodes',
        {
          nodes: [
            {
              elementTypeId: 'node:istar.Task',
              position: { x: 0, y: 0 },
              containerId: 'lab',
              args: { name: 'A' },
            },
          ],
        },
      ],
      () => [
        'create-nodes',
        {
          nodes: [
            {
              elementTypeId: 'node:istar.Task',
              position: { x: 60, y: 0 },
              containerId: 'lab',
              args: { name: 'B' },
            },
          ],
        },
      ],
      () => ['undo', {}],
    ]);

    const run = await runAgent({
      client,
      prompt: 'Add A then B, then undo.',
      changeSet: session.changeSet,
    });
    expect(run.changeSet.map((e) => e.name)).toEqual(['create-nodes', 'create-nodes', 'undo']);

    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(steps[0]).not.toBeUndefined();
    expect(steps[1]).toBeUndefined();
    expect(steps[2]).toBeUndefined();
    expect(session.changeSet.describeUndo(run.changeSet[2]!.result)).toBe(
      "agent undid: create Task 'B' in Actor 'Lab'",
    );

    const kept = run.changeSet.filter((entry) => session.changeSet.step(entry) !== undefined);
    const applied = await session.changeSet.apply(kept);
    expect(applied).toMatchObject({ ok: true });
    expect(applied.ok && applied.createdIds).toEqual(steps[0]!.createdIds);

    const live = store.getModel();
    const names = [...live.elements.values()].map((e) => e.name);
    expect(names).toContain('A');
    expect(names).not.toContain('B');
  });

  test('a redone step comes back into the change set (#163)', async () => {
    const { store, session } = await setup();
    const client = scripted([
      () => [
        'create-nodes',
        {
          nodes: [
            {
              elementTypeId: 'node:istar.Task',
              position: { x: 0, y: 0 },
              containerId: 'lab',
              args: { name: 'A' },
            },
          ],
        },
      ],
      () => ['undo', {}],
      () => ['redo', {}],
    ]);

    const run = await runAgent({
      client,
      prompt: 'Add A, undo, redo.',
      changeSet: session.changeSet,
    });
    expect(run.changeSet.map((e) => e.name)).toEqual(['create-nodes', 'undo', 'redo']);

    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(steps[0]).not.toBeUndefined();
    expect(steps[1]).toBeUndefined();
    expect(steps[2]).toBeUndefined();
    expect(session.changeSet.describeUndo(run.changeSet[2]!.result)).toBe(
      "agent redid: create Task 'A' in Actor 'Lab'",
    );

    const kept = run.changeSet.filter((entry) => session.changeSet.step(entry) !== undefined);
    const applied = await session.changeSet.apply(kept);
    expect(applied).toMatchObject({ ok: true });

    const live = store.getModel();
    expect([...live.elements.values()].map((e) => e.name)).toContain('A');
  });

  // #223: a tool call that dispatches several operations (`create-nodes` with `text`: a node,
  // then its label) is one undo step on the scratch session, so one review step, popped whole
  // by one `undo`.
  test('a multi-operation call is one step, and one undo drops all of it (#223)', async () => {
    const { store, session } = await setup();
    const task = (x: number, text: string) => ({
      elementTypeId: 'node:istar.Task',
      position: { x, y: 0 },
      containerId: 'lab',
      text,
    });
    const client = scripted([
      () => ['create-nodes', { nodes: [task(0, 'A')] }],
      () => ['create-nodes', { nodes: [task(60, 'B'), task(120, 'C')] }],
      () => ['undo', {}],
    ]);

    const run = await runAgent({ client, prompt: 'Add A, B and C.', changeSet: session.changeSet });
    expect(run.changeSet.map((e) => e.name)).toEqual(['create-nodes', 'create-nodes', 'undo']);
    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(steps[0]?.operations).toHaveLength(1);
    expect(steps[0]?.operations[0]?.kind).toBe('compound');
    expect(steps[0]?.createdIds).toHaveLength(1);
    expect(steps[0]?.description).toEqual([
      "create Task 'Task' in Actor 'Lab'",
      "rename Task 'Task' to 'A'",
    ]);
    expect(steps[1]).toBeUndefined();
    expect(session.changeSet.describeUndo(run.changeSet[2]!.result)).toBe(
      "agent undid: create Task 'Task' in Actor 'Lab'; rename Task 'Task' to 'B'; " +
        "create Task 'Task' in Actor 'Lab'; rename Task 'Task' to 'C'",
    );

    const kept = run.changeSet.filter((entry) => session.changeSet.step(entry) !== undefined);
    const applied = await session.changeSet.apply(kept);
    expect(applied).toMatchObject({ ok: true });
    const names = [...store.getModel().elements.values()].map((e) => e.name);
    expect(names).toContain('A');
    expect(names).not.toContain('B');
    expect(names).not.toContain('C');
    expect(names).not.toContain('Task');
  });

  // #232: the guard runs on the scratch session, inside `openScratch`/the dry run, so its
  // refusal is in the preview (the change set's own entry), before `apply` ever touches the
  // live model — a host shows it without needing the agent to call `apply` first.
  test("a guard's rejection surfaces at preview time, on the scratch session", async () => {
    const refuseTasks: ActionGuard<string, string> = (operation) =>
      operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task'
        ? [{ elementId: '', severity: 'error', message: 'no new tasks today', code: 'demo' }]
        : undefined;
    const { store, session } = await setup({ guards: [refuseTasks] });
    const client = scripted([
      () => [
        'create-nodes',
        {
          nodes: [
            {
              elementTypeId: 'node:istar.Task',
              position: { x: 0, y: 0 },
              containerId: 'lab',
              args: { name: 'A' },
            },
          ],
        },
      ],
    ]);

    const before = store.getModel();
    const run = await runAgent({ client, prompt: 'Add A.', changeSet: session.changeSet });
    expect(run.changeSet).toHaveLength(1);
    const [entry] = run.changeSet;
    expect(entry!.result.ok).toBe(false);
    expect(entry!.result.ok || entry!.result.diagnostics).toMatchObject([
      { message: 'no new tasks today', code: 'demo' },
    ]);
    // Refused on the scratch session: nothing to apply, and the live model never moved.
    expect(session.changeSet.step(entry!)).toBeUndefined();
    expect(store.getModel()).toBe(before);

    const applied = await session.changeSet.apply(run.changeSet);
    expect(applied).toMatchObject({ ok: true, content: { createdIds: [] } });
    expect(store.getModel()).toBe(before);
  });

  // #239: a postGuard, unlike a guard, sees the model after the operation too; the scratch
  // dispatcher built in `openScratch` must get it, the same as a guard, so its refusal also
  // surfaces at preview time.
  test("a postGuard's refusal surfaces at preview time, on the scratch session (#239)", async () => {
    const oneActor: ActionPostGuard<string, string> = (operation, modelAfter) =>
      operation.kind === 'createNode' &&
      operation.elementTypeId === 'istar.Actor' &&
      [...modelAfter.elements.values()].filter((e) => e.kind === 'istar.Actor').length > 1
        ? [{ elementId: '', severity: 'error', message: 'one actor only', code: 'demo' }]
        : undefined;
    const { store, session } = await setup({ postGuards: [oneActor] });
    const client = scripted([
      () => [
        'create-nodes',
        {
          nodes: [
            { elementTypeId: 'node:istar.Actor', position: { x: 200, y: 0 }, args: { name: 'B' } },
          ],
        },
      ],
    ]);

    const before = store.getModel();
    const run = await runAgent({ client, prompt: 'Add actor B.', changeSet: session.changeSet });
    expect(run.changeSet).toHaveLength(1);
    const [entry] = run.changeSet;
    expect(entry!.result.ok).toBe(false);
    expect(entry!.result.ok || entry!.result.diagnostics).toMatchObject([
      { message: 'one actor only', code: 'demo' },
    ]);
    expect(session.changeSet.step(entry!)).toBeUndefined();
    expect(store.getModel()).toBe(before);

    const applied = await session.changeSet.apply(run.changeSet);
    expect(applied).toMatchObject({ ok: true, content: { createdIds: [] } });
    expect(store.getModel()).toBe(before);
  });

  describe('host tools and context (#175, #239)', () => {
    const echoTool: HostTool = {
      name: 'host-echo',
      description: 'Echoes its argument back.',
      inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
      readOnly: true,
      handler: (args) => ({ ok: true, content: { echoed: args.note ?? null } }),
    };

    const addNoteTool: HostTool = {
      name: 'host-add-note',
      description: 'Adds a note task to the lab actor.',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const result = await ctx.dispatcher.dispatch({
          kind: 'createNode',
          elementTypeId: 'istar.Task',
          containerId: 'lab',
          location: { x: 80, y: 0 },
          args: { id: 'host-note', name: 'Host note' },
        });
        return result.ok
          ? { ok: true, content: { createdIds: result.createdIds } }
          : { ok: false, diagnostics: result.diagnostics };
      },
    };

    test('a read-only host tool is callable in Propose mode and is not a step', async () => {
      const { session } = await setup({ hostTools: [echoTool] });
      const client = scripted([() => ['host-echo', { note: 'hi' }]]);

      const run = await runAgent({ client, prompt: 'Echo hi.', changeSet: session.changeSet });
      // A read-only call is a "read" disposition, not a review step: it never joins `changeSet`.
      expect(run.changeSet).toHaveLength(0);
      const [call] = run.transcript.steps.flatMap((s) => s.toolCalls);
      expect(call).toMatchObject({
        name: 'host-echo',
        disposition: 'read',
        result: { ok: true, content: { echoed: 'hi' } },
      });
    });

    test("a mutating host tool's effect is previewed and applied in the compound", async () => {
      const { store, session } = await setup({ hostTools: [addNoteTool] });
      const client = scripted([() => ['host-add-note', {}]]);

      const before = store.getModel();
      const run = await runAgent({ client, prompt: 'Add a note.', changeSet: session.changeSet });
      expect(run.changeSet).toHaveLength(1);
      const [entry] = run.changeSet;
      expect(entry!.result.ok).toBe(true);
      const step = session.changeSet.step(entry!);
      expect(step).not.toBeUndefined();
      expect(step!.createdIds).toEqual(['host-note']);
      expect(store.getModel()).toBe(before);

      const applied = await session.changeSet.apply(run.changeSet);
      expect(applied).toMatchObject({ ok: true, content: { createdIds: ['host-note'] } });
      expect(store.getModel().elements.get('host-note')).toMatchObject({ name: 'Host note' });
    });

    test('both the live and scratch servers list the host tools', async () => {
      const { session } = await setup({ hostTools: [echoTool, addNoteTool] });
      expect(session.liveRegistry.list().map((s) => s.name)).toContain('host-echo');
      expect(session.liveRegistry.list().map((s) => s.name)).toContain('host-add-note');

      const scratch = await session.changeSet.openScratch();
      try {
        expect(scratch.registry.list().map((s) => s.name)).toContain('host-echo');
        expect(scratch.registry.list().map((s) => s.name)).toContain('host-add-note');
      } finally {
        scratch.close?.();
      }
    });

    test("a context provider's text reaches the system prompt", async () => {
      const provider: HostContextProvider = {
        name: 'house-style',
        title: 'House style',
        text: 'Name every actor in Title Case.',
      };
      const { session } = await setup({ context: [provider] });
      let systemPrompt = '';
      const client = scripted([
        (messages) => {
          systemPrompt = String(messages[0]?.content);
          return ['query-elements', {}];
        },
      ]);

      await runAgent({
        client,
        prompt: 'Look around.',
        changeSet: session.changeSet,
        context: [provider],
      });
      expect(systemPrompt).toContain('House style');
      expect(systemPrompt).toContain('Name every actor in Title Case.');
    });
  });
});

describe('the built-in metamodel context provider (#240)', () => {
  test('is listed by default on the live session and a scratch one', async () => {
    const { session } = await setup();
    expect(session.liveRegistry.list().map((s) => s.name)).toContain('metamodel');
    const scratch = await session.changeSet.openScratch();
    expect(scratch.registry.list().map((s) => s.name)).toContain('metamodel');
    scratch.close?.();
  });

  test('is absent with metamodelContext: false', async () => {
    const store = createModelStore() as unknown as ModelStore<string, string>;
    const dispatcher = createActionDispatcher(store, { palette: paletteOf(ISTAR_GLSP) });
    const session = await openGlspMcpSession(() => ({
      store,
      dispatcher,
      metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
      metamodelContext: false,
    }));
    sessions.push(session);
    expect(session.liveRegistry.list().map((s) => s.name)).not.toContain('metamodel');
    const scratch = await session.changeSet.openScratch();
    expect(scratch.registry.list().map((s) => s.name)).not.toContain('metamodel');
    scratch.close?.();
  });
});
