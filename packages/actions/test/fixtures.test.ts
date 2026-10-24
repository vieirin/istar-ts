/**
 * D8 (#25): every operation through the dispatcher on the fixtures, undone and redone through
 * the dispatcher too. After undo the model is the same object and writes the same file.
 */
import { describe, expect, test } from 'vitest';
import type { IstarModel, LinkKind } from '@istar-ts/core';
import {
  NODE_LINK_KINDS,
  canLink,
  createModelStore,
  metamodelOf,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import type { IstarOperation } from '../src';
import { createActionDispatcher } from '../src';
import { loadFixtures } from './fixtures';

const fixtures = loadFixtures();

/** JSON in, the same JSON out: actions and results cross a `postMessage` unchanged. */
function expectJson(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

/** Operations exercising every kind, built from what the model has. */
function operationsFor(model: IstarModel): Array<[string, IstarOperation]> {
  const meta = metamodelOf(model);
  const elements = [...model.elements.values()];
  const actors = elements.filter((e) => meta.elements.get(e.kind)?.category === 'actor');
  const inner = elements.filter((e) => e.parent !== undefined);
  const links = [...model.links.values()];
  const ops: Array<[string, IstarOperation]> = [];
  const [a1, a2] = actors;

  if (a1) {
    ops.push([
      'createNode',
      {
        kind: 'createNode',
        elementTypeId: 'istar.Goal',
        containerId: a1.id,
        location: { x: a1.x + 10, y: a1.y + 10 },
        args: { name: 'New goal', customProperties: { note: 'added' } },
      },
    ]);
    ops.push(['deleteElement (actor)', { kind: 'deleteElement', elementIds: [a1.id] }]);
    ops.push([
      'istar.setCollapsed',
      { kind: 'istar.setCollapsed', elementId: a1.id, collapsed: !a1.display?.collapsed },
    ]);
    ops.push([
      'compound',
      {
        kind: 'compound',
        operationList: [
          {
            kind: 'createNode',
            elementTypeId: 'istar.Goal',
            containerId: a1.id,
            args: { id: 'compound-parent' },
          },
          {
            kind: 'createNode',
            elementTypeId: 'istar.Task',
            containerId: a1.id,
            args: { id: 'compound-child' },
          },
          {
            kind: 'createEdge',
            elementTypeId: 'istar.AndRefinementLink',
            sourceElementId: 'compound-child',
            targetElementId: 'compound-parent',
          },
        ],
      },
    ]);
  }
  if (a1 && a2 && canLink(model, a1.id, a2.id, 'istar.DependencyLink').ok) {
    ops.push([
      'createEdge (dependency)',
      {
        kind: 'createEdge',
        elementTypeId: 'istar.DependencyLink',
        sourceElementId: a1.id,
        targetElementId: a2.id,
        args: { dependum: { kind: 'istar.Resource', name: 'Data' } },
      },
    ]);
  }
  const edge = findEdge(model, inner.slice(0, 12));
  if (edge) {
    ops.push([
      'createEdge',
      {
        kind: 'createEdge',
        elementTypeId: edge.kind,
        sourceElementId: edge.source,
        targetElementId: edge.target,
        ...(edge.kind === 'istar.ContributionLink' ? { args: { value: 'help' } } : {}),
      },
    ]);
  }
  const first = elements[0];
  if (first) {
    ops.push([
      'changeBounds',
      {
        kind: 'changeBounds',
        newBounds: [
          {
            elementId: first.id,
            newPosition: { x: first.x + 7, y: first.y + 3 },
            newSize: { width: 120, height: 60 },
          },
        ],
      },
    ]);
    ops.push(['applyLabelEdit (name)', { kind: 'applyLabelEdit', labelId: first.id, text: 'X' }]);
    ops.push([
      'applyLabelEdit (property)',
      { kind: 'applyLabelEdit', labelId: `${first.id}#edited`, text: 'yes' },
    ]);
    const existing = Object.keys(first.customProperties ?? {})[0];
    ops.push([
      'istar.updateProperties',
      {
        kind: 'istar.updateProperties',
        elementId: first.id,
        properties: { added: '1', ...(existing ? { [existing]: null } : {}) },
      },
    ]);
  }
  const movable = inner.find((e) => !e.isDependum);
  if (movable) {
    const into = actors.find((a) => a.id !== movable.parent);
    ops.push([
      'changeContainer',
      {
        kind: 'changeContainer',
        elementId: movable.id,
        targetContainerId: into?.id ?? null,
        location: { x: movable.x + 1, y: movable.y + 1 },
      },
    ]);
  }
  const link = links[0];
  if (link) ops.push(['deleteElement (link)', { kind: 'deleteElement', elementIds: [link.id] }]);
  const reconnect = findReconnect(model);
  if (reconnect) ops.push(['reconnectEdge', reconnect]);
  ops.push([
    'istar.updateDiagram',
    { kind: 'istar.updateDiagram', diagram: { name: 'Renamed', width: 3000 } },
  ]);
  return ops;
}

/** The first node link `canLink` accepts between these elements. */
function findEdge(
  model: IstarModel,
  candidates: readonly { id: string }[],
): { kind: LinkKind; source: string; target: string } | undefined {
  for (const kind of NODE_LINK_KINDS) {
    for (const s of candidates) {
      for (const t of candidates) {
        if (canLink(model, s.id, t.id, kind).ok) return { kind, source: s.id, target: t.id };
      }
    }
  }
  return undefined;
}

/** A node link that can move its target to another element. */
function findReconnect(model: IstarModel): IstarOperation | undefined {
  const meta = metamodelOf(model);
  for (const link of model.links.values()) {
    if (meta.links.get(link.kind)?.category !== 'node') continue;
    const source = model.elements.get(link.source);
    if (!source) continue;
    const without = { ...model, links: new Map(model.links) };
    without.links.delete(link.id);
    for (const candidate of model.elements.values()) {
      if (candidate.id === link.target || candidate.parent !== source.parent) continue;
      if (canLink(without, link.source, candidate.id, link.kind).ok) {
        return {
          kind: 'reconnectEdge',
          edgeElementId: link.id,
          sourceElementId: link.source,
          targetElementId: candidate.id,
        };
      }
    }
  }
  return undefined;
}

describe.each(fixtures)('$name', ({ text }) => {
  const initial = parsePistar(text);
  const file = toPistar(initial);

  test.each(operationsFor(initial))('%s, undone and redone', async (_, operation) => {
    const store = createModelStore(initial);
    const dispatcher = createActionDispatcher(store);
    expectJson(operation);

    const result = await dispatcher.dispatch(operation);
    expectJson(result);
    expect(result).toMatchObject({ ok: true });
    const edited = store.getModel();
    expect(edited).not.toBe(initial);
    expect(store.canUndo()).toBe(true);

    expect(await dispatcher.dispatch({ kind: 'glspUndo' })).toEqual({ ok: true, createdIds: [] });
    expect(store.getModel()).toBe(initial);
    expect(toPistar(store.getModel())).toBe(file);
    expect(store.canUndo()).toBe(false);

    await dispatcher.dispatch({ kind: 'glspRedo' });
    expect(store.getModel()).toBe(edited);
  });
});

describe('fixtures', () => {
  test('cover every operation kind', () => {
    const kinds = new Set(
      fixtures.flatMap(({ text }) => operationsFor(parsePistar(text)).map(([, op]) => op.kind)),
    );
    // The n-ary leg operations need an n-ary link kind; see dispatcher.test.ts.
    expect([...kinds].toSorted()).toEqual([
      'applyLabelEdit',
      'changeBounds',
      'changeContainer',
      'compound',
      'createEdge',
      'createNode',
      'deleteElement',
      'istar.setCollapsed',
      'istar.updateDiagram',
      'istar.updateProperties',
      'reconnectEdge',
    ]);
  });
});
