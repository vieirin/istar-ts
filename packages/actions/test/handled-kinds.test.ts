/**
 * #57: `HANDLED_ACTION_KINDS` must list exactly the kinds `createActionDispatcher` accepts — one
 * it dispatches, not the catch-all rejection ("... is not an action this dispatcher handles",
 * `code: 'unknown-action'`). A kind missing from `HANDLED_ACTION_KINDS` would drift from the
 * dispatcher without this test noticing.
 */
import { describe, expect, test } from 'vitest';
import { createModelStore } from '@istar-ts/core';
import type { KaosElementKind, KaosLinkKind } from '@istar-ts/dsm3-kaos/metamodel';
import { KAOS } from '@istar-ts/dsm3-kaos/metamodel';
import type { ActionResult, IstarAction } from '../src';
import { HANDLED_ACTION_KINDS, createActionDispatcher } from '../src';

function allHandledKinds(): readonly string[] {
  return [
    ...HANDLED_ACTION_KINDS.operations,
    ...HANDLED_ACTION_KINDS.requests,
    ...HANDLED_ACTION_KINDS.notifications,
  ];
}

function isUnknownAction(result: ActionResult<unknown>): boolean {
  return !result.ok && result.diagnostics.some((d) => d.code === 'unknown-action');
}

describe('HANDLED_ACTION_KINDS', () => {
  test('is exactly the kinds the dispatcher accepts', async () => {
    const store = createModelStore(undefined, { metamodel: KAOS });
    const dispatcher = createActionDispatcher<KaosElementKind, KaosLinkKind>(store, {
      save: () => {},
    });

    store.transaction(() => {
      store.addElement({ kind: 'kaos.BehavioralGoal', id: 'g1', x: 0, y: 0 });
      store.addElement({ kind: 'kaos.BehavioralGoal', id: 'g2', x: 100, y: 0 });
    });
    const joint = store.connect({
      kind: 'kaos.RefinementLink',
      source: 'g1',
      target: 'g2',
      id: 'hub',
      legId: 'leg',
      endId: 'end',
    });
    if (!joint.ok) throw new Error('setup failed');
    store.clearHistory();

    // Every kind the dispatcher switches on, with args that reach its case (whether or not the
    // operation is then accepted — only "unrecognized kind" is what this test rules out).
    const ACTIONS: Record<string, IstarAction<KaosElementKind, KaosLinkKind>> = {
      createNode: { kind: 'createNode', elementTypeId: 'kaos.Softgoal' },
      createEdge: {
        kind: 'createEdge',
        elementTypeId: 'kaos.Conflict',
        sourceElementId: 'g1',
        targetElementId: 'g2',
      },
      deleteElement: { kind: 'deleteElement', elementIds: [] },
      changeBounds: { kind: 'changeBounds', newBounds: [] },
      changeContainer: { kind: 'changeContainer', elementId: 'g1', targetContainerId: null },
      reconnectEdge: {
        kind: 'reconnectEdge',
        edgeElementId: 'leg',
        sourceElementId: 'g1',
        targetElementId: 'hub',
      },
      applyLabelEdit: { kind: 'applyLabelEdit', labelId: 'g1', text: 'Goal' },
      compound: { kind: 'compound', operationList: [] },
      'istar.addLeg': { kind: 'istar.addLeg', hubId: 'hub', sourceElementId: 'g1' },
      'istar.removeLeg': { kind: 'istar.removeLeg', legId: 'leg' },
      'istar.setCollapsed': { kind: 'istar.setCollapsed', elementId: 'g1', collapsed: true },
      'istar.updateDiagram': { kind: 'istar.updateDiagram', diagram: {} },
      'istar.updateProperties': { kind: 'istar.updateProperties', elementId: 'g1', properties: {} },
      requestModel: { kind: 'requestModel', requestId: 'r1' },
      requestTypeHints: { kind: 'requestTypeHints', requestId: 'r2' },
      requestCheckEdge: {
        kind: 'requestCheckEdge',
        requestId: 'r3',
        edgeType: 'kaos.Conflict',
        sourceElementId: 'g1',
      },
      requestContextActions: {
        kind: 'requestContextActions',
        requestId: 'r4',
        contextId: 'tool-palette',
        editorContext: { selectedElementIds: [] },
      },
      requestMarkers: { kind: 'requestMarkers', requestId: 'r5', elementsIDs: [] },
      glspUndo: { kind: 'glspUndo' },
      glspRedo: { kind: 'glspRedo' },
      saveModel: { kind: 'saveModel' },
      sourceModelChanged: {
        kind: 'sourceModelChanged',
        sourceModelName: '',
        source: 'edit',
        changes: [],
      },
      setDirtyState: { kind: 'setDirtyState', isDirty: true },
      triggerNodeCreation: { kind: 'triggerNodeCreation', elementTypeId: 'kaos.Softgoal' },
      triggerEdgeCreation: { kind: 'triggerEdgeCreation', elementTypeId: 'kaos.RefinementLink' },
      deleteMarkers: { kind: 'deleteMarkers', markers: [] },
    };

    const kinds = allHandledKinds();
    expect(Object.keys(ACTIONS).toSorted()).toEqual(kinds.toSorted());

    for (const kind of kinds) {
      const result = await dispatcher.dispatch(ACTIONS[kind]!);
      expect(isUnknownAction(result), `"${kind}" was rejected as unknown`).toBe(false);
    }

    const rejected = await dispatcher.dispatch({ kind: 'notAKind' } as unknown as IstarAction<
      KaosElementKind,
      KaosLinkKind
    >);
    expect(isUnknownAction(rejected)).toBe(true);
  });
});
