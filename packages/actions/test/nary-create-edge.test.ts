/**
 * #60: `createEdge` for an n-ary kind whose target is not yet a hub takes `args.legId`/`args.endId`
 * for the leg and end it creates, mirroring `args.linkIds` for a dependency's two links. Uses
 * KAOS's `kaos.RefinementLink` (DSM3-goals, `packages/dsm3-kaos`), an n-ary kind iStar 2.0 has none
 * of.
 */
import { describe, expect, test } from 'vitest';
import { createModelStore, toPistar } from '@istar-ts/core';
import type { KaosElementKind, KaosLinkKind } from '@istar-ts/dsm3-kaos/metamodel';
import { KAOS } from '@istar-ts/dsm3-kaos/metamodel';
import type { IstarAction } from '../src';
import { createActionDispatcher } from '../src';

let next = 0;
const createId = (): string => `id${++next}`;

function setup() {
  next = 0;
  const store = createModelStore(undefined, { metamodel: KAOS, createId });
  store.transaction(() => {
    store.addElement({ kind: 'kaos.BehavioralGoal', id: 'g1', x: 0, y: 0 });
    store.addElement({ kind: 'kaos.BehavioralGoal', id: 'g2', x: 100, y: 0 });
    store.addElement({ kind: 'kaos.BehavioralGoal', id: 'g3', x: 200, y: 0 });
  });
  store.clearHistory();
  const dispatcher = createActionDispatcher<KaosElementKind, KaosLinkKind>(store);
  return { store, dispatcher };
}

describe('createEdge for a new n-ary hub', () => {
  test('takes explicit ids for the hub, leg and end it creates', async () => {
    const { store, dispatcher } = setup();
    const result = await dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'kaos.RefinementLink',
      sourceElementId: 'g1',
      targetElementId: 'g2',
      args: { id: 'hub', legId: 'leg', endId: 'end' },
    });
    expect(result).toEqual({ ok: true, createdIds: ['hub', 'leg', 'end'] });
    const model = store.getModel();
    expect(model.elements.get('hub')).toMatchObject({ kind: 'kaos.RefinementLinkHub' });
    expect(model.links.get('leg')).toMatchObject({ source: 'g1', target: 'hub' });
    expect(model.links.get('end')).toMatchObject({ source: 'hub', target: 'g2' });
  });

  test('replaying it with the recorded createdIds gives byte-identical toPistar output', async () => {
    const original = setup();
    const createEdge = {
      kind: 'createEdge',
      elementTypeId: 'kaos.RefinementLink',
      sourceElementId: 'g1',
      targetElementId: 'g2',
    } as const satisfies IstarAction<KaosElementKind, KaosLinkKind>;
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
