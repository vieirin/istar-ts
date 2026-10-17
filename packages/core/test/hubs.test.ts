import { describe, expect, test } from 'vitest';
import type { LinkKindDeclaration, ModelChange } from '../src';
import {
  ISTAR_2_0,
  MetamodelError,
  addLeg,
  createModelStore,
  defaultHubPosition,
  defineMetamodel,
  disconnect,
  elementCenter,
  elementKindDefinition,
  extendMetamodel,
  hubLinkOf,
  hubOfLink,
  isHubElement,
  linkKindDefinition,
  removeElement,
  removeLeg,
  validateModel,
} from '../src';
import { KAOS } from './dsm3-roots';

const HUB = 'kaos.RefinementLinkHub';
const LEG = 'kaos.RefinementLinkStart';
const END = 'kaos.RefinementLinkEnd';

/** A root with one node kind, a plain link kind and `link`, built lazily for `toThrow`. */
function root(link: object): () => unknown {
  return () =>
    defineMetamodel({
      name: 'r',
      prefix: 'r',
      elements: [{ kind: 'r.Node', category: 'node' }],
      links: [
        { kind: 'r.Other', rules: { sources: ['node'], targets: ['node'] } },
        link as LinkKindDeclaration,
      ],
    });
}

/** Three goals and an agent, and a refinement of `parent` by `a` (a hub, a leg, an end). */
function kaosStore() {
  const store = createModelStore(undefined, { metamodel: KAOS });
  const parent = store.addElement({ kind: 'kaos.BehavioralGoal', x: 100, y: 0 });
  const a = store.addElement({ kind: 'kaos.BehavioralGoal', x: 0, y: 200 });
  const b = store.addElement({ kind: 'kaos.Softgoal', x: 200, y: 200 });
  const agent = store.addElement({ kind: 'kaos.Agent', x: 400, y: 200 });
  const refinement = store.connect({
    kind: 'kaos.RefinementLink',
    source: a.id,
    target: parent.id,
    id: 'hub',
    customProperties: { SysRef: 'R1' },
  });
  if (!refinement.ok) throw new Error(refinement.reason);
  return { store, parent, a, b, agent, refinement };
}

describe('n-ary link kinds', () => {
  test('generate a hub element kind and leg and end link kinds', () => {
    const base = KAOS.links.get('kaos.RefinementLink')!;
    expect(base).toMatchObject({ arity: 'n', parts: { hub: HUB, leg: LEG, end: END } });
    expect(KAOS.elements.get(HUB)).toMatchObject({
      category: 'node',
      label: 'Refinement hub',
      size: { width: 20, height: 20 },
      info: { canBeInnerElement: false, canBeDependum: false, canBeOnPaper: true },
      pistarType: HUB,
      role: 'hub',
      of: 'kaos.RefinementLink',
    });
    expect(KAOS.elements.get(HUB)?.shape?.viewBox).toBe('0 0 20 20');
    expect(KAOS.links.get(LEG)).toMatchObject({
      role: 'leg',
      of: 'kaos.RefinementLink',
      rules: { sources: base.rules!.sources, targets: [HUB], unique: 'kind' },
    });
    expect(KAOS.links.get(END)).toMatchObject({
      role: 'end',
      of: 'kaos.RefinementLink',
      rules: { sources: [HUB], targets: ['node'], unique: 'kind' },
    });
    expect(KAOS.elementsByPistarType.get(HUB)).toBe(HUB);
    expect(KAOS.linksByPistarType.get(LEG)).toBe(LEG);
  });

  test('take their names, written types and hub size from the declaration', () => {
    const m = extendMetamodel(ISTAR_2_0, {
      name: 'x',
      links: [
        {
          kind: 'x.Joint',
          arity: 'n',
          rules: { sources: ['istar.Goal'], targets: ['istar.Goal'] },
          pistarType: 'istar.Joint',
          parts: { hub: 'x.Knot' },
          hubSize: { width: 30, height: 30 },
        },
      ],
    });
    expect(m.links.get('x.Joint')?.parts).toEqual({
      hub: 'x.Knot',
      leg: 'x.JointStart',
      end: 'x.JointEnd',
    });
    expect(elementKindDefinition(m, 'x.Knot')).toMatchObject({
      pistarType: 'istar.JointHub',
      size: { width: 30, height: 30 },
      extension: 'x',
    });
    expect(linkKindDefinition(m, 'x.JointEnd')?.extension).toBe('x');
  });

  test('need rules and the node category, and their generated names must be free', () => {
    expect(root({ kind: 'r.Joint', arity: 'n', behavesLike: 'r.Other' })).toThrow(
      'metamodel "r": n-ary link kind "r.Joint" needs rules and the "node" category',
    );
    expect(
      root({
        kind: 'r.Joint',
        arity: 'n',
        category: 'actor',
        rules: { sources: ['actor'], targets: ['actor'] },
      }),
    ).toThrow(MetamodelError);
    expect(
      root({
        kind: 'r.Joint',
        arity: 'n',
        rules: { sources: ['node'], targets: ['node'] },
        parts: { leg: 'r.Other' },
      }),
    ).toThrow(
      'metamodel "r": kind "r.Other" already exists (generated for n-ary link kind "r.Joint")',
    );
    expect(
      root({ kind: 'r.Joint', arity: 2, rules: { sources: ['node'], targets: ['node'] } }),
    ).toThrow('metamodel "r": link kind "r.Joint" has an unknown arity 2');
  });
});

describe('hub links in a model', () => {
  test('connect with the n-ary kind creates a hub, a leg and an end', () => {
    const { store, parent, a, refinement } = kaosStore();
    if (!refinement.ok) return;
    const model = store.getModel();
    const hub = model.elements.get('hub')!;
    expect(hub).toMatchObject({ kind: HUB, name: '', customProperties: { SysRef: 'R1' } });
    expect(hub.parent).toBeUndefined();
    // Centred between the two goals' centres.
    const position = defaultHubPosition(model, a, parent, { width: 20, height: 20 });
    expect({ x: hub.x, y: hub.y }).toEqual(position);
    expect(position).toEqual({ x: 107.5, y: 108 });
    expect(elementCenter(model, a)).toEqual({ x: 67.5, y: 218 });
    expect(refinement.link).toMatchObject({ kind: END, source: 'hub', target: parent.id });
    expect(refinement.hub?.hub).toBe(hub);
    expect(refinement.hub?.legs.map((l) => [l.kind, l.source, l.target])).toEqual([
      [LEG, a.id, 'hub'],
    ]);
    expect(hubLinkOf(model, 'hub')).toEqual(refinement.hub);
    expect(hubOfLink(model, refinement.link.id)).toBe(hub);
    expect(hubOfLink(model, refinement.hub!.legs[0]!.id)).toBe(hub);
    expect(isHubElement(KAOS, hub)).toBe(true);
    expect(isHubElement(KAOS, a)).toBe(false);
    expect(validateModel(model)).toEqual([]);
  });

  test('connecting to its hub adds a leg; one per source', () => {
    const { store, a, b } = kaosStore();
    const leg = store.connect({ kind: 'kaos.RefinementLink', source: b.id, target: 'hub' });
    expect(leg.ok && leg.link).toMatchObject({ kind: LEG, source: b.id, target: 'hub' });
    expect(leg.ok && leg.hub?.legs.map((l) => l.source)).toEqual([a.id, b.id]);
    expect(store.canLink(b, 'hub', 'kaos.RefinementLink')).toMatchObject({
      ok: false,
      code: 'duplicate-link',
    });
    expect(store.addLeg('hub', b.id)).toMatchObject({ ok: false, code: 'duplicate-link' });
    expect(validateModel(store.getModel())).toEqual([]);
  });

  test('a hub only accepts legs of its own kind', () => {
    const { store, b, agent } = kaosStore();
    expect(store.canLink(b, 'hub', 'kaos.Conflict')).toEqual({
      ok: false,
      code: 'hub-target',
      reason: 'you cannot make a Conflict link towards the hub of a Refinement link',
    });
    expect(store.canLink(agent, 'hub', 'kaos.ResponsibilityAssignment')).toMatchObject({
      code: 'hub-target',
    });
    // Category selectors never match a hub, as a source either.
    expect(store.canLink('hub', b, 'kaos.Conflict')).toMatchObject({ code: 'invalid-source' });
  });

  test('an n-ary link has one end', () => {
    const { store, b } = kaosStore();
    expect(store.canLink('hub', b, END)).toEqual({
      ok: false,
      code: 'duplicate-link',
      reason: 'the hub of a Refinement link has only one end',
    });
  });

  test('the store records hubs in its change events, and undo removes them', () => {
    const { store, a, b, parent } = kaosStore();
    const changes: ModelChange[] = [];
    store.subscribe((event) => changes.push(...event.changes));
    const other = store.connect({ kind: 'kaos.RefinementLink', source: b.id, target: a.id });
    if (!other.ok) throw new Error(other.reason);
    const leg = store.addLeg('hub', b.id, { id: 'leg2' });
    expect(leg.ok).toBe(true);
    store.removeLeg('leg2');
    expect(changes).toEqual([
      { type: 'connect', id: other.link.id, hubId: other.hub!.hub.id },
      { type: 'connect', id: 'leg2', hubId: 'hub' },
      { type: 'removeLeg', id: 'leg2' },
    ]);
    store.undo();
    store.undo();
    store.undo();
    expect([...store.getModel().elements.keys()]).toEqual([
      parent.id,
      a.id,
      b.id,
      expect.any(String),
      'hub',
    ]);
  });

  test('removing its end or last leg removes the whole n-ary link', () => {
    const { store, parent, a, b, refinement } = kaosStore();
    if (!refinement.ok) return;
    const leg2 = addLeg(store.getModel(), 'hub', b.id, { id: 'leg2' });
    if (!leg2.ok) throw new Error(leg2.reason);
    const model = leg2.model;
    const legOf = (m: typeof model) => [...m.links.keys()].toSorted();
    // One of two legs: the rest stays.
    expect(legOf(removeLeg(model, 'leg2'))).toEqual(legOf(store.getModel()));
    expect(hubLinkOf(removeElement(model, b.id), 'hub')?.legs).toHaveLength(1);
    // The last leg, the end, the hub, the target: everything goes.
    const empty = (m: typeof model) => {
      expect([...m.links.keys()]).toEqual([]);
      expect(m.elements.has('hub')).toBe(false);
    };
    empty(removeLeg(removeLeg(model, 'leg2'), refinement.hub!.legs[0]!.id));
    empty(disconnect(model, refinement.link.id));
    empty(removeElement(model, 'hub'));
    empty(removeElement(model, parent.id));
    empty(removeElement(removeElement(model, a.id), b.id));
    expect(() => removeLeg(model, refinement.link.id)).toThrow(/not a leg/);
  });

  test('validateModel reports incomplete hubs and links towards hubs', () => {
    const store = createModelStore(undefined, { metamodel: KAOS });
    const goal = store.addElement({ kind: 'kaos.BehavioralGoal', x: 0, y: 0 });
    const hub = store.addElement({ kind: HUB, x: 0, y: 0, id: 'h' });
    expect(validateModel(store.getModel())).toEqual([
      {
        linkId: 'h',
        kind: 'kaos.RefinementLink',
        source: 'h',
        target: 'h',
        code: 'incomplete-hub',
        message: 'the hub of a Refinement link needs an end',
      },
    ]);
    store.connect({ kind: END, source: hub.id, target: goal.id });
    expect(validateModel(store.getModel())).toMatchObject([
      {
        code: 'incomplete-hub',
        target: goal.id,
        message: 'the hub of a Refinement link needs at least one leg',
      },
    ]);
    store.connect({ kind: 'kaos.Conflict', source: goal.id, target: hub.id }, { force: true });
    expect(validateModel(store.getModel()).map((issue) => issue.code)).toEqual([
      'hub-target',
      'incomplete-hub',
    ]);
  });

  test("the base kind's same-actor rule holds between legs and the end's target", () => {
    const m = extendMetamodel(ISTAR_2_0, {
      name: 'x',
      links: [
        {
          kind: 'x.Joint',
          arity: 'n',
          rules: { sources: ['istar.Goal'], targets: ['istar.Goal'] },
        },
      ],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const other = store.addElement({ kind: 'istar.Actor', x: 500, y: 0 });
    const [g1, g2] = [0, 1].map((i) =>
      store.addElement({ kind: 'istar.Goal', x: i * 100, y: 0, parent: actor.id }),
    );
    const g3 = store.addElement({ kind: 'istar.Goal', x: 500, y: 0, parent: other.id });
    const joint = store.connect({ kind: 'x.Joint', source: g1!.id, target: g2!.id });
    if (!joint.ok) throw new Error(joint.reason);
    const hubId = joint.hub!.hub.id;
    expect(store.canLink(g3, hubId, 'x.Joint')).toMatchObject({ code: 'different-actors' });
    expect(store.canLink(g3, g2!, 'x.Joint')).toMatchObject({ code: 'different-actors' });
  });
});
