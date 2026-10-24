import { describe, expect, test } from 'vitest';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { GModelElement } from '@eclipse-glsp/server';
import { GEdge, GNode } from '@eclipse-glsp/server';
import { LINK_ANCHOR_TYPE, gmodelTypes, modelToGModel } from '../src';
import { fixture, loadFixtures, parseFixture } from './fixtures';

function walk(element: GModelElement, visit: (element: GModelElement) => void): void {
  visit(element);
  for (const child of element.children) walk(child, visit);
}

function all(root: GModelElement): GModelElement[] {
  const list: GModelElement[] = [];
  walk(root, (element) => list.push(element));
  return list;
}

/**
 * The ids a GModel shows: every element and link, except the elements of collapsed actors and
 * their links (dependency links stay, moved to the actor), and links on hidden links.
 */
function visibleIds(model: AnyIstarModel): string[] {
  const meta = metamodelOf(model) as AnyMetamodel;
  const hidden = new Set<string>();
  for (const element of model.elements.values()) {
    const parent = element.parent ? model.elements.get(element.parent) : undefined;
    if (
      parent?.display?.collapsed === true &&
      meta.elements.get(parent.kind)?.category === 'actor'
    ) {
      hidden.add(element.id);
    }
  }
  const links = [...model.links.values()];
  const drawn = (id: string, seen = new Set<string>()): boolean => {
    const link = model.links.get(id)!;
    if (seen.has(id)) return false;
    if (model.links.has(link.target))
      return !hidden.has(link.source) && drawn(link.target, seen.add(id));
    if (!hidden.has(link.source) && !hidden.has(link.target)) return true;
    return meta.links.get(link.kind)?.category === 'dependency';
  };
  return [
    ...[...model.elements.keys()].filter((id) => !hidden.has(id)),
    ...links.filter((link) => drawn(link.id)).map((link) => link.id),
  ];
}

const fixtures = loadFixtures();

describe('every fixture', () => {
  test.each(fixtures.map((f) => [f.name, f] as const))('%s maps to a GModel', (_, f) => {
    const model = parseFixture(f);
    const root = modelToGModel(model, f.contribution.types ? { types: f.contribution.types } : {});
    const types = gmodelTypes(metamodelOf(model) as AnyMetamodel, f.contribution.types);
    const elements = all(root);
    // Nodes and edges typed by a kind are exactly the model's elements and links, by id.
    const kinded = elements.filter((e) => types.kindOf(e.type) !== undefined);
    expect(kinded.map((e) => e.id).toSorted()).toEqual(visibleIds(model).toSorted());
    for (const e of kinded) {
      const source = model.elements.get(e.id) ?? model.links.get(e.id)!;
      expect(types.kindOf(e.type)).toBe(source.kind);
      expect(e).toBeInstanceOf(model.elements.has(e.id) ? GNode : GEdge);
    }
    // Ids are unique, every type is one the metamodel's types list, and edges end on nodes.
    const ids = new Set(elements.map((e) => e.id));
    expect(ids.size).toBe(elements.length);
    for (const e of elements) expect(types.all).toContain(e.type);
    for (const edge of elements.filter((e): e is GEdge => e instanceof GEdge)) {
      expect(ids).toContain(edge.sourceId);
      expect(ids).toContain(edge.targetId);
    }
  });
});

describe('modelToGModel', () => {
  test('a small iStar model', () => {
    const f = fixture('goal-controller/dissertationExamples/singleGoal.txt');
    const root = modelToGModel(parseFixture(f));
    expect(
      JSON.parse(JSON.stringify(root, (key, value) => (key === 'parent' ? undefined : value))),
    ).toMatchSnapshot();
  });

  test('actors contain their elements, positioned relative to the boundary', () => {
    const model = parseFixture(fixture('pistar/welcome.txt'));
    const root = modelToGModel(model);
    const actor = root.children.find((c) => c.children.some((g) => g instanceof GNode)) as GNode;
    for (const child of actor.children.filter((c): c is GNode => c instanceof GNode)) {
      const element = model.elements.get(child.id)!;
      expect(element.parent).toBe(actor.id);
      expect(child.position).toEqual({
        x: element.x - actor.position.x,
        y: element.y - actor.position.y,
      });
      expect(child.position.x).toBeGreaterThanOrEqual(10);
      expect(child.position.y).toBeGreaterThanOrEqual(10);
    }
  });

  test('a collapsed actor has no children; its dependencies end on it', () => {
    const model = parseFixture(fixture('pistar/travelReimbursement.txt'));
    const collapsed = [...model.elements.values()].find((e) => e.display?.collapsed === true)!;
    const node = modelToGModel(model).children.find((c) => c.id === collapsed.id) as GNode;
    expect(node.cssClasses).toContain('collapsed');
    expect(node.children.filter((c) => c instanceof GNode)).toEqual([]);
    expect(node.size).toEqual({ width: 60, height: 60 });
  });

  test('sizes come from the metamodel, or the element’s display size', () => {
    const model = parseFixture(fixture('pistar/everyElementAndLink.txt'));
    const meta = metamodelOf(model) as AnyMetamodel;
    for (const e of all(modelToGModel(model))) {
      const element = model.elements.get(e.id);
      if (!element || meta.elements.get(element.kind)?.category === 'actor') continue;
      const size = meta.elements.get(element.kind)!.size;
      expect((e as GNode).size).toEqual({
        width: element.display?.width ?? size.width,
        height: element.display?.height ?? size.height,
      });
    }
  });

  test('KAOS: hubs are small nodes, legs and ends edges', () => {
    const f = fixture('dsm3/kaos-welcome.txt');
    const elements = all(modelToGModel(parseFixture(f)));
    const hubs = elements.filter((e) => e.type === 'node:kaos.RefinementLinkHub');
    expect(hubs).toHaveLength(4);
    expect(elements.filter((e) => e.type === 'edge:kaos.RefinementLinkStart')).toHaveLength(5);
    expect(elements.filter((e) => e.type === 'edge:kaos.RefinementLinkEnd')).toHaveLength(4);
  });

  test('NFR: links on links end on the anchor of the link they target', () => {
    const f = fixture('dsm3/nfr-welcome.txt');
    const model = parseFixture(f);
    const elements = all(modelToGModel(model));
    const onLinks = [...model.links.values()].filter((l) => model.links.has(l.target));
    expect(onLinks.length).toBeGreaterThan(0);
    for (const link of onLinks) {
      const edge = elements.find((e) => e.id === link.id) as GEdge;
      expect(edge.targetId).toBe(`${link.target}_anchor`);
      expect(elements.find((e) => e.id === edge.targetId)?.type).toBe(LINK_ANCHOR_TYPE);
    }
  });

  test('type overrides replace the rule for their kinds', () => {
    const model = parseFixture(fixture('goal-controller/dissertationExamples/singleGoal.txt'));
    const types = elementsOfKind(model, 'istar.Goal');
    const root = modelToGModel(model, { types: { 'istar.Goal': 'node:goal' } });
    for (const goal of all(root).filter((e) => types.includes(e.id)))
      expect(goal.type).toBe('node:goal');
    expect(() => modelToGModel(model, { types: { 'istar.Goal': 'node:istar.Task' } })).toThrow(
      /already used/,
    );
  });
});

function elementsOfKind(model: AnyIstarModel, kind: string): string[] {
  return [...model.elements.values()].filter((e) => e.kind === kind).map((e) => e.id);
}
