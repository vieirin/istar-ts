/**
 * #60: `createEdge` for an n-ary kind whose target is not yet a hub takes `args.legId`/`args.endId`
 * for the leg and end it creates, mirroring `args.linkIds` for a dependency's two links. iStar
 * 2.0 has no n-ary kind of its own (KAOS and NFR do, via `extendMetamodel`, as DSM3-goals'
 * refinement links are); this extends it with a minimal one, modelled the same way.
 */
import { describe, expect, test } from 'vitest';
import type { LinkKind } from '@istar-ts/core';
import {
  ISTAR_2_0,
  createModelStore,
  extendMetamodel,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import type { IstarAction } from '../src';
import { createActionDispatcher } from '../src';

const METAMODEL = extendMetamodel(ISTAR_2_0, {
  name: 'x',
  links: [
    {
      kind: 'x.Joint',
      arity: 'n',
      rules: { sources: ['istar.Goal'], targets: ['istar.Goal'] },
    },
  ],
});

let next = 0;
const createId = (): string => `id${++next}`;

function setup() {
  next = 0;
  const store = createModelStore(undefined, { metamodel: METAMODEL, createId });
  store.transaction(() => {
    store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
    store.addElement({ kind: 'istar.Goal', id: 'g1', x: 10, y: 10, parent: 'a' });
    store.addElement({ kind: 'istar.Goal', id: 'g2', x: 100, y: 10, parent: 'a' });
  });
  store.clearHistory();
  const dispatcher = createActionDispatcher(store);
  return { store, dispatcher };
}

describe('createEdge for a new n-ary hub', () => {
  test('takes explicit ids for the hub, leg and end it creates', async () => {
    const { store, dispatcher } = setup();
    const result = await dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 'g1',
      targetElementId: 'g2',
      args: { id: 'hub', legId: 'leg', endId: 'end' },
    });
    expect(result).toEqual({ ok: true, createdIds: ['hub', 'leg', 'end'] });
    const model = store.getModel();
    expect(model.links.get('leg')).toMatchObject({ source: 'g1', target: 'hub' });
    expect(model.links.get('end')).toMatchObject({ source: 'hub', target: 'g2' });
  });

  test('replaying it with the recorded createdIds gives byte-identical toPistar output', async () => {
    const original = setup();
    const createEdge = {
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 'g1',
      targetElementId: 'g2',
    } as const satisfies IstarAction<string, LinkKind | 'x.Joint'>;
    const originalResult = await original.dispatcher.dispatch(createEdge);
    if (!originalResult.ok) throw new Error('expected the original createEdge to be accepted');
    const [hubId, legId, endId] = originalResult.createdIds;
    const originalFile = toPistar(original.store.getModel());

    // A fresh store, replayed with the original's createdIds injected as explicit ids.
    const replay = setup();
    const replayedResult = await replay.dispatcher.dispatch({
      ...createEdge,
      args: { id: hubId, legId, endId },
    });
    expect(replayedResult).toEqual(originalResult);
    expect(toPistar(replay.store.getModel())).toBe(originalFile);
  });
});

describe('createEdge for an existing n-ary hub', () => {
  async function addHub(dispatcher: ReturnType<typeof setup>['dispatcher']) {
    const result = await dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 'g1',
      targetElementId: 'g2',
      args: { id: 'hub', legId: 'leg1', endId: 'end' },
    });
    if (!result.ok) throw new Error('expected the hub-creating createEdge to be accepted');
    return result;
  }

  test('takes an explicit id for the new leg (#138)', async () => {
    const { store, dispatcher } = setup();
    await addHub(dispatcher);
    store.addElement({ kind: 'istar.Goal', id: 'g3', x: 100, y: 100, parent: 'a' });
    const result = await dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 'g3',
      targetElementId: 'hub',
      args: { id: 'leg2' },
    });
    expect(result).toEqual({ ok: true, createdIds: ['leg2'] });
    expect(store.getModel().links.get('leg2')).toMatchObject({ source: 'g3', target: 'hub' });
  });

  test('a dry run on a copy and a live apply give identical ids and an identical toPistar', async () => {
    const { store, dispatcher } = setup();
    await addHub(dispatcher);
    store.addElement({ kind: 'istar.Goal', id: 'g3', x: 100, y: 100, parent: 'a' });
    const newLeg = {
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 'g3',
      targetElementId: 'hub',
    } as const satisfies IstarAction<string, LinkKind | 'x.Joint'>;

    // Propose mode's scratch copy (#126 §9): a parsePistar/toPistar round trip of the live model.
    const scratchStore = createModelStore(
      parsePistar(toPistar(store.getModel()), { metamodel: METAMODEL, fileMetamodel: true }),
      { metamodel: METAMODEL, createId },
    );
    const scratchDispatcher = createActionDispatcher(scratchStore);
    const dryRunResult = await scratchDispatcher.dispatch(newLeg);
    if (!dryRunResult.ok) throw new Error('expected the dry-run createEdge to be accepted');
    const dryRunFile = toPistar(scratchStore.getModel());

    const liveResult = await dispatcher.dispatch({
      ...newLeg,
      args: { legId: dryRunResult.createdIds[0] },
    });
    expect(liveResult).toEqual(dryRunResult);
    expect(toPistar(store.getModel())).toBe(dryRunFile);
  });
});
