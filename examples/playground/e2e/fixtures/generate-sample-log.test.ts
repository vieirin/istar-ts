import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionResult, IstarAction, IstarResponseAction } from '@istar-ts/actions';
import type { ElementKind, LinkKind } from '@istar-ts/core';
import { ISTAR_2_0, createModelStore, toPistarObject } from '@istar-ts/core';
import { expect, test } from 'vitest';

/**
 * Not part of the e2e suite — excluded from `pnpm test` with the rest of `e2e/**` (see
 * `vitest.config.ts`). A one-off generator for `sample-log.json`, the fixture
 * `e2e/replay-fixture.spec.ts` imports through the Replay tab's "Import log…". Regenerate it
 * (e.g. the log or piStar export shape changes) with a project root temporarily outside `e2e/`,
 * since vitest's own exclude would otherwise skip this file too:
 *
 *   cp e2e/fixtures/generate-sample-log.test.ts generate-sample-log.test.ts
 *   pnpm --filter playground exec vitest run generate-sample-log.test.ts --root .
 *   rm generate-sample-log.test.ts
 */
test('generates sample-log.json', async () => {
  const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
  const initialModel = toPistarObject(store.getModel());
  const dispatcher = createActionDispatcher(store);

  const entries: {
    id: number;
    client: string;
    action: IstarAction<ElementKind, LinkKind>;
    result: ActionResult<IstarResponseAction>;
    startedAt: number;
    durationMs: number;
  }[] = [];

  const record = async (
    client: string,
    action: IstarAction<ElementKind, LinkKind>,
  ): Promise<void> => {
    const startedAt = Date.now();
    const result = (await dispatcher.dispatch(action)) as ActionResult<IstarResponseAction>;
    expect(result.ok).toBe(true);
    entries.push({ id: entries.length, client, action, result, startedAt, durationMs: 0 });
  };

  await record('UI', {
    kind: 'createNode',
    elementTypeId: 'istar.Actor',
    location: { x: 40, y: 40 },
    args: { id: 'fixture-actor-1', name: 'Audit Team' },
  });
  await record('UI', {
    kind: 'createNode',
    elementTypeId: 'istar.Goal',
    containerId: 'fixture-actor-1',
    location: { x: 20, y: 100 },
    args: { id: 'fixture-goal-1', name: 'Track Expenses' },
  });
  await record('Script', {
    kind: 'createNode',
    elementTypeId: 'istar.Task',
    containerId: 'fixture-actor-1',
    location: { x: 20, y: 160 },
    args: { id: 'fixture-task-1', name: 'Log Expense' },
  });
  await record('Script', {
    kind: 'createEdge',
    elementTypeId: 'istar.AndRefinementLink',
    sourceElementId: 'fixture-goal-1',
    targetElementId: 'fixture-task-1',
  });

  dispatcher.dispose();

  const out = fileURLToPath(new URL('./sample-log.json', import.meta.url));
  writeFileSync(out, JSON.stringify({ initialModel, entries }, null, 2) + '\n');
});
