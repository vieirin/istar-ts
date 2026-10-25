import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { AnyPaletteDescription, GoalDiagnostic, ModelStore, PistarFile } from '@istar-ts/core';
import {
  DEFAULT_PALETTE,
  ISTAR_2_0,
  createModelStore,
  defineProperties,
  extendMetamodel,
  parsePistar,
  prop,
  toPistar,
  toPistarObject,
} from '@istar-ts/core';
import type {
  ActionDispatcher,
  ActionDispatcherOptions,
  ActionGuard,
  ActionPostGuard,
  IstarAction,
} from '../src';
import { createActionDispatcher, diagnosticToMarker, markerToDiagnostic } from '../src';
import { loadFixtures } from './fixtures';

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
    // Removing the last property keeps an empty object, as piStar writes it (#219).
    expect(env.store.getModel().elements.get('g1')?.customProperties).toEqual({});
  });

  test('removing the last custom property serializes "customProperties": {} on elements and links (#219)', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'l' },
    });
    for (const elementId of ['g1', 'l']) {
      await env.dispatcher.dispatch({
        kind: 'istar.updateProperties',
        elementId,
        properties: { a: '1' },
      });
      await env.dispatcher.dispatch({
        kind: 'istar.updateProperties',
        elementId,
        properties: { a: null },
      });
    }
    const model = env.store.getModel();
    expect(model.elements.get('g1')?.customProperties).toEqual({});
    expect(model.links.get('l')?.customProperties).toEqual({});
    const file = JSON.parse(toPistar(model)) as {
      actors: { nodes: { id: string; customProperties?: unknown }[] }[];
      links: { id: string; customProperties?: unknown }[];
    };
    const node = file.actors.flatMap((a) => a.nodes).find((n) => n.id === 'g1');
    expect(node).toHaveProperty('customProperties', {});
    expect(file.links.find((l) => l.id === 'l')).toHaveProperty('customProperties', {});
  });

  test('removing a property an owner never had leaves its customProperties as they were (#219)', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      args: { id: 'fresh' },
    });
    const before = env.store.getModel().elements.get('fresh')?.customProperties;
    await env.dispatcher.dispatch({
      kind: 'istar.updateProperties',
      elementId: 'fresh',
      properties: { a: null },
    });
    expect(env.store.getModel().elements.get('fresh')?.customProperties).toEqual(before);
  });

  test('applyLabelEdit on a link: an empty text removes its name, as piStar writes it', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'l', name: 'Original' },
    });
    const before = env.store.getModel();
    const file = toPistar(before);
    expect(file).toContain('"name": "Original"');

    const result = await env.dispatcher.dispatch({
      kind: 'applyLabelEdit',
      labelId: 'l',
      text: '',
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().links.get('l')?.name).toBeUndefined();
    expect(toPistar(env.store.getModel())).not.toContain('"name"');

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).toBe(file);

    await expectRejected(env, { kind: 'applyLabelEdit', labelId: 'missing', text: 'x' });
  });

  test('istar.updateDisplay merges into display, like changeBounds for an arbitrary key', async () => {
    const env = setup();
    const before = env.store.getModel();
    const file = toPistar(before);

    const result = await env.dispatcher.dispatch({
      kind: 'istar.updateDisplay',
      elementId: 'g1',
      patch: { backgroundColor: '#fff' },
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().elements.get('g1')?.display).toEqual({ backgroundColor: '#fff' });

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).toBe(file);

    await expectRejected(env, {
      kind: 'istar.updateDisplay',
      elementId: 'missing',
      patch: { backgroundColor: '#fff' },
    });
  });

  test("istar.updateLinkDisplay merges into a link's display, like istar.updateDisplay for an element", async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Quality',
      containerId: 'a',
      args: { id: 'q' },
    });
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.ContributionLink',
      sourceElementId: 't',
      targetElementId: 'q',
      args: { id: 'c', value: 'help' },
    });
    const before = env.store.getModel();
    const file = toPistar(before);

    const result = await env.dispatcher.dispatch({
      kind: 'istar.updateLinkDisplay',
      linkId: 'c',
      patch: { vertices: [{ x: 1, y: 2 }] },
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().links.get('c')?.display).toEqual({
      vertices: [{ x: 1, y: 2 }],
    });

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).toBe(file);

    await expectRejected(env, {
      kind: 'istar.updateLinkDisplay',
      linkId: 'missing',
      patch: { vertices: [] },
    });
  });

  test("istar.setLinkValue sets a contribution link's value, checked against its kind", async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Quality',
      containerId: 'a',
      args: { id: 'q' },
    });
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.ContributionLink',
      sourceElementId: 't',
      targetElementId: 'q',
      args: { id: 'c', value: 'help' },
    });
    const before = env.store.getModel();
    const file = toPistar(before);

    const result = await env.dispatcher.dispatch({
      kind: 'istar.setLinkValue',
      linkId: 'c',
      value: 'hurt',
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().links.get('c')?.label).toBe('hurt');

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).toBe(file);

    const [d] = await expectRejected(env, {
      kind: 'istar.setLinkValue',
      linkId: 'c',
      value: 'awful',
    });
    expect(d).toMatchObject({ code: 'invalid-value', elementId: 'c' });
    await expectRejected(env, { kind: 'istar.setLinkValue', linkId: 'missing', value: 'help' });

    await env.dispatcher.dispatch({ kind: 'istar.setLinkValue', linkId: 'c', value: null });
    expect(env.store.getModel().links.get('c')?.label).toBeUndefined();
  });

  test('istar.changeLinkKind rewrites every listed link in place, as one undo step', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'r1', name: 'first' },
    });
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 'g2',
      targetElementId: 'g1',
      args: { id: 'r2' },
    });
    const before = env.store.getModel();
    const file = toPistar(before);

    const result = await env.dispatcher.dispatch({
      kind: 'istar.changeLinkKind',
      linkIds: ['r1', 'r2'],
      elementTypeId: 'istar.OrRefinementLink',
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    const after = env.store.getModel();
    expect(after.links.get('r1')).toMatchObject({
      kind: 'istar.OrRefinementLink',
      source: 't',
      target: 'g1',
      name: 'first',
    });
    expect(after.links.get('r2')).toMatchObject({ kind: 'istar.OrRefinementLink' });
    // Order and identity of other links/elements are untouched.
    expect([...after.links.keys()]).toEqual([...before.links.keys()]);

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).toBe(file);
  });

  test('istar.changeLinkKind is a no-op for an empty list, or links already of that kind', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'r1' },
    });
    const before = env.store.getModel();

    const empty = await env.dispatcher.dispatch({
      kind: 'istar.changeLinkKind',
      linkIds: [],
      elementTypeId: 'istar.OrRefinementLink',
    });
    expect(empty).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel()).toBe(before);

    const same = await env.dispatcher.dispatch({
      kind: 'istar.changeLinkKind',
      linkIds: ['r1'],
      elementTypeId: 'istar.AndRefinementLink',
    });
    expect(same).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel()).toBe(before);
  });

  test('istar.changeLinkKind rejects an unknown link, unknown kind, or a canLink refusal, untouched', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.AndRefinementLink',
      sourceElementId: 't',
      targetElementId: 'g1',
      args: { id: 'r1' },
    });
    await expectRejected(env, {
      kind: 'istar.changeLinkKind',
      linkIds: ['missing'],
      elementTypeId: 'istar.OrRefinementLink',
    });
    await expectRejected(env, {
      kind: 'istar.changeLinkKind',
      linkIds: ['r1'],
      elementTypeId: 'istar.Nope' as 'istar.OrRefinementLink',
    });
    // A Dependency link's ends (two actors) fail an AND-refinement's "must be a Goal or Task".
    await env.dispatcher.dispatch({
      kind: 'createEdge',
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: 'a',
      targetElementId: 'b',
      args: { id: 'dep', linkIds: ['din', 'dout'] },
    });
    const [d] = await expectRejected(env, {
      kind: 'istar.changeLinkKind',
      linkIds: ['din'],
      elementTypeId: 'istar.AndRefinementLink',
    });
    expect(d).toMatchObject({ code: 'invalid-source' });
  });

  test('istar.setFileMetamodel sets, replaces and removes the block, as one undo step', async () => {
    const env = setup();
    const before = env.store.getModel();
    expect(toPistar(before)).not.toContain('"metamodel"');

    const block = {
      name: 'beliefs',
      elements: [{ kind: 'beliefs.Belief', category: 'node' as const }],
    };
    const result = await env.dispatcher.dispatch({ kind: 'istar.setFileMetamodel', block });
    expect(result).toEqual({ ok: true, createdIds: [] });
    const withBlock = env.store.getModel();
    expect(JSON.parse(toPistar(withBlock)).metamodel).toEqual(block);
    const added = await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'beliefs.Belief' as 'istar.Goal',
      containerId: 'a',
    });
    expect(added.ok).toBe(true);

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
    expect(toPistar(env.store.getModel())).not.toContain('"metamodel"');

    await env.dispatcher.dispatch({ kind: 'istar.setFileMetamodel', block });
    const belief = await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'beliefs.Belief' as 'istar.Goal',
      containerId: 'a',
      args: { id: 'bel' },
    });
    if (!belief.ok) throw new Error('setup failed');

    await expectRejected(env, { kind: 'istar.setFileMetamodel', block: null });
    await expectRejected(env, {
      kind: 'istar.setFileMetamodel',
      block: { name: 'x', elements: [{ kind: 3 as unknown as string, category: 'node' }] },
    });

    const cleared = await env.dispatcher.dispatch({
      kind: 'istar.setFileMetamodel',
      block: { name: 'beliefs' },
    });
    expect(cleared.ok).toBe(false);
    await env.dispatcher.dispatch({ kind: 'deleteElement', elementIds: ['bel'] });
    const removed = await env.dispatcher.dispatch({ kind: 'istar.setFileMetamodel', block: null });
    expect(removed).toEqual({ ok: true, createdIds: [] });
    expect(toPistar(env.store.getModel())).not.toContain('"metamodel"');
  });

  test('istar.updateModelExtra sets, changes and removes extra keys, keeping order, as one undo step', async () => {
    const env = setup();
    const before = env.store.getModel();

    const set = await env.dispatcher.dispatch({
      kind: 'istar.updateModelExtra',
      set: { metamodelVersion: '1.0', vendor: 'acme' },
    });
    expect(set).toEqual({ ok: true, createdIds: [] });
    const withExtra = env.store.getModel();
    expect(withExtra.extra).toEqual({ metamodelVersion: '1.0', vendor: 'acme' });
    expect(Object.keys(JSON.parse(toPistar(withExtra)))).toContain('metamodelVersion');

    // Changing an existing key keeps its place; a removal is dropped entirely.
    const change = await env.dispatcher.dispatch({
      kind: 'istar.updateModelExtra',
      set: { metamodelVersion: '2.0' },
      remove: ['vendor'],
    });
    expect(change).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().extra).toEqual({ metamodelVersion: '2.0' });

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel().extra).toEqual({ metamodelVersion: '1.0', vendor: 'acme' });
    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
  });

  test('istar.updateModelExtra sets and removes the model-level "tool" in the same undo step', async () => {
    const env = setup();
    const originalTool = env.store.getModel().tool;

    const result = await env.dispatcher.dispatch({
      kind: 'istar.updateModelExtra',
      tool: 'dsm3-goals',
      set: { metamodelVersion: '1.0' },
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel()).toMatchObject({
      tool: 'dsm3-goals',
      extra: { metamodelVersion: '1.0' },
    });

    const removed = await env.dispatcher.dispatch({
      kind: 'istar.updateModelExtra',
      tool: null,
    });
    expect(removed).toEqual({ ok: true, createdIds: [] });
    expect(env.store.getModel().tool).toBeUndefined();

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel().tool).toBe('dsm3-goals');
    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel().tool).toBe(originalTool);
  });

  test('istar.updateModelExtra rejects keys core models itself, model untouched', async () => {
    const env = setup();
    for (const key of [
      'actors',
      'orphans',
      'dependencies',
      'links',
      'display',
      'istar',
      'saveDate',
      'diagram',
    ]) {
      const [d] = await expectRejected(env, {
        kind: 'istar.updateModelExtra',
        set: { [key]: 'x' },
      });
      expect(d).toMatchObject({ code: 'reserved-key' });
    }
    const [toolDiagnostic] = await expectRejected(env, {
      kind: 'istar.updateModelExtra',
      set: { tool: 'x' },
    });
    expect(toolDiagnostic).toMatchObject({
      code: 'reserved-key',
      message: expect.stringContaining('tool'),
    });
    const [removeDiagnostic] = await expectRejected(env, {
      kind: 'istar.updateModelExtra',
      remove: ['saveDate'],
    });
    expect(removeDiagnostic).toMatchObject({ code: 'reserved-key' });
    const [metamodelDiagnostic] = await expectRejected(env, {
      kind: 'istar.updateModelExtra',
      set: { metamodel: { name: 'x' } },
    });
    expect(metamodelDiagnostic).toMatchObject({
      code: 'reserved-key',
      message: expect.stringContaining('setFileMetamodel'),
    });
  });

  test('istar.replaceModel replaces the model as one undo step; undo restores it by identity', async () => {
    const env = setup();
    const before = env.store.getModel();
    const replacement = parsePistar(toPistar(before));
    const result = await env.dispatcher.dispatch({
      kind: 'istar.replaceModel',
      model: JSON.parse(toPistar(before)) as PistarFile,
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(toPistar(env.store.getModel())).toBe(toPistar(replacement));
    expect(env.store.getModel()).not.toBe(before);

    await env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel()).toBe(before);
  });

  test('istar.replaceModel: a postGuard rejection leaves the model untouched', async () => {
    const reject: ActionPostGuard = (operation) => {
      if (operation.kind !== 'istar.replaceModel') return;
      return [{ elementId: '', severity: 'error', message: 'nope' }];
    };
    const env = setup({ postGuards: [reject] });
    const diagnostics = await expectRejected(env, {
      kind: 'istar.replaceModel',
      model: JSON.parse(toPistar(env.store.getModel())) as PistarFile,
    });
    expect(diagnostics).toEqual([{ elementId: '', severity: 'error', message: 'nope' }]);
  });

  test('istar.replaceModel: a parse error rejects with a typed diagnostic, model untouched', async () => {
    const env = setup();
    const [d] = await expectRejected(env, {
      kind: 'istar.replaceModel',
      model: { actors: [{ id: 'x' }] } as unknown as PistarFile,
    });
    expect(d).toMatchObject({ code: 'parse-error' });
    expect(d?.message.length).toBeGreaterThan(0);
  });
});

describe('istar.changeLinkKind: piStar parity (#199)', () => {
  // goal-controller's `setRefinement` (packages/ui/lib/workbench/pistar.ts:222-241) rewrites
  // every AND/OR-refinement link into a goal by rebuilding the links map in place, same ids and
  // order, then `inheritSourceLayout`. `istar.changeLinkKind` must write the same bytes.
  test('converting every AND-refinement link into a target to OR matches a hand-rewritten file', async () => {
    const fixture = loadFixtures().find((f) => f.name === 'pistar/buyerDrivenECommerce.txt')!;
    const initial = parsePistar(fixture.text);
    const target = 'be1aa6fc-66dd-40f8-af03-a652352793e1';
    const linkIds = [...initial.links.values()]
      .filter((l) => l.target === target && l.kind === 'istar.AndRefinementLink')
      .map((l) => l.id);
    expect(linkIds.length).toBeGreaterThan(1);

    const expectedJson = JSON.parse(fixture.text) as { links: { id: string; type: string }[] };
    for (const link of expectedJson.links) {
      if (linkIds.includes(link.id)) link.type = 'istar.OrRefinementLink';
    }

    const store = createModelStore(initial);
    const dispatcher = createActionDispatcher(store);
    const result = await dispatcher.dispatch({
      kind: 'istar.changeLinkKind',
      linkIds,
      elementTypeId: 'istar.OrRefinementLink',
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(JSON.parse(toPistar(store.getModel()))).toEqual(expectedJson);
  });
});

describe('istar.updateModelExtra: piStar parity (#217)', () => {
  // goal-controller's M2c (writeOptions) changes the model's `tool` and an extra key like
  // `metamodelVersion` in one step. The saved file must be byte-identical to a hand-rewritten one.
  test('changing "tool" and an extra key together matches a hand-rewritten file, undone in one step', async () => {
    const path = join(import.meta.dirname, '../../../fixtures/dsm3/istar2-welcome.txt');
    const text = readFileSync(path, 'utf8');
    const initial = parsePistar(text);

    const expectedJson = JSON.parse(text) as Record<string, unknown>;
    expectedJson.tool = 'dsm3-goals-v2';
    expectedJson.metamodelVersion = '2.0';

    const store = createModelStore(initial);
    const dispatcher = createActionDispatcher(store);
    const before = store.getModel();
    const result = await dispatcher.dispatch({
      kind: 'istar.updateModelExtra',
      tool: 'dsm3-goals-v2',
      set: { metamodelVersion: '2.0' },
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    expect(JSON.parse(toPistar(store.getModel()))).toEqual(expectedJson);

    await dispatcher.dispatch({ kind: 'glspUndo' });
    expect(store.getModel()).toBe(before);
  });
});

describe('istar.setFileMetamodel: piStar parity (#200)', () => {
  // goal-controller's `writeModelExtension` (packages/ui/lib/workbench/pistar.ts:137-152)
  // validates the extension against the dialect, then writes (or removes) the file's own
  // "metamodel" block through `withFileMetamodel`. The saved block must be byte-identical.
  test('removing and re-setting the block round-trips, byte for byte', async () => {
    const path = join(import.meta.dirname, '../../../fixtures/extensions/fileMetamodel.txt');
    const text = readFileSync(path, 'utf8');
    const initial = parsePistar(text, { fileMetamodel: true });
    const block = JSON.parse(text).metamodel;

    const store = createModelStore(initial);
    const dispatcher = createActionDispatcher(store);
    // The model still uses the block's kinds, so removing it is rejected, untouched.
    const before = store.getModel();
    const removed = await dispatcher.dispatch({ kind: 'istar.setFileMetamodel', block: null });
    expect(removed.ok).toBe(false);
    expect(store.getModel()).toBe(before);

    // Re-setting the same block it already has writes the same bytes.
    const reset = await dispatcher.dispatch({ kind: 'istar.setFileMetamodel', block });
    expect(reset).toEqual({ ok: true, createdIds: [] });
    expect(toPistar(store.getModel())).toBe(text);
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

describe('postGuards', () => {
  test('an error rolls back the transaction: no model change, no undo entry, no notification', async () => {
    const rejectRenamed: ActionPostGuard = (operation, modelAfter) => {
      if (operation.kind !== 'applyLabelEdit') return;
      if (modelAfter.elements.get('g1')?.name === 'forbidden') {
        return [{ elementId: 'g1', severity: 'error', message: 'that name is reserved' }];
      }
    };
    const env = setup({ postGuards: [rejectRenamed] });
    const notifications: IstarAction[] = [];
    env.dispatcher.subscribe((action) => notifications.push(action));

    const diagnostics = await expectRejected(env, {
      kind: 'applyLabelEdit',
      labelId: 'g1',
      text: 'forbidden',
    });
    expect(diagnostics).toEqual([
      { elementId: 'g1', severity: 'error', message: 'that name is reserved' },
    ]);
    expect(notifications).toEqual([]);
  });

  test('a warning passes through with ok:true, merged after pre-guard warnings', async () => {
    const warnBefore: ActionGuard = () => [{ elementId: '', severity: 'warning', message: 'pre' }];
    const warnAfter: ActionPostGuard = () => [
      { elementId: '', severity: 'warning', message: 'post' },
    ];
    const env = setup({ guards: [warnBefore], postGuards: [warnAfter] });
    const result = await env.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: 'a',
    });
    expect(result).toMatchObject({
      ok: true,
      diagnostics: [
        { severity: 'warning', message: 'pre' },
        { severity: 'warning', message: 'post' },
      ],
    });
  });

  test('runs after each child of a compound, and once more on the final result', async () => {
    const seen: string[] = [];
    const track: ActionPostGuard = (operation, after, before) => {
      seen.push(`${operation.kind}:${before.elements.size}->${after.elements.size}`);
    };
    const env = setup({ postGuards: [track] });
    const result = await env.dispatcher.dispatch({
      kind: 'compound',
      operationList: [
        { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: 'a' },
        { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: 'a' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['createNode:5->6', 'createNode:6->7', 'compound:5->7']);
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

  test('requestContextActions answers with the palette option', async () => {
    const env = setup({ palette: DEFAULT_PALETTE });
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

  test('with no palette option, requestContextActions follows the model metamodel (#202)', async () => {
    // No `palette` option: the default is `paletteFromMetamodel`'s, not `DEFAULT_PALETTE`
    // (iStar 2.0's own, piStar-faithful palette with grouped contribution/dependency entries).
    const env = setup();
    const result = await env.dispatcher.dispatch({
      kind: 'requestContextActions',
      requestId: 'p',
      contextId: 'tool-palette',
      editorContext: { selectedElementIds: [] },
    });
    if (!result.ok || !result.response) throw new Error('expected a response');
    const { actions, groups } = result.response;
    expect(groups).toEqual({ actors: { label: 'Actor' } });
    expect(actions.find((a) => a.id === 'istar.Actor')).toEqual({
      id: 'istar.Actor',
      label: 'Actor',
      order: 0,
      group: 'actors',
      section: 'actors',
      actions: [{ kind: 'triggerNodeCreation', elementTypeId: 'istar.Actor' }],
    });
    // Not piStar's grouped "Help (+)" contribution entries: one plain link entry per kind.
    expect(actions.find((a) => a.label === 'Help (+)')).toBeUndefined();
    expect(actions.find((a) => a.id === 'istar.ContributionLink#0')).toMatchObject({
      label: 'Contribution',
    });
  });

  test('a palette function is evaluated on each requestContextActions', async () => {
    const palette = vi.fn<() => AnyPaletteDescription>(() => ({
      elements: { 'istar.Goal': { label: 'Objective' } },
      links: {},
      groups: {},
    }));
    const env = setup({ palette });
    expect(palette).not.toHaveBeenCalled();
    const request = () =>
      env.dispatcher.dispatch({
        kind: 'requestContextActions',
        requestId: 'p',
        contextId: 'tool-palette',
        editorContext: { selectedElementIds: [] },
      });
    await request();
    await request();
    expect(palette).toHaveBeenCalledTimes(2);
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

describe('origin', () => {
  test('round-trips on sourceModelChanged and setDirtyState for an operation', async () => {
    const env = setup();
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    await env.dispatcher.dispatch(
      { kind: 'changeBounds', newBounds: [{ elementId: 'b', newPosition: { x: 1, y: 1 } }] },
      { origin: 'canvas' },
    );
    expect(heard).toEqual([
      {
        kind: 'sourceModelChanged',
        sourceModelName: '',
        source: 'edit',
        changes: [{ type: 'moveElement', id: 'b', x: 1, y: 1 }],
        origin: 'canvas',
      },
      { kind: 'setDirtyState', isDirty: true, reason: 'operation', origin: 'canvas' },
    ]);
  });

  test('is absent for a dispatch given none, and for a direct store change', async () => {
    const env = setup();
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    await env.dispatcher.dispatch({
      kind: 'changeBounds',
      newBounds: [{ elementId: 'b', newPosition: { x: 1, y: 1 } }],
    });
    env.store.moveElement('b', 2, 2);
    for (const action of heard) expect(action).not.toHaveProperty('origin');
  });

  test("a compound's changes all carry the origin", async () => {
    const env = setup();
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    await env.dispatcher.dispatch(
      {
        kind: 'compound',
        operationList: [
          { kind: 'changeBounds', newBounds: [{ elementId: 'b', newPosition: { x: 1, y: 1 } }] },
          { kind: 'applyLabelEdit', labelId: 'a', text: 'Renamed' },
        ],
      },
      { origin: 'inspector' },
    );
    const changed = heard.filter(
      (a): a is Extract<IstarAction, { kind: 'sourceModelChanged' }> =>
        a.kind === 'sourceModelChanged',
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]?.changes).toHaveLength(2);
    expect(changed[0]).toMatchObject({ origin: 'inspector' });
  });

  test('undo and redo dispatched with an origin carry it', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'changeBounds',
      newBounds: [{ elementId: 'b', newPosition: { x: 1, y: 1 } }],
    });
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    await env.dispatcher.dispatch({ kind: 'glspUndo' }, { origin: 'canvas' });
    await env.dispatcher.dispatch({ kind: 'glspRedo' }, { origin: 'inspector' });
    const changed = heard.filter((a) => a.kind === 'sourceModelChanged');
    expect(changed).toEqual([
      expect.objectContaining({ source: 'undo', origin: 'canvas' }),
      expect.objectContaining({ source: 'redo', origin: 'inspector' }),
    ]);
  });

  test('a guard-rejected operation emits nothing, origin or not', async () => {
    const guard: ActionGuard = () => [{ elementId: '', severity: 'error', message: 'no' }];
    const env = setup({ guards: [guard] });
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    const result = await env.dispatcher.dispatch(
      { kind: 'createNode', elementTypeId: 'istar.Actor' },
      { origin: 'canvas' },
    );
    expect(result.ok).toBe(false);
    expect(heard).toEqual([]);
  });
});

describe('the local synchronous guarantee', () => {
  test('an operation applies and notifies before dispatch awaits', () => {
    const env = setup();
    const heard: IstarAction[] = [];
    env.dispatcher.subscribe((a) => heard.push(a));
    void env.dispatcher.dispatch({
      kind: 'changeBounds',
      newBounds: [{ elementId: 'b', newPosition: { x: 9, y: 9 } }],
    });
    expect(env.store.getModel().elements.get('b')?.x).toBe(9);
    expect(heard.some((a) => a.kind === 'sourceModelChanged')).toBe(true);
  });

  test('a compound applies every child synchronously', () => {
    const env = setup();
    void env.dispatcher.dispatch({
      kind: 'compound',
      operationList: [
        { kind: 'changeBounds', newBounds: [{ elementId: 'b', newPosition: { x: 9, y: 9 } }] },
        { kind: 'applyLabelEdit', labelId: 'a', text: 'Renamed' },
      ],
    });
    expect(env.store.getModel().elements.get('b')?.x).toBe(9);
    expect(env.store.getModel().elements.get('a')?.name).toBe('Renamed');
  });

  test('undo and redo apply synchronously', async () => {
    const env = setup();
    await env.dispatcher.dispatch({
      kind: 'changeBounds',
      newBounds: [{ elementId: 'b', newPosition: { x: 9, y: 9 } }],
    });
    void env.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(env.store.getModel().elements.get('b')?.x).toBe(400);
    void env.dispatcher.dispatch({ kind: 'glspRedo' });
    expect(env.store.getModel().elements.get('b')?.x).toBe(9);
  });

  test('a guarded operation is applied (or rejected) synchronously too', () => {
    const guard: ActionGuard = (operation) =>
      operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task'
        ? [{ elementId: '', severity: 'error', message: 'no tasks' }]
        : undefined;
    const env = setup({ guards: [guard] });
    const before = env.store.getModel();
    void env.dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Task' });
    // Rejected: the model is untouched, synchronously.
    expect(env.store.getModel()).toBe(before);

    void env.dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    // Applied: the model already has the new actor, synchronously.
    expect(env.store.getModel()).not.toBe(before);
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
      // #108: an n-ary kind's hint targets its hub too, so `createEdge` onto it can add a leg.
      targetElementTypeIds: ['istar.Goal', 'x.JointHub'],
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
