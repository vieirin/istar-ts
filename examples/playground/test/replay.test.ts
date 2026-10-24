import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionDispatcher } from '@istar-ts/actions';
import { createModelStore, parsePistar, toPistar } from '@istar-ts/core';
import { createLogStore } from '../src/lab/log';
import { tagClient } from '../src/lab/tagClient';
import { replayLog, replayableEntries } from '../src/lab/replayLog';

const fixturePath = fileURLToPath(new URL('../../../fixtures/pistar/welcome.txt', import.meta.url));
const fixtureText = readFileSync(fixturePath, 'utf-8');

function setUp() {
  const initialModel = parsePistar(fixtureText);
  const store = createModelStore(initialModel);
  const dispatcher: ActionDispatcher<string, string> = createActionDispatcher(store);
  const log = createLogStore();
  log.setInitialModel(initialModel);
  const tagged = tagClient(dispatcher, 'Script', log);
  const [actorId, otherActorId] = [...initialModel.elements.values()]
    .filter((e) => e.kind === 'istar.Agent' || e.kind === 'istar.Role')
    .map((e) => e.id);
  const elementId = [...initialModel.elements.values()].find((e) => e.kind === 'istar.Task')!.id;
  const otherElementId = [...initialModel.elements.values()].find(
    (e) => e.kind === 'istar.Quality',
  )!.id;
  return { initialModel, store, log, tagged, actorId, otherActorId, elementId, otherElementId };
}

describe('replayLog', () => {
  test('replays a log over a fixture to a byte-identical model', async () => {
    const { store, log, tagged, actorId, otherActorId, elementId, otherElementId } = setUp();

    await tagged.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
      location: { x: 10, y: 20 },
      args: { name: 'New goal' },
    });
    await tagged.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.ContributionLink',
      sourceElementId: elementId!,
      targetElementId: otherElementId!,
      args: { value: 'help' },
    });
    await tagged.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: actorId!,
      targetElementId: otherActorId!,
      args: { dependum: { name: 'a dependum' } },
    });
    await tagged.dispatch({
      kind: 'compound',
      operationList: [
        {
          kind: 'createNode',
          elementTypeId: 'istar.Task',
          containerId: otherActorId!,
          args: { name: 'compound task' },
        },
        { kind: 'applyLabelEdit', labelId: elementId!, text: 'Renamed' },
      ],
    });

    const entries = replayableEntries(log.getEntries());
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.result.ok)).toBe(true);

    const outcome = await replayLog(log.getInitialModel()!, log.getEntries());

    expect(outcome.steps).toHaveLength(4);
    expect(outcome.steps.every((s) => s.result?.ok)).toBe(true);
    expect(toPistar(outcome.model)).toBe(toPistar(store.getModel()));
  });

  test('skipping an action a later one depends on rejects the dependent, without dropping it', async () => {
    const { log, tagged, actorId } = setUp();

    await tagged.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actorId,
      args: { name: 'Will be skipped' },
    });
    const createdId = (log.getEntries()[0]!.result as { createdIds: readonly string[] })
      .createdIds[0]!;
    await tagged.dispatch({
      kind: 'applyLabelEdit',
      labelId: createdId,
      text: 'Depends on the skipped node',
    });

    const [createEntry, dependentEntry] = log.getEntries();
    const full = await replayLog(log.getInitialModel()!, log.getEntries());
    expect(full.steps.map((s) => s.result?.ok)).toEqual([true, true]);

    const skipped = await replayLog(
      log.getInitialModel()!,
      log.getEntries(),
      new Set([createEntry!.id]),
    );

    expect(skipped.steps).toHaveLength(2);
    expect(skipped.steps[0]!.entry).toBe(createEntry);
    expect(skipped.steps[0]!.skipped).toBe(true);
    expect(skipped.steps[0]!.result).toBeUndefined();
    expect(skipped.steps[1]!.entry).toBe(dependentEntry);
    expect(skipped.steps[1]!.skipped).toBe(false);
    expect(skipped.steps[1]!.result?.ok).toBe(false);
  });
});
