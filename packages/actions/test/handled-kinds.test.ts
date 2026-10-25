/**
 * #57: `HANDLED_ACTION_KINDS` must list exactly the kinds `createActionDispatcher` accepts — one
 * it dispatches, not the catch-all rejection ("... is not an action this dispatcher handles",
 * `code: 'unknown-action'`). A kind missing from `HANDLED_ACTION_KINDS` would drift from the
 * dispatcher without this test noticing. Extends iStar 2.0 with a minimal n-ary kind (iStar 2.0
 * has none of its own) to exercise `istar.addLeg`/`istar.removeLeg`.
 */
import { describe, expect, test } from 'vitest';
import { ISTAR_2_0, createModelStore, extendMetamodel } from '@istar-ts/core';
import type { ActionResult, IstarAction } from '../src';
import { HANDLED_ACTION_KINDS, createActionDispatcher } from '../src';

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
    const store = createModelStore(undefined, { metamodel: METAMODEL });
    const dispatcher = createActionDispatcher(store, { save: () => {} });

    store.transaction(() => {
      store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
      store.addElement({ kind: 'istar.Goal', id: 'g1', x: 10, y: 10, parent: 'a' });
      store.addElement({ kind: 'istar.Goal', id: 'g2', x: 100, y: 10, parent: 'a' });
      store.addElement({ kind: 'istar.Quality', id: 'q1', x: 10, y: 80, parent: 'a' });
    });
    const joint = store.connect({
      kind: 'x.Joint',
      source: 'g1',
      target: 'g2',
      id: 'hub',
      legId: 'leg',
      endId: 'end',
    });
    const contribution = store.connect({
      kind: 'istar.ContributionLink',
      source: 'g1',
      target: 'q1',
      label: 'help',
      id: 'contrib',
    });
    if (!joint.ok || !contribution.ok) throw new Error('setup failed');
    store.clearHistory();

    // Every kind the dispatcher switches on, with args that reach its case (whether or not the
    // operation is then accepted — only "unrecognized kind" is what this test rules out).
    const ACTIONS: Record<string, IstarAction> = {
      createNode: { kind: 'createNode', elementTypeId: 'istar.Task' },
      createEdge: {
        kind: 'createEdge',
        elementTypeId: 'istar.DependencyLink',
        sourceElementId: 'a',
        targetElementId: 'a',
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
      'istar.setCollapsed': { kind: 'istar.setCollapsed', elementId: 'a', collapsed: true },
      'istar.updateDiagram': { kind: 'istar.updateDiagram', diagram: {} },
      'istar.updateProperties': { kind: 'istar.updateProperties', elementId: 'g1', properties: {} },
      'istar.updateDisplay': {
        kind: 'istar.updateDisplay',
        elementId: 'g1',
        patch: { backgroundColor: '#ffffff' },
      },
      'istar.setLinkValue': { kind: 'istar.setLinkValue', linkId: 'contrib', value: 'make' },
      'istar.updateLinkDisplay': {
        kind: 'istar.updateLinkDisplay',
        linkId: 'contrib',
        patch: { vertices: [{ x: 1, y: 2 }] },
      },
      'istar.changeLinkKind': {
        kind: 'istar.changeLinkKind',
        linkIds: [],
        elementTypeId: 'istar.ContributionLink',
      },
      'istar.setFileMetamodel': { kind: 'istar.setFileMetamodel', block: null },
      'istar.updateModelExtra': { kind: 'istar.updateModelExtra', set: { x: 1 } },
      'istar.replaceModel': { kind: 'istar.replaceModel', model: { actors: [] } },
      requestModel: { kind: 'requestModel', requestId: 'r1' },
      requestTypeHints: { kind: 'requestTypeHints', requestId: 'r2' },
      requestCheckEdge: {
        kind: 'requestCheckEdge',
        requestId: 'r3',
        edgeType: 'istar.DependencyLink',
        sourceElementId: 'a',
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
      triggerNodeCreation: { kind: 'triggerNodeCreation', elementTypeId: 'istar.Goal' },
      triggerEdgeCreation: { kind: 'triggerEdgeCreation', elementTypeId: 'x.Joint' },
      deleteMarkers: { kind: 'deleteMarkers', markers: [] },
    };

    const kinds = allHandledKinds();
    expect(Object.keys(ACTIONS).toSorted()).toEqual(kinds.toSorted());

    for (const kind of kinds) {
      const result = await dispatcher.dispatch(ACTIONS[kind]!);
      expect(isUnknownAction(result), `"${kind}" was rejected as unknown`).toBe(false);
    }

    const rejected = await dispatcher.dispatch({ kind: 'notAKind' } as unknown as IstarAction);
    expect(isUnknownAction(rejected)).toBe(true);
  });
});
