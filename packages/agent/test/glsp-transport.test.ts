/**
 * #248: a `GlspMcpSession` served in one realm (`serveGlspMcpSession` on a `MessageChannel`
 * port) and used from the other (`connectGlspMcpSession`): Auto mode's live calls, Propose →
 * review → apply, and an `undo` in the run dropping a step on the connecting end too. Also the
 * in-process change set finding a step from a copy of its result (no object identity).
 */
import { afterEach, describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore, metamodelOf } from '@istar-ts/core';
import type { AnyMetamodel, ModelStore } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { runAgent } from '../src';
import type { ChatClient, JsonValue } from '../src';
import { connectGlspMcpSession, openGlspMcpSession, serveGlspMcpSession } from '../src/glsp';
import type { GlspMcpBackendOptions } from '../src/glsp';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).toReversed()) fn();
});

/** A chat client that calls `script`'s tools in order, then answers. */
function scripted(script: readonly (readonly [string, JsonValue])[]): ChatClient {
  let index = 0;
  return {
    model: 'scripted',
    baseUrl: 'about:blank',
    async complete() {
      const next = script[index];
      index += 1;
      if (!next) return { message: { role: 'assistant', content: 'Done.' }, finishReason: 'stop' };
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${index}`,
              type: 'function',
              function: { name: next[0], arguments: JSON.stringify(next[1]) },
            },
          ],
        },
        finishReason: 'tool_calls',
      };
    },
  };
}

const task = (name: string, x: number): readonly [string, JsonValue] => [
  'create-nodes',
  {
    nodes: [
      {
        elementTypeId: 'node:istar.Task',
        position: { x, y: 0 },
        containerId: 'lab',
        args: { name },
      },
    ],
  },
];

async function model() {
  const store = createModelStore() as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(store, { palette: paletteOf(ISTAR_GLSP) });
  await dispatcher.dispatch({
    kind: 'createNode',
    elementTypeId: 'istar.Actor',
    location: { x: 0, y: 0 },
    args: { id: 'lab', name: 'Lab' },
  });
  const options = (): GlspMcpBackendOptions => ({
    store,
    dispatcher,
    metamodel: metamodelOf(store.getModel()) as AnyMetamodel,
  });
  return { store, dispatcher, options };
}

const names = (store: ModelStore<string, string>): string[] =>
  [...store.getModel().elements.values()].map((e) => e.name);

describe('a GLSP session over a port (#248)', () => {
  async function connected() {
    const { store, dispatcher, options } = await model();
    const { port1, port2 } = new MessageChannel();
    const stop = serveGlspMcpSession(port1, options);
    const session = await connectGlspMcpSession(port2);
    cleanup.push(() => {
      session.close();
      stop();
      port1.close();
      port2.close();
    });
    return { store, dispatcher, session };
  }

  test("Auto mode's calls edit the served model", async () => {
    const { store, session } = await connected();
    const tools = session.liveRegistry.list().map((t) => t.name);
    expect(tools).toContain('create-nodes');
    expect(tools).not.toContain('save-model');
    const result = await session.liveRegistry.call(...task('Live', 40));
    expect(result).toMatchObject({ ok: true });
    expect(names(store)).toContain('Live');
  });

  test('Propose → review → apply, with an undo in the run dropping a step', async () => {
    const { store, dispatcher, session } = await connected();
    const before = store.getModel();
    const run = await runAgent({
      client: scripted([task('A', 0), task('B', 60), ['undo', {}], task('C', 120)]),
      prompt: 'Add A and B, undo B, add C.',
      changeSet: session.changeSet,
    });
    expect(run.transcript.stop.reason).toBe('final');
    expect(store.getModel()).toBe(before);
    expect(run.changeSet.map((e) => e.name)).toEqual([
      'create-nodes',
      'create-nodes',
      'undo',
      'create-nodes',
    ]);

    // The review, on this end: steps and the undo's description, from the results' values.
    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(steps.map((s) => s?.description)).toEqual([
      ["create Task 'A' in Actor 'Lab'"],
      undefined,
      undefined,
      ["create Task 'C' in Actor 'Lab'"],
    ]);
    expect(session.changeSet.describeUndo(run.changeSet[2]!.result)).toBe(
      "agent undid: create Task 'B' in Actor 'Lab'",
    );

    // A JSON copy of the entries (as a transcript read back would be) applies as well.
    const kept = JSON.parse(
      JSON.stringify(run.changeSet.filter((e) => session.changeSet.step(e) !== undefined)),
    ) as typeof run.changeSet;
    const applied = await session.changeSet.apply(kept);
    expect(applied).toMatchObject({ ok: true });
    expect(applied.ok && applied.createdIds).toEqual([
      ...steps[0]!.createdIds,
      ...steps[3]!.createdIds,
    ]);
    expect(names(store)).toEqual(expect.arrayContaining(['A', 'C']));
    expect(names(store)).not.toContain('B');

    // One undo step on the served model.
    await dispatcher.dispatch({ kind: 'glspUndo' });
    expect(store.getModel().elements.size).toBe(before.elements.size);
  });

  test('a redo in the run brings the step back on the connecting end', async () => {
    const { session } = await connected();
    const run = await runAgent({
      client: scripted([task('A', 0), ['undo', {}], ['redo', {}]]),
      prompt: 'Add A, undo, redo.',
      changeSet: session.changeSet,
    });
    const steps = run.changeSet.map((entry) => session.changeSet.step(entry));
    expect(steps[0]?.description).toEqual(["create Task 'A' in Actor 'Lab'"]);
    expect(session.changeSet.describeUndo(run.changeSet[2]!.result)).toBe(
      "agent redid: create Task 'A' in Actor 'Lab'",
    );
  });

  test('a closed session refuses further calls', async () => {
    const { session } = await connected();
    session.close();
    const result = await session.liveRegistry.call(...task('Late', 0));
    expect(result).toMatchObject({ ok: false });
    await expect(session.changeSet.openScratch()).rejects.toThrow('closed');
  });
});

describe('the in-process change set without object identity (#248)', () => {
  test('finds a step and an undo description from structured clones of the results', async () => {
    const { store, options } = await model();
    const session = await openGlspMcpSession(options);
    cleanup.push(() => session.close());
    const run = await runAgent({
      client: scripted([task('A', 0), task('B', 60), ['undo', {}]]),
      prompt: 'Add A and B, undo B.',
      changeSet: session.changeSet,
    });
    const copies = structuredClone(run.changeSet);
    expect(copies.map((entry) => session.changeSet.step(entry)?.description)).toEqual([
      ["create Task 'A' in Actor 'Lab'"],
      undefined,
      undefined,
    ]);
    expect(session.changeSet.describeUndo(copies[2]!.result)).toBe(
      "agent undid: create Task 'B' in Actor 'Lab'",
    );
    const applied = await session.changeSet.apply(copies);
    expect(applied).toMatchObject({ ok: true });
    expect(names(store)).toContain('A');
    expect(names(store)).not.toContain('B');
  });
});
