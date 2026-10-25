/**
 * The drawer's Propose mode over backend A (#155, #156): a run that creates a node, refines into
 * it, renames it and moves it applies to the live model as one compound, with the scratch run's
 * ids; its read-only calls are not steps.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import type { ModelStore } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { runAgent } from '@istar-ts/agent';
import type { ChatClient, ChatMessage, JsonValue } from '@istar-ts/agent';
import { openGlspMcpSession } from '../src/agent/glspMcpBackend';
import type { GlspMcpSession } from '../src/agent/glspMcpBackend';

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

async function setup() {
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
  const session = await openGlspMcpSession(() => ({ store, dispatcher }));
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
});
