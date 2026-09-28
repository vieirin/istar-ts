import { createModelStore, parsePistar } from '@istar-ts/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { actorBoundary, defaultRegistry, modelToFlow } from '../src';
import { adoptFlowNode } from '../src/layout';

const fixture = readFileSync(
  join(
    import.meta.dirname,
    '../../../fixtures/goal-controller/dissertationExamples/labSamples.txt',
  ),
  'utf8',
);

describe('modelToFlow', () => {
  test('actors become group nodes listed before their children, with relative positions', () => {
    const model = parsePistar(fixture);
    const { nodes, edges } = modelToFlow(model, defaultRegistry);
    expect(nodes).toHaveLength(model.elements.size);
    expect(edges).toHaveLength(model.links.size);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const node of nodes) {
      if (!node.parentId) continue;
      expect(index.get(node.parentId)!).toBeLessThan(index.get(node.id)!);
      const parent = nodes[index.get(node.parentId)!]!;
      const element = model.elements.get(node.id)!;
      expect(parent.position.x + node.position.x).toBe(element.x);
      expect(parent.position.y + node.position.y).toBe(element.y);
      // The boundary contains the child.
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.x + node.width!).toBeLessThanOrEqual(parent.width!);
    }
  });

  test('collapsed actors hide children, keep dependency links on the actor, hide the rest', () => {
    const store = createModelStore();
    const a = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const b = store.addElement({ kind: 'istar.Agent', x: 500, y: 0 });
    const g1 = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: a.id });
    const g2 = store.addElement({ kind: 'istar.Goal', x: 20, y: 160, parent: a.id });
    store.connect({ kind: 'istar.AndRefinementLink', source: g2.id, target: g1.id });
    const dep = store.addDependency({
      depender: g2.id,
      dependee: b.id,
      dependum: { kind: 'istar.Resource' },
    });
    if (!dep.ok) throw new Error(dep.reason);
    store.setCollapsed(a.id, true);

    const { nodes, edges } = modelToFlow(store.getModel(), defaultRegistry);
    expect(nodes.find((n) => n.id === g1.id)?.hidden).toBe(true);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [a.id, dep.dependum.id],
      [dep.dependum.id, b.id],
    ]);
  });

  test('display width/height override the registry size', () => {
    const store = createModelStore();
    const a = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const g = store.addElement({
      kind: 'istar.Goal',
      x: 10,
      y: 10,
      parent: a.id,
      display: { width: 150, height: 60 },
    });
    const node = modelToFlow(store.getModel(), defaultRegistry).nodes.find((n) => n.id === g.id);
    expect([node?.width, node?.height]).toEqual([150, 60]);
  });

  test('actor boundary grows with children and shrinks back toward the default size', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const resting = actorBoundary(
      store.getModel(),
      defaultRegistry,
      store.getModel().elements.get(actor.id)!,
      [store.getModel().elements.get(goal.id)!],
    );
    expect(resting.width).toBe(200);
    expect(resting.height).toBe(120);

    store.moveElement(goal.id, 300, 60);
    const grown = modelToFlow(store.getModel(), defaultRegistry).nodes.find(
      (n) => n.id === actor.id,
    )!;
    expect(grown.width!).toBeGreaterThan(200);

    store.moveElement(goal.id, 20, 60);
    const shrunk = modelToFlow(store.getModel(), defaultRegistry).nodes.find(
      (n) => n.id === actor.id,
    )!;
    expect([shrunk.width, shrunk.height]).toEqual([resting.width, resting.height]);
  });

  test('saved actor display width/height do not keep the boundary expanded', () => {
    // piStar persists the last expanded size in display; updateBoundary still floors on the
    // default (originalSize), so moving children inward must shrink past that saved size.
    const store = createModelStore();
    const actor = store.addElement({
      kind: 'istar.Actor',
      x: 0,
      y: 0,
      display: { width: 800, height: 600 },
    });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const box = actorBoundary(
      store.getModel(),
      defaultRegistry,
      store.getModel().elements.get(actor.id)!,
      [store.getModel().elements.get(goal.id)!],
    );
    expect(box.width).toBe(200);
    expect(box.height).toBe(120);
  });
});

describe('adoptFlowNode', () => {
  test('replaces a stale larger measured size so the boundary can shrink', () => {
    const next = {
      id: 'a',
      type: 'istarActor' as const,
      position: { x: 0, y: 0 },
      width: 200,
      height: 120,
      data: { elementId: 'a', collapsed: false },
    };
    const prev = {
      ...next,
      width: 400,
      height: 120,
      measured: { width: 400, height: 120 },
      selected: true,
    };
    const adopted = adoptFlowNode(next, prev);
    expect(adopted.selected).toBe(true);
    expect(adopted.measured).toEqual({ width: 200, height: 120 });
    expect([adopted.width, adopted.height]).toEqual([200, 120]);
  });
});
