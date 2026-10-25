import {
  ISTAR_2_0,
  createEmptyModel,
  createModelStore,
  extendMetamodel,
  parsePistar,
} from '@istar-ts/core';
import { modelToGModelSchema } from '@istar-ts/gmodel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { AnyIstarRegistry, ElementNodeData } from '../src';
import {
  actorBoundary,
  createRegistry,
  defaultRegistry,
  gmodelToFlow,
  modelToFlow,
  registryForMetamodel,
  registrySizes,
} from '../src';
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
    // The GModel leaves a collapsed actor's elements out (#165), where modelToFlow hid them.
    expect(nodes.find((n) => n.id === g1.id)).toBeUndefined();
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

  test('a registry that overrides a kind size changes the boundary, like before the move to core', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const registry = createRegistry({
      elements: { 'istar.Goal': { size: { width: 300, height: 30 } } },
    });
    const box = actorBoundary(
      store.getModel(),
      registry,
      store.getModel().elements.get(actor.id)!,
      [store.getModel().elements.get(goal.id)!],
    );
    // 20 (goal.x) + 300 (overridden width) + 10 (padding) = 330, vs. 200 at the default size.
    expect(box.width).toBe(330);
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
      data: {
        elementId: 'a',
        element: { id: 'a', kind: 'istar.Actor' as const, name: 'a', x: 0, y: 0 },
        collapsed: false,
      },
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

describe('gmodelToFlow', () => {
  // A synthetic dialect: an actor kind and a node kind of its own, on iStar 2.0.
  const metamodel = extendMetamodel(ISTAR_2_0, {
    name: 'synthetic',
    elements: [
      { kind: 'syn.Team', label: 'Team', category: 'actor', size: { width: 160, height: 90 } },
      { kind: 'syn.Note', label: 'Note', category: 'node', size: { width: 70, height: 30 } },
    ],
  });
  function synthetic() {
    const store = createModelStore(createEmptyModel(undefined, { metamodel }));
    const team = store.addElement({ kind: 'syn.Team', x: 100, y: 100 });
    const note = store.addElement({
      kind: 'syn.Note',
      x: 140,
      y: 150,
      parent: team.id,
      customProperties: { owner: 'ops', weight: '0.5' },
      display: { backgroundColor: '#fafafa' },
    });
    return { model: store.getModel(), team, note };
  }

  test('reads kinds from args.kind, so a GModel type override changes nothing', () => {
    const { model, team, note } = synthetic();
    const registry = registryForMetamodel(metamodel) as unknown as AnyIstarRegistry;
    const sizes = registrySizes(registry);
    const plain = gmodelToFlow(modelToGModelSchema(model, { sizes }), metamodel, registry);
    const overridden = gmodelToFlow(
      modelToGModelSchema(model, {
        sizes,
        types: { 'syn.Team': 'node:team-shape', 'syn.Note': 'node:sticky' },
      }),
      metamodel,
      registry,
    );
    expect(overridden).toEqual(plain);
    const teamNode = plain.nodes.find((n) => n.id === team.id)!;
    const noteNode = plain.nodes.find((n) => n.id === note.id)!;
    expect(teamNode.type).toBe('istarActor');
    expect(noteNode).toMatchObject({ type: 'istarElement', parentId: team.id, width: 70 });
    expect((noteNode.data as ElementNodeData).element).toMatchObject({
      kind: 'syn.Note',
      x: 140,
      y: 150,
      parent: team.id,
      customProperties: { owner: 'ops', weight: '0.5' },
      display: { backgroundColor: '#fafafa' },
    });
  });

  test('draws what the GModel carries, not what the model holds', () => {
    const { model, note } = synthetic();
    const schema = modelToGModelSchema(model);
    const gnode = schema.children
      .flatMap((c) => ('children' in c ? [c, ...c.children] : [c]))
      .find((c) => c.id === note.id) as { args: { customProperties: Record<string, string> } };
    gnode.args.customProperties = { owner: 'from-the-gmodel' };
    const flow = gmodelToFlow(schema, metamodel);
    const node = flow.nodes.find((n) => n.id === note.id)!;
    expect((node.data as ElementNodeData).element.customProperties).toEqual({
      owner: 'from-the-gmodel',
    });
  });
});
