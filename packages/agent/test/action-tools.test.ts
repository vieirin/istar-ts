import { describe, expect, test } from 'vitest';
import { HANDLED_ACTION_KINDS, createActionDispatcher } from '@istar-ts/actions';
import { ISTAR_2_0, createModelStore, extendMetamodel, toPistar } from '@istar-ts/core';
import type { AnyMetamodel } from '@istar-ts/core';
import { actionToolName, createActionChangeSet, createActionToolRegistry } from '../src';
import type { ChangeSetEntry, JsonValue, ToolRegistry } from '../src';

// iStar 2.0 has no n-ary kind; one like DSM3-goals' refinements (as actions' #60 test does).
const METAMODEL = extendMetamodel(ISTAR_2_0, {
  name: 'x',
  links: [
    { kind: 'x.Joint', arity: 'n', rules: { sources: ['istar.Goal'], targets: ['istar.Goal'] } },
  ],
});

function setup() {
  const store = createModelStore(undefined, { metamodel: METAMODEL });
  store.transaction(() => {
    store.addElement({ kind: 'istar.Actor', id: 'a', x: 0, y: 0 });
    store.addElement({ kind: 'istar.Actor', id: 'b', x: 400, y: 0 });
    store.addElement({ kind: 'istar.Goal', id: 'g1', x: 10, y: 10, parent: 'a' });
    store.addElement({ kind: 'istar.Goal', id: 'g2', x: 100, y: 10, parent: 'a' });
  });
  store.clearHistory();
  const dispatcher = createActionDispatcher(store);
  return { store, dispatcher };
}

let n = 0;
const createId = (): string => `pin${++n}`;

async function propose(registry: ToolRegistry, calls: readonly [string, JsonValue][]) {
  const entries: ChangeSetEntry[] = [];
  for (const [i, [name, raw]] of calls.entries()) {
    const args = registry.prepare?.(name, raw) ?? raw;
    entries.push({ toolCallId: `c${i}`, name, args, result: await registry.call(name, args) });
  }
  return entries;
}

describe('createActionToolRegistry', () => {
  test('one tool per handled operation and request, plus undo and redo', () => {
    const registry = createActionToolRegistry(setup().dispatcher);
    const names = registry.list().map((s) => s.name);
    expect(names).toEqual(
      [
        ...HANDLED_ACTION_KINDS.operations,
        ...HANDLED_ACTION_KINDS.requests,
        'glspUndo',
        'glspRedo',
      ].map(actionToolName),
    );
    for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(
      registry
        .list()
        .filter((s) => s.readOnly)
        .map((s) => s.name),
    ).toEqual(HANDLED_ACTION_KINDS.requests.map(actionToolName));
  });

  test("the schemas list the metamodel's kinds: no hubs or n-ary parts", () => {
    const registry = createActionToolRegistry(setup().dispatcher, {
      metamodel: METAMODEL as unknown as AnyMetamodel,
    });
    const schema = (name: string) =>
      registry.list().find((s) => s.name === name)!.parameters as {
        properties: { elementTypeId: { enum: string[] } };
      };
    const links = schema('createEdge').properties.elementTypeId.enum;
    expect(links).toContain('x.Joint');
    expect(links).toContain('istar.DependencyLink');
    expect(links.some((k) => k.startsWith('x.Joint') && k !== 'x.Joint')).toBe(false);
    const nodes = schema('createNode').properties.elementTypeId.enum;
    expect(nodes).toContain('istar.Goal');
    expect(nodes.some((k) => k.startsWith('x.Joint'))).toBe(false);
  });

  test('prepare pins the ids a create would leave to the store, keeping given ones', () => {
    n = 0;
    const registry = createActionToolRegistry(setup().dispatcher, {
      metamodel: METAMODEL as unknown as AnyMetamodel,
      createId,
    });
    expect(registry.prepare!('createNode', { elementTypeId: 'istar.Goal' })).toEqual({
      elementTypeId: 'istar.Goal',
      args: { id: 'pin1' },
    });
    expect(
      registry.prepare!('createNode', { elementTypeId: 'istar.Goal', args: { id: 'mine' } }),
    ).toEqual({
      elementTypeId: 'istar.Goal',
      args: { id: 'mine' },
    });
    expect(
      registry.prepare!('createEdge', {
        elementTypeId: 'istar.DependencyLink',
        sourceElementId: 'a',
        targetElementId: 'b',
        args: { dependum: { name: 'Data' } },
      }),
    ).toEqual({
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: 'a',
      targetElementId: 'b',
      args: { dependum: { name: 'Data', id: 'pin2' }, linkIds: ['pin3', 'pin4'] },
    });
    expect(
      registry.prepare!('createEdge', {
        elementTypeId: 'x.Joint',
        sourceElementId: 'g1',
        targetElementId: 'g2',
      }),
    ).toMatchObject({ args: { id: 'pin5', legId: 'pin6', endId: 'pin7' } });
    expect(
      registry.prepare!('compound', {
        operationList: [{ kind: 'createNode', elementTypeId: 'istar.Task' }],
      }),
    ).toEqual({
      operationList: [{ kind: 'createNode', elementTypeId: 'istar.Task', args: { id: 'pin8' } }],
    });
  });

  test('requests answer without layout; kinds are the ones the tools take', async () => {
    const { dispatcher } = setup();
    const registry = createActionToolRegistry(dispatcher, {
      metamodel: METAMODEL as unknown as AnyMetamodel,
    });
    await registry.call('createEdge', {
      elementTypeId: 'x.Joint',
      sourceElementId: 'g1',
      targetElementId: 'g2',
      args: { id: 'h', legId: 'l', endId: 'e' },
    });
    await registry.call('createEdge', {
      elementTypeId: 'istar.DependencyLink',
      sourceElementId: 'a',
      targetElementId: 'b',
      args: { dependum: { id: 'd', name: 'Data' }, linkIds: ['d1', 'd2'] },
    });
    const result = await registry.call('requestModel', {});
    expect(result.ok && result.content).toMatchObject({
      actors: [
        {
          id: 'a',
          kind: 'istar.Actor',
          elements: [
            { id: 'g1', kind: 'istar.Goal' },
            { id: 'g2', kind: 'istar.Goal' },
          ],
        },
        { id: 'b', kind: 'istar.Actor', elements: [] },
      ],
      dependums: [{ id: 'd', kind: 'istar.Goal', name: 'Data' }],
      links: expect.arrayContaining([
        {
          hub: { id: 'h', kind: 'x.JointHub' },
          legs: [{ id: 'l', kind: 'x.JointStart', source: 'g1', target: 'h' }],
          end: { id: 'e', kind: 'x.JointEnd', source: 'h', target: 'g2' },
        },
        { id: 'd1', kind: 'istar.DependencyLink', source: 'a', target: 'd' },
      ]),
    });
    expect(JSON.stringify(result)).not.toMatch(/"x":/);

    const check = await registry.call('requestCheckEdge', {
      edgeType: 'istar.AndRefinementLink',
      sourceElementId: 'g1',
      targetElementId: 'a',
    });
    expect(check).toMatchObject({
      ok: true,
      content: { isValid: false, edgeType: 'istar.AndRefinementLink' },
    });
    expect(await registry.call('requestMarkers', {})).toMatchObject({
      ok: true,
      content: { markers: [] },
    });
  });

  test('bad arguments and unknown tools are refusals, not throws', async () => {
    const registry = createActionToolRegistry(setup().dispatcher);
    expect(await registry.call('nope', {})).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'unknown-tool' }],
    });
    expect(await registry.call('createNode', [1, 2] as JsonValue)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'invalid-arguments' }],
    });
    // deleteElement without its list: the dispatcher throws a TypeError, reported as a refusal.
    expect(await registry.call('deleteElement', {})).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'tool-error' }],
    });
  });
});

describe('createActionChangeSet', () => {
  test('ids left to the store in the dry run are the ids the applied set creates', async () => {
    const { store, dispatcher } = setup();
    const before = toPistar(store.getModel());
    const target = createActionChangeSet({ dispatcher, getModel: store.getModel });
    const scratch = await target.openScratch();
    const entries = await propose(scratch.registry, [
      ['createNode', { elementTypeId: 'istar.Goal', containerId: 'b', args: { name: 'New' } }],
      [
        'createEdge',
        { elementTypeId: 'istar.DependencyLink', sourceElementId: 'a', targetElementId: 'b' },
      ],
      ['createEdge', { elementTypeId: 'x.Joint', sourceElementId: 'g1', targetElementId: 'g2' }],
      ['istar_updateProperties', { elementId: 'g1', properties: { owner: 'me' } }],
    ]);
    expect(entries.every((e) => e.result.ok)).toBe(true);
    const proposed = await scratch.registry.call('requestModel', {});
    scratch.close?.();
    expect(toPistar(store.getModel())).toBe(before);

    expect((await target.apply(entries)).ok).toBe(true);
    const live = createActionToolRegistry(dispatcher, {
      metamodel: METAMODEL as unknown as AnyMetamodel,
    });
    expect(await live.call('requestModel', {})).toEqual(proposed);
    store.undo();
    expect(toPistar(store.getModel())).toBe(before);
  });

  test('a set the live model no longer accepts is refused as a whole', async () => {
    const { store, dispatcher } = setup();
    const target = createActionChangeSet({ dispatcher, getModel: store.getModel });
    const scratch = await target.openScratch();
    const entries = await propose(scratch.registry, [
      ['createNode', { elementTypeId: 'istar.Goal', containerId: 'b' }],
      ['istar_updateProperties', { elementId: 'g2', properties: { k: 'v' } }],
    ]);
    // Meanwhile, the user deletes g2.
    await dispatcher.dispatch({ kind: 'deleteElement', elementIds: ['g2'] });
    const after = toPistar(store.getModel());
    const result = await target.apply(entries);
    expect(result.ok).toBe(false);
    expect(toPistar(store.getModel())).toBe(after);
  });
});
