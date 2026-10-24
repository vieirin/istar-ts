import { describe, expect, test, vi } from 'vitest';
import type { GoalDiagnostic, ModelStore, PistarFile } from '@istar-ts/core';
import {
  DEFAULT_PALETTE,
  ISTAR_2_0,
  createModelStore,
  defineProperties,
  extendMetamodel,
  prop,
  toPistar,
  toPistarObject,
} from '@istar-ts/core';
import type { ActionDispatcher, ActionDispatcherOptions, ActionGuard, IstarAction } from '../src';
import { createActionDispatcher, diagnosticToMarker, markerToDiagnostic } from '../src';

let next = 0;
const createId = (): string => `id${++next}`;

/** An actor with two goals and a task, and a second actor. */
function setup(options: ActionDispatcherOptions = {}) {
  next = 0;
  const store = createModelStore(undefined, { metamodel: ISTAR_2_0, createId });
  store.transaction(() => {
    store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
    store.addElement({ kind: 'istar.Goal', id: 'g1', x: 10, y: 10, parent: 'a' });
    store.addElement({ kind: 'istar.Goal', id: 'g2', x: 100, y: 10, parent: 'a' });
    store.addElement({ kind: 'istar.Task', id: 't', x: 50, y: 80, parent: 'a' });
    store.addElement({ kind: 'istar.Agent', id: 'b', x: 400, y: 0 });
  });
  store.clearHistory();
  const dispatcher = createActionDispatcher(store, options);
  return { store, dispatcher, model: store.getModel() };
}

/** Dispatches and expects a rejection that left the model as it was. */
async function expectRejected<EK extends string, LK extends string>(
  { store, dispatcher }: { store: ModelStore<EK, LK>; dispatcher: ActionDispatcher<EK, LK> },
  action: IstarAction<EK, LK>,
): Promise<readonly GoalDiagnostic[]> {
  const before = store.getModel();
  const undoable = store.canUndo();
  const result = await dispatcher.dispatch(action);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  if (result.ok) throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(store.getModel()).toBe(before);
  expect(store.canUndo()).toBe(undoable);
  return result.diagnostics;
}

describe('operations', () => {
  test('return the ids they created, in model order', async () => {
    const env = setup();
    const node = await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Quality',
      containerId: 'a',
      args: { name: 'Fast' },
    });
    expect(node).toEqual({ ok: true, createdIds: ['id1'] });
    expect(env.store.getModel().elements.get('id1')).toMatchObject({
      name: 'Fast',
      parent: 'a',
      x: 0,
      y: 0,
    });

    const dependency = await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: 'a',
      targetElementId: 'b',
    });
    // The dependum (the metamodel's first dependum kind by default), then its two links.
    expect(dependency).toEqual({ ok: true, createdIds: ['id2', 'id3', 'id4'] });
    expect(env.store.getModel().elements.get('id2')).toMatchObject({
      kind: 'istar.Goal',
      isDependum: true,
    });
  });

  test('a contribution takes its value, and only a value of its kind', async () => {
    const env = setup();
    const edge = {
      kind: 'createEdge',
      elementTypeId: 'istar.ContributionLink',
      sourceElementId: 't',
      targetElementId: 'g1',
    } as const;
    const [d] = await expectRejected(env, { ...edge, args: { value: 'awful' } });
    expect(d).toMatchObject({ code: 'invalid-value', elementId: 't' });
    // A Goal is no Quality: canLink's own diagnostic.
    expect((await env.dispatcher.dispatch({ ...edge, args: { value: 'help' } })).ok).toBe(false);
  });

  test('a link canLink refuses is rejected with its code, anchored on the offending end', async () => {
    const env = setup();
    const diagnostics = await expectRejected(env, {
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 'g1',
      targetElementId: 'g1',
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ elementId: 'g1', severity: 'error', code: 'self-link' }),
    ]);
  });

  test('unknown ids, kinds and misplaced elements are rejected', async () => {
    const env = setup();
    const unknown = await expectRejected(env, { kind: 'deleteElement', elementIds: ['g1', 'x'] });
    expect(unknown).toEqual([expect.objectContaining({ elementId: 'x', code: 'unknown-element' })]);
    await expectRejected(env, { kind: 'createNode', elementTypeId: 'istar.Nope' as 'istar.Goal' });
    // An iStar 2.0 goal cannot be on paper, and an actor cannot be in an actor (core's error).
    await expectRejected(env, { kind: 'createNode', elementTypeId: 'istar.Goal' });
    const nested = await expectRejected(env, {
      kind: 'createNode',
      elementTypeId: 'istar.Role',
      containerId: 'a',
    });
    expect(nested[0]?.message).toBe('actors cannot be nested');
    await expectRejected(env, { kind: 'istar.setCollapsed', elementId: 'g1', collapsed: true });
    await expectRejected(env, { kind: 'applyLabelEdit', labelId: 'x#key', text: '' });
    await expectRejected(env, {
      kind: 'istar.updateProperties',
      elementId: 'g1',
      properties: { n: 1 as unknown as string },
    });
  });

  test('a compound operation is one undo step, and all or nothing', async () => {
    const env = setup();
    const changes = vi.fn<(action: IstarAction) => void>();
    env.dispatcher.subscribe(changes);
    const result = await env.dispatcher.dispatch({
      kind: 'compound',
      operationList: [
        { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: 'a', args: { id: 'n' } },
        {
          kind: 'createEdge',
          elementTypeId: 'istar.OrRefinementLink',
          sourceElementId: 'n',
          targetElementId: 'g1',
        },
        { kind: 'applyLabelEdit', labelId: 'n', text: 'Renamed' },
      ],
    });
    expect(result).toEqual({ ok: true, createdIds: ['n', 'id1'] });
    // One change event for the whole compound.
    expect(changes.mock.calls.filter(([a]) => a.kind === 'sourceModelChanged')).toHaveLength(1);
    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(env.model);
    expect(env.store.canUndo()).toBe(false);

    await expectRejected(env, {
      kind: 'compound',
      operationList: [
        { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: 'a', args: { id: 'n' } },
        {
          kind: 'createEdge',
          elementTypeId: 'istar.OrRefinementLink',
          sourceElementId: 'n',
          targetElementId: 'missing',
        },
      ],
    });
  });

  test('reconnectEdge keeps the link in place and checks its new ends', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'l', customProperties: { k: 'v' } },
    });
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 'g2',
      targetElementId: 'g1',
      args: { id: 'l2' },
    });
    const result = await env.dispatcher.dispatch({
      kind: 'reconnectEdge',
      edgeElementId: 'l',
      sourceElementId: 't',
      targetElementId: 'g2',
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    const model = env.store.getModel();
    expect([...model.links.keys()]).toEqual(['l', 'l2']);
    expect(model.links.get('l')).toEqual({
      id: 'l',
      kind: 'istar.AndRefinementLink',
      source: 't',
      target: 'g2',
      customProperties: { k: 'v' },
    });
    // New ends are checked too.
    await expectRejected(env, {
      kind: 'reconnectEdge',
      edgeElementId: 'l',
      sourceElementId: 'g2',
      targetElementId: 'g2',
    });
  });

  test('a dependency link keeps its dependum when reconnected', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: 'g1',
      targetElementId: 'b',
      args: { dependum: { kind: 'istar.Resource', id: 'r' }, linkIds: ['in', 'out'] },
    });
    await expectRejected(env, {
      kind: 'reconnectEdge',
      edgeElementId: 'in',
      sourceElementId: 'g1',
      targetElementId: 'g2',
    });
    const result = await env.dispatcher.dispatch({
      kind: 'reconnectEdge',
      edgeElementId: 'in',
      sourceElementId: 'g2',
      targetElementId: 'r',
    });
    expect(result.ok).toBe(true);
    expect(env.store.getModel().links.get('in')).toMatchObject({ source: 'g2', target: 'r' });
  });

  test('applyLabelEdit and updateProperties write strings, null removes a key', async () => {
    const env = setup();
    await env.dispatcher.dispatch({ kind: 'applyLabelEdit', labelId: 'g1#a#b', text: '1' });
    await env.dispatcher.dispatch({
      kind: 'istar.updateProperties',
      elementId: 'g1',
      properties: { c: '2' },
    });
    expect(env.store.getModel().elements.get('g1')?.customProperties).toEqual({
      'a#b': '1',
      c: '2',
    });
    await env.dispatcher.dispatch({
      kind: 'istar.updateProperties',
      elementId: 'g1',
      properties: { 'a#b': null, c: null },
    });
    expect(env.store.getModel().elements.get('g1')?.customProperties).toBeUndefined();
  });
});

describe('guards', () => {
  test('an error blocks the operation; other severities pass with the result', async () => {
    const seen: string[] = [];
    const noTasks: ActionGuard = (operation, model) => {
      seen.push(`${operation.kind}:${model.elements.size}`);
      if (operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task') {
        return [{ elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' }];
      }
      if (operation.kind === 'createNode') {
        return [{ elementId: '', severity: 'warning', message: 'are you sure?' }];
      }
    };
    const env = setup({ guards: [noTasks] });
    const diagnostics = await expectRejected(env, {
      kind: 'compound',
      operationList: [
        { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: 'a' },
        { kind: 'createNode', elementTypeId: 'istar.Task', containerId: 'a' },
      ],
    });
    expect(diagnostics).toEqual([
      { elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' },
    ]);
    // The compound first, then each operation against the model as the previous left it.
    expect(seen).toEqual(['compound:5', 'createNode:5', 'createNode:6']);

    const result = await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: 'a',
    });
    expect(result).toMatchObject({
      ok: true,
      diagnostics: [{ severity: 'warning', message: 'are you sure?' }],
    });
  });
});

describe('property schemas', () => {
  const schema = defineProperties('istar.Goal', {
    priority: prop.number({ min: 0, optional: true }),
  });

  test('an operation that adds an issue is rejected; existing issues do not block', async () => {
    const env = setup({ schemas: [schema] });
    const diagnostics = await expectRejected(env, {
      kind: 'istar.updateProperties',
      elementId: 'g1',
      properties: { priority: 'high' },
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ elementId: 'g1', key: 'priority', code: 'invalid-property' }),
    ]);
    env.store.updateElement('g2', { customProperties: { priority: '-1' } });
    const rename = await env.dispatcher.dispatch({
      kind: 'applyLabelEdit',
      labelId: 'g2',
      text: 'Still invalid',
    });
    expect(rename.ok).toBe(true);
  });
});

describe('requests', () => {
  test('requestModel answers with the piStar file', async () => {
    // Pinned: requestModel and toPistarObject below each call `new Date()` for saveDate, and a
    // tick between the two would flake the comparison.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    try {
      const env = setup();
      const result = await env.dispatcher.dispatch({ kind: 'requestModel', requestId: 'r1' });
      expect(result).toEqual({
        ok: true,
        createdIds: [],
        response: { kind: 'setModel', responseId: 'r1', newRoot: toPistarObject(env.model) },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('requestTypeHints answers from the metamodel', async () => {
    const env = setup();
    const result = await env.dispatcher.dispatch({ kind: 'requestTypeHints', requestId: 'r' });
    if (!result.ok || !result.response) throw new Error('expected a response');
    const { shapeHints, edgeHints } = result.response;
    expect(shapeHints.map((h) => h.elementTypeId)).toEqual([...ISTAR_2_0.elements.keys()]);
    expect(shapeHints.find((h) => h.elementTypeId === 'istar.Actor')).toMatchObject({
      reparentable: false,
      containableElementTypeIds: ['istar.Goal', 'istar.Quality', 'istar.Resource', 'istar.Task'],
    });
    expect(edgeHints.find((h) => h.elementTypeId === 'istar.IsALink')).toMatchObject({
      sourceElementTypeIds: ['istar.Actor', 'istar.Agent', 'istar.Role'],
      dynamic: true,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('requestCheckEdge runs canLink, reversed where piStar retries', async () => {
    const env = setup();
    const check = async (edgeType: string, source: string, target?: string) => {
      const result = await env.dispatcher.dispatch({
        kind: 'requestCheckEdge',
        requestId: 'c',
        edgeType,
        sourceElementId: source,
        ...(target === undefined ? {} : { targetElementId: target }),
      });
      if (!result.ok || !result.response) throw new Error('expected a response');
      return result.response;
    };
    expect(await check('istar.AndRefinementLink', 't', 'g1')).toEqual({
      kind: 'checkEdgeTargetResult',
      responseId: 'c',
      isValid: true,
      edgeType: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
    });
    expect(await check('istar.AndRefinementLink', 'g1', 'g1')).toMatchObject({
      isValid: false,
      code: 'self-link',
    });
    expect(await check('istar.IsALink', 'g1')).toMatchObject({
      isValid: false,
      code: 'invalid-source',
    });
    expect(await check('istar.IsALink', 'a')).toMatchObject({ isValid: true });
  });

  test('requestContextActions answers with the palette', async () => {
    const env = setup();
    const result = await env.dispatcher.dispatch({
      kind: 'requestContextActions',
      requestId: 'p',
      contextId: 'tool-palette',
      editorContext: { selectedElementIds: [] },
    });
    if (!result.ok || !result.response) throw new Error('expected a response');
    const { actions, groups } = result.response;
    expect(groups).toEqual(DEFAULT_PALETTE.groups);
    expect(actions[0]).toEqual({
      id: 'istar.Actor',
      label: 'Actor',
      order: 0,
      group: 'actors',
      section: 'actors',
      actions: [{ kind: 'triggerNodeCreation', elementTypeId: 'istar.Actor' }],
    });
    expect(actions.find((a) => a.label === 'Help (+)')?.actions).toEqual([
      {
        kind: 'triggerEdgeCreation',
        elementTypeId: 'istar.ContributionLink',
        args: { value: 'help' },
      },
    ]);
    expect(actions.find((a) => a.label === 'Resource dependency')?.actions).toEqual([
      {
        kind: 'triggerEdgeCreation',
        elementTypeId: 'istar.DependencyLink',
        args: { dependum: { kind: 'istar.Resource' } },
      },
    ]);
    const orders = actions.map((a) => a.order ?? Infinity);
    expect(orders).toEqual(orders.toSorted((x, y) => x - y));
  });

  test('a palette option replaces the default, kinds outside the metamodel left out', async () => {
    const env = setup({
      palette: {
        elements: { 'istar.Goal': { label: 'Objective' }, 'other.Kind': { label: 'Other' } },
        links: {},
        groups: {},
      },
    });
    const result = await env.dispatcher.dispatch({
      kind: 'requestContextActions',
      requestId: 'p',
      contextId: 'tool-palette',
      editorContext: { selectedElementIds: [] },
    });
    expect(result.ok && result.response?.actions.map((a) => a.label)).toEqual(['Objective']);
  });

  test('requestMarkers reports link issues, property issues and the host diagnostics', async () => {
    const schema = defineProperties('istar.Goal', { priority: prop.number({ optional: true }) });
    const host: GoalDiagnostic = {
      elementId: 'g2',
      severity: 'warning',
      message: 'unreachable',
      source: 'mutrose',
      code: 'M1',
    };
    const env = setup({ schemas: [schema], diagnostics: () => [host] });
    env.store.updateElement('g1', { customProperties: { priority: 'high' } });
    // An invalid link, as a loaded file may have one.
    env.store.connect(
      { kind: 'istar.AndRefinementLink', source: 'g1', target: 'g1', id: 'bad' },
      { force: true },
    );
    const request = async (elementsIDs: string[]) => {
      const result = await env.dispatcher.dispatch({
        kind: 'requestMarkers',
        requestId: 'm',
        elementsIDs,
        reason: 'batch',
      });
      if (!result.ok || !result.response) throw new Error('expected a response');
      expect(result.response).toMatchObject({ responseId: 'm', reason: 'batch' });
      return result.response.markers;
    };
    const all = await request(['the-root']);
    expect(all.map((m) => [m.elementId, m.kind])).toEqual([
      ['bad', 'error'],
      ['g1', 'error'],
      ['g2', 'warning'],
    ]);
    expect(all[2]).toEqual({
      label: 'unreachable',
      description: 'unreachable (mutrose)',
      elementId: 'g2',
      kind: 'warning',
      source: 'mutrose',
      code: 'M1',
    });
    expect(markerToDiagnostic(all[2]!)).toEqual({ ...host });
    expect(await request(['g2'])).toHaveLength(1);
  });
});

describe('markers', () => {
  test('convert to and from diagnostics', () => {
    const d: GoalDiagnostic = { elementId: 'e', key: 'k', severity: 'hint', message: 'm' };
    expect(markerToDiagnostic(diagnosticToMarker(d))).toEqual(d);
    expect(
      markerToDiagnostic({ label: 'l', description: 'd', elementId: 'e', kind: 'custom' }),
    ).toEqual({ elementId: 'e', severity: 'info', message: 'l' });
  });
});

describe('subscribers', () => {
  test('hear every model change, whoever made it, and the dirty state', async () => {
    const env = setup();
    const heard: IstarAction[] = [];
    const unsubscribe = env.dispatcher.subscribe((a) => heard.push(a));
    env.store.moveElement('b', 500, 0);
    expect(heard).toEqual([
      {
        kind: 'sourceModelChanged',
        sourceModelName: '',
        source: 'edit',
        changes: [{ type: 'moveElement', id: 'b', x: 500, y: 0 }],
      },
      { kind: 'setDirtyState', isDirty: true, reason: 'operation' },
    ]);
    heard.length = 0;
    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(heard).toEqual([
      { kind: 'sourceModelChanged', sourceModelName: '', source: 'undo', changes: [] },
      { kind: 'setDirtyState', isDirty: false, reason: 'undo' },
    ]);
    heard.length = 0;
    await env.dispatcher.dispatch({ kind: 'triggerNodeCreation', elementTypeId: 'istar.Goal' });
    expect(heard).toEqual([{ kind: 'triggerNodeCreation', elementTypeId: 'istar.Goal' }]);
    for (const action of heard) expect(JSON.parse(JSON.stringify(action))).toEqual(action);

    unsubscribe();
    env.store.moveElement('b', 0, 0);
    expect(heard).toHaveLength(1);
    env.dispatcher.dispose();
  });

  test('do not hear requests answered or rejections', async () => {
    const env = setup();
    const listener = vi.fn<(action: IstarAction) => void>();
    env.dispatcher.subscribe(listener);
    await env.dispatcher.dispatch({ kind: 'requestModel', requestId: '1' });
    await env.dispatcher.dispatch({ kind: 'deleteElement', elementIds: ['x'] });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  test('goes through the host callback and clears the dirty state', async () => {
    const files: PistarFile[] = [];
    const env = setup({ save: async (file) => void files.push(file), sourceModelName: 'm.txt' });
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    await env.dispatcher.dispatch({ kind: 'istar.updateDiagram', diagram: { name: 'Saved' } });
    expect(env.dispatcher.isDirty()).toBe(true);
    expect(await env.dispatcher.dispatch({ kind: 'saveModel', fileUri: 'm.txt' })).toEqual({
      ok: true,
      createdIds: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.diagram?.name).toBe('Saved');
    expect(env.dispatcher.isDirty()).toBe(false);
    expect(heard.at(-1)).toEqual({ kind: 'setDirtyState', isDirty: false, reason: 'save' });
    expect(heard[0]).toMatchObject({ kind: 'sourceModelChanged', sourceModelName: 'm.txt' });
  });

  test('is rejected without a callback', async () => {
    const env = setup();
    const [d] = await expectRejected(env, { kind: 'saveModel' });
    expect(d?.code).toBe('no-save-handler');
  });

  test('a load is a saved state', () => {
    const env = setup();
    env.store.moveElement('b', 1, 1);
    expect(env.dispatcher.isDirty()).toBe(true);
    env.store.load(env.model);
    expect(env.dispatcher.isDirty()).toBe(false);
  });
});

test('unknown action kinds are rejected', async () => {
  const env = setup();
  const [d] = await expectRejected(env, { kind: 'cut' } as unknown as IstarAction);
  expect(d?.code).toBe('unknown-action');
});

describe('an extended metamodel', () => {
  // Generic over kinds: an extension node kind and an n-ary link kind (hub, legs, end).
  const METAMODEL = extendMetamodel(ISTAR_2_0, {
    name: 'x',
    links: [
      {
        kind: 'x.Joint',
        arity: 'n',
        rules: { sources: ['istar.Goal', 'x.Step'], targets: ['istar.Goal'] },
      },
    ],
    elements: [{ kind: 'x.Step', behavesLike: 'istar.Task' }],
  });

  function extended() {
    next = 0;
    const store = createModelStore(undefined, { metamodel: METAMODEL, createId });
    store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
    const dispatcher = createActionDispatcher(store);
    return { store, dispatcher, model: store.getModel() };
  }

  test('creates, joins and parts n-ary links, each one undo step', async () => {
    const { store, dispatcher } = extended();
    const create = (id: string, kind: 'istar.Goal' | 'x.Step') =>
      dispatcher.dispatch({
        kind: 'createNode',
        elementTypeId: kind,
        containerId: 'a',
        args: { id },
      });
    for (const [id, kind] of [
      ['top', 'istar.Goal'],
      ['s1', 'x.Step'],
      ['s2', 'istar.Goal'],
      ['s3', 'x.Step'],
    ] as const) {
      expect((await create(id, kind)).ok).toBe(true);
    }
    const joint = await dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'x.Joint',
      sourceElementId: 's1',
      targetElementId: 'top',
      args: { id: 'hub' },
    });
    // The hub, then its leg and end.
    expect(joint).toEqual({ ok: true, createdIds: ['hub', 'id1', 'id2'] });

    const before = store.getModel();
    const file = toPistar(before);
    const leg = await dispatcher.dispatch({
      kind: 'istar.addLeg',
      hubId: 'hub',
      sourceElementId: 's2',
      args: { id: 'leg2' },
    });
    expect(leg).toEqual({ ok: true, createdIds: ['leg2'] });
    await dispatcher.dispatch({ kind: 'glspUndo' });
    expect(store.getModel()).toBe(before);
    expect(toPistar(store.getModel())).toBe(file);
    await dispatcher.dispatch({ kind: 'glspRedo' });

    // A leg moves to another source; the last leg cannot leave its hub.
    const moved = await dispatcher.dispatch({
      kind: 'reconnectEdge',
      edgeElementId: 'leg2',
      sourceElementId: 's3',
      targetElementId: 'hub',
    });
    expect(moved.ok).toBe(true);
    const removed = await dispatcher.dispatch({ kind: 'istar.removeLeg', legId: 'id1' });
    expect(removed.ok).toBe(true);
    const diagnostics = await expectRejected(
      { store, dispatcher },
      {
        kind: 'reconnectEdge',
        edgeElementId: 'leg2',
        sourceElementId: 's3',
        targetElementId: 'top',
      },
    );
    expect(diagnostics[0]?.code).toBe('hub-target');
    // A hub is made by its link, not on its own.
    await expectRejected(
      { store, dispatcher },
      { kind: 'createNode', elementTypeId: 'x.JointHub', containerId: 'a' },
    );
  });

  test('type hints and the palette cover the extension kinds', async () => {
    const { dispatcher } = extended();
    const hints = await dispatcher.dispatch({ kind: 'requestTypeHints', requestId: 'h' });
    if (!hints.ok || !hints.response) throw new Error('expected a response');
    expect(hints.response.shapeHints.find((h) => h.elementTypeId === 'x.JointHub')).toMatchObject({
      resizable: false,
      reparentable: false,
    });
    expect(hints.response.edgeHints.find((h) => h.elementTypeId === 'x.Joint')).toMatchObject({
      sourceElementTypeIds: ['istar.Goal', 'x.Step'],
      targetElementTypeIds: ['istar.Goal'],
    });
    // iStar 2.0's Task links take a Step, which behaves like a Task.
    expect(
      hints.response.edgeHints.find((h) => h.elementTypeId === 'istar.AndRefinementLink')
        ?.sourceElementTypeIds,
    ).toContain('x.Step');
  });

  test('actions are typed by the store kinds', async () => {
    const { dispatcher } = extended();
    const ok = await dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'x.Step',
      containerId: 'a',
    });
    expect(ok.ok).toBe(true);
    // @ts-expect-error: not a kind of the metamodel
    await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'y.Step', containerId: 'a' });
  });
});
