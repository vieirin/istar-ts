import { describe, expect, expectTypeOf, test } from 'vitest';
import type {
  ActorKind,
  ElementKind,
  ElementKindOf,
  IstarModel,
  LinkKind,
  LinkKindOf,
  Metamodel,
  NodeKind,
} from '../src';
import {
  ELEMENT_KINDS,
  ISTAR_2_0,
  LINK_KINDS,
  LINK_KIND_INFO,
  MetamodelError,
  NODE_KIND_INFO,
  PistarParseError,
  PistarWriteError,
  canLink,
  createEmptyModel,
  createModelStore,
  defineProperties,
  effectiveElementKind,
  elementKindDefinition,
  extendMetamodel,
  isActor,
  metamodelOf,
  parsePistar,
  prop,
  toPistar,
  validateModel,
  validateModelProperties,
  withMetamodel,
} from '../src';
import { loadExtensionFixtures } from './fixtures';
import { RATIONAL_AGENTS, rationalAgents } from './rationalAgents';

describe('ISTAR_2_0', () => {
  test('is the iStar 2.0 metamodel of the constants, in the same order', () => {
    expect([...ISTAR_2_0.elements.keys()]).toEqual(ELEMENT_KINDS);
    expect([...ISTAR_2_0.links.keys()]).toEqual(LINK_KINDS);
    expect(ISTAR_2_0.elements.get('istar.Goal')).toMatchObject({
      category: 'node',
      label: 'Goal',
      info: NODE_KIND_INFO['istar.Goal'],
      pistarType: 'istar.Goal',
    });
    expect(ISTAR_2_0.elements.get('istar.Agent')?.category).toBe('actor');
    expect(ISTAR_2_0.links.get('istar.ContributionLink')?.info).toBe(
      LINK_KIND_INFO['istar.ContributionLink'],
    );
    expect(ISTAR_2_0.links.get('istar.IsALink')?.category).toBe('actor');
    expect(ISTAR_2_0.links.get('istar.DependencyLink')?.category).toBe('dependency');
  });

  test('the built-in exports keep their exact types', () => {
    expectTypeOf<ElementKind>().toEqualTypeOf<
      | 'istar.Actor'
      | 'istar.Agent'
      | 'istar.Role'
      | 'istar.Goal'
      | 'istar.Quality'
      | 'istar.Resource'
      | 'istar.Task'
    >();
    expectTypeOf<ActorKind>().toEqualTypeOf<'istar.Actor' | 'istar.Agent' | 'istar.Role'>();
    expectTypeOf<NodeKind>().toEqualTypeOf<
      'istar.Goal' | 'istar.Quality' | 'istar.Resource' | 'istar.Task'
    >();
    expectTypeOf<LinkKind>().toEqualTypeOf<
      | 'istar.IsALink'
      | 'istar.ParticipatesInLink'
      | 'istar.DependencyLink'
      | 'istar.AndRefinementLink'
      | 'istar.OrRefinementLink'
      | 'istar.NeededByLink'
      | 'istar.QualificationLink'
      | 'istar.ContributionLink'
    >();
    // Unparameterized types are iStar 2.0's, as before.
    expectTypeOf<IstarModel>().toEqualTypeOf<IstarModel<ElementKind, LinkKind>>();
    expectTypeOf(parsePistar('{}' as string)).toEqualTypeOf<IstarModel>();
    expectTypeOf(createEmptyModel()).toEqualTypeOf<IstarModel>();
    expectTypeOf(createModelStore().getModel()).toEqualTypeOf<IstarModel>();
    expectTypeOf(ISTAR_2_0).toEqualTypeOf<Metamodel>();
  });
});

describe('extendMetamodel', () => {
  test('adds kinds after the base ones, resolving behavesLike', () => {
    const m = RATIONAL_AGENTS;
    expect(m.name).toBe('istar-2.0+rationalAgents');
    expect(m.extensions).toEqual(['rationalAgents']);
    expect([...m.elements.keys()].slice(-2)).toEqual([
      'rationalAgents.Planning',
      'rationalAgents.Plan',
    ]);
    expect(m.elements.get('rationalAgents.Planning')).toMatchObject({
      category: 'node',
      label: 'Planning',
      behavesLike: 'istar.Task',
      size: { width: 95, height: 36 },
      info: NODE_KIND_INFO['istar.Task'],
      pistarType: 'istar.Planning',
      extension: 'rationalAgents',
    });
    expect(m.elements.get('rationalAgents.Plan')).toMatchObject({
      category: 'node',
      size: { width: 90, height: 40 },
      info: { canBeInnerElement: true, canBeDependum: true, canBeOnPaper: false },
      pistarType: 'rationalAgents.Plan',
    });
    expect(m.links.get('rationalAgents.AlternativeLink')).toMatchObject({
      category: 'node',
      behavesLike: 'istar.OrRefinementLink',
    });
    expect(m.elementsByPistarType.get('istar.Planning')).toBe('rationalAgents.Planning');
    expect(effectiveElementKind(m, 'rationalAgents.Planning')).toBe('istar.Task');
  });

  test('leaves the base metamodel untouched', () => {
    expect(elementKindDefinition(ISTAR_2_0, 'rationalAgents.Plan')).toBeUndefined();
    expect(ISTAR_2_0.elementsByPistarType.has('istar.Planning')).toBe(false);
    expect(ISTAR_2_0.extensions).toEqual([]);
  });

  test('types the new kinds', () => {
    type K = ElementKindOf<typeof RATIONAL_AGENTS>;
    expectTypeOf<K>().toEqualTypeOf<
      ElementKind | 'rationalAgents.Planning' | 'rationalAgents.Plan'
    >();
    expectTypeOf<LinkKindOf<typeof RATIONAL_AGENTS>>().toEqualTypeOf<
      LinkKind | 'rationalAgents.GeneratesLink' | 'rationalAgents.AlternativeLink'
    >();
    const model = parsePistar('{"actors":[]}', { metamodel: RATIONAL_AGENTS });
    expectTypeOf(model).toEqualTypeOf<IstarModel<K, LinkKindOf<typeof RATIONAL_AGENTS>>>();
  });

  test.each([
    [{ name: 'x', elements: [{ kind: 'Plan', category: 'node' }] }, /must be namespaced/],
    [
      { name: 'x', elements: [{ kind: 'istar.Plan', category: 'node' }] },
      /reserved "istar\." prefix/,
    ],
    [{ name: 'x', elements: [{ kind: 'x.Plan' }] }, /needs a category/],
    [
      { name: 'x', elements: [{ kind: 'x.Plan', behavesLike: 'istar.Plan' }] },
      /unknown element kind/,
    ],
    [
      { name: 'x', elements: [{ kind: 'x.Boss', category: 'node', behavesLike: 'istar.Agent' }] },
      /is a node but behaves like "istar\.Agent", a actor/,
    ],
    [
      { name: 'x', elements: [{ kind: 'x.Plan', category: 'node', pistarType: 'istar.Goal' }] },
      /pistarType "istar\.Goal" .* already used/,
    ],
    [
      {
        name: 'x',
        elements: [
          { kind: 'x.Plan', category: 'node' },
          { kind: 'x.Plan', category: 'node' },
        ],
      },
      /kind "x\.Plan" already exists/,
    ],
    [{ name: 'x', links: [{ kind: 'x.L' }] }, /exactly one of behavesLike or rules/],
    [
      {
        name: 'x',
        links: [
          {
            kind: 'x.L',
            behavesLike: 'istar.OrRefinementLink',
            rules: { sources: ['node'], targets: ['node'] },
          },
        ],
      },
      /exactly one of behavesLike or rules/,
    ],
    [
      {
        name: 'x',
        links: [{ kind: 'x.L', rules: { sources: ['istar.Plan'], targets: ['node'] } }],
      },
      /sources of "x\.L" names unknown element kind "istar\.Plan"/,
    ],
    [
      { name: 'x', links: [{ kind: 'x.L', rules: { sources: [], targets: ['node'] } }] },
      /needs at least one of sources/,
    ],
    [
      {
        name: 'x',
        links: [{ kind: 'x.D', category: 'dependency', rules: { sources: ['*'], targets: ['*'] } }],
      },
      /must behave like a dependency link/,
    ],
  ] as const)('rejects invalid declarations (%#)', (extension, error) => {
    expect(() => extendMetamodel(ISTAR_2_0, extension as never)).toThrow(error);
  });

  test('a kind may reuse a built-in short name in its own namespace', () => {
    expect(() =>
      extendMetamodel(ISTAR_2_0, {
        name: 'x',
        links: [{ kind: 'x.Goal', behavesLike: 'istar.IsALink' }],
      }),
    ).not.toThrow();
  });

  test('rejects collisions across extensions and repeated application', () => {
    expect(() => extendMetamodel(RATIONAL_AGENTS, rationalAgents)).toThrow(/already applied/);
    expect(() =>
      extendMetamodel(RATIONAL_AGENTS, {
        name: 'other',
        elements: [{ kind: 'rationalAgents.Plan', category: 'node' }],
      }),
    ).toThrow(/already exists/);
    expect(() =>
      extendMetamodel(RATIONAL_AGENTS, {
        name: 'other',
        elements: [{ kind: 'other.Planning', category: 'node', pistarType: 'istar.Planning' }],
      }),
    ).toThrow(MetamodelError);
  });

  test('extensions stack, and later ones can build on earlier kinds', () => {
    const m = extendMetamodel(RATIONAL_AGENTS, {
      name: 'more',
      elements: [{ kind: 'more.Replanning', behavesLike: 'rationalAgents.Planning' }],
    });
    expect(m.extensions).toEqual(['rationalAgents', 'more']);
    expect(effectiveElementKind(m, 'more.Replanning')).toBe('istar.Task');
  });
});

describe('serialization with an extended metamodel', () => {
  const fixtures = loadExtensionFixtures();
  test('there is an extension fixture', () => {
    expect(fixtures.map((f) => f.name)).toContain('extensions/rationalAgents.txt');
  });

  test.each(fixtures.map((f) => [f.name, f] as const))('round-trips byte for byte: %s', (_n, f) => {
    const model = parsePistar(f.text, { metamodel: RATIONAL_AGENTS });
    expect(toPistar(model)).toBe(f.text);
  });

  test('reads piStar-ext types into namespaced kinds and keeps unknown keys', () => {
    const fixture = fixtures.find((f) => f.name === 'extensions/rationalAgents.txt')!;
    const model = parsePistar(fixture.text, { metamodel: RATIONAL_AGENTS });
    expect(metamodelOf(model)).toBe(RATIONAL_AGENTS);
    expect(model.elements.get('p1')).toMatchObject({
      kind: 'rationalAgents.Planning',
      parent: 'a1',
      extra: { extension: { stereotype: 'goal-based' } },
    });
    expect(model.elements.get('d1')).toMatchObject({
      kind: 'rationalAgents.Plan',
      isDependum: true,
    });
    expect(model.links.get('l2')?.kind).toBe('rationalAgents.GeneratesLink');
    expect(model.extra).toHaveProperty('extension');
    expect(validateModel(model)).toEqual([]);
  });

  test('unknown kinds still throw without the extension', () => {
    const fixture = fixtures.find((f) => f.name === 'extensions/rationalAgents.txt')!;
    expect(() => parsePistar(fixture.text)).toThrow(PistarParseError);
    expect(() => parsePistar(fixture.text)).toThrow(/unknown element type "istar\.Planning"/);
    const withoutLinks = { ...JSON.parse(fixture.text), dependencies: [], links: [] };
    withoutLinks.actors[0].nodes = withoutLinks.actors[0].nodes.filter(
      (n: { type: string }) => n.type.startsWith('istar.') && n.type !== 'istar.Planning',
    );
    expect(() => parsePistar(withoutLinks)).not.toThrow();
    const unknownLink = {
      ...withoutLinks,
      links: [{ id: 'z', type: 'rationalAgents.GeneratesLink', source: 'g1', target: 'g2' }],
    };
    expect(() => parsePistar(unknownLink)).toThrow(/unknown link type/);
  });

  test('the metamodel never reaches disk, JSON or the model shape', () => {
    const fixture = fixtures.find((f) => f.name === 'extensions/rationalAgents.txt')!;
    const extended = parsePistar(fixture.text, { metamodel: RATIONAL_AGENTS });
    const builtIn = parsePistar('{"actors":[]}');
    const keys = ['elements', 'links', 'diagram', 'tool', 'istar', 'saveDate', 'extra'];
    expect(Object.keys(extended)).toEqual(keys);
    expect(Object.keys(builtIn)).toEqual(['elements', 'links']);
    expect(Object.keys(createEmptyModel())).toEqual([
      'elements',
      'links',
      'diagram',
      'tool',
      'istar',
    ]);
    expect(Object.keys(createEmptyModel(undefined, { metamodel: RATIONAL_AGENTS }))).toEqual(
      Object.keys(createEmptyModel()),
    );
    expect(JSON.stringify(extended)).not.toContain('metamodel');
    expect(JSON.stringify(extended)).not.toContain('rationalAgents');
    expect(toPistar(extended)).not.toContain('"metamodel"');
  });

  test('a spread loses the association; withMetamodel or an option restores it', () => {
    const fixture = fixtures.find((f) => f.name === 'extensions/rationalAgents.txt')!;
    const model = parsePistar(fixture.text, { metamodel: RATIONAL_AGENTS });
    const bare = { ...model };
    expect(metamodelOf(bare)).toBe(ISTAR_2_0);
    expect(() => toPistar(bare)).toThrow(PistarWriteError);
    expect(() => toPistar(bare)).toThrow(/rationalAgents\.Planning" is not part of istar-2\.0/);
    expect(toPistar(bare, { metamodel: RATIONAL_AGENTS })).toBe(fixture.text);
    expect(toPistar(withMetamodel(bare, RATIONAL_AGENTS))).toBe(fixture.text);
  });

  test('each disk form: piStar-ext type with pistarType, namespaced type without', () => {
    const store = createModelStore(undefined, { metamodel: RATIONAL_AGENTS });
    const agent = store.addElement({ kind: 'istar.Agent', x: 0, y: 0 });
    store.addElement({ kind: 'rationalAgents.Planning', x: 0, y: 0, parent: agent.id });
    store.addElement({ kind: 'rationalAgents.Plan', x: 0, y: 0, parent: agent.id });
    const types = JSON.parse(toPistar(store.getModel())).actors[0].nodes.map(
      (n: { type: string }) => n.type,
    );
    // Planning keeps piStar-ext's `istar.Planning`, which piStar-ext opens (given the same
    // construct in its localStorage); Plan is written namespaced, which plain piStar rejects.
    expect(types).toEqual(['istar.Planning', 'rationalAgents.Plan']);
  });
});

describe('model snapshots keep their metamodel', () => {
  test('through edits, undo and redo', () => {
    const store = createModelStore(undefined, { metamodel: RATIONAL_AGENTS });
    const agent = store.addElement({ kind: 'istar.Agent', x: 0, y: 0 });
    store.addElement({ kind: 'rationalAgents.Plan', x: 0, y: 0, parent: agent.id });
    store.moveElement(agent.id, 5, 5);
    expect(metamodelOf(store.getModel())).toBe(RATIONAL_AGENTS);
    store.undo();
    store.undo();
    expect(metamodelOf(store.getModel())).toBe(RATIONAL_AGENTS);
    store.redo();
    expect(metamodelOf(store.getModel())).toBe(RATIONAL_AGENTS);
    expect(store.getModel().elements.size).toBe(2);
  });
});

describe('pistarType collisions', () => {
  test('a pistarType equal to a built-in kind is rejected', () => {
    expect(() =>
      extendMetamodel(ISTAR_2_0, {
        name: 'clash',
        elements: [{ kind: 'clash.Objective', category: 'node', pistarType: 'istar.Goal' }],
      }),
    ).toThrow(/pistarType "istar\.Goal" of kind "clash\.Objective" is already used/);
    expect(() =>
      extendMetamodel(ISTAR_2_0, {
        name: 'clash',
        links: [
          { kind: 'clash.L', behavesLike: 'istar.OrRefinementLink', pistarType: 'istar.IsALink' },
        ],
      }),
    ).toThrow(MetamodelError);
  });

  test('two extensions with the same pistarType are rejected', () => {
    const first = extendMetamodel(ISTAR_2_0, {
      name: 'one',
      elements: [{ kind: 'one.Plan', category: 'node', pistarType: 'istar.Plan' }],
    });
    expect(() =>
      extendMetamodel(first, {
        name: 'two',
        elements: [{ kind: 'two.Plan', category: 'node', pistarType: 'istar.Plan' }],
      }),
    ).toThrow(/pistarType "istar\.Plan" of kind "two\.Plan" is already used/);
  });

  test("a pistarType may not equal another kind's name either", () => {
    expect(() =>
      extendMetamodel(RATIONAL_AGENTS, {
        name: 'three',
        elements: [{ kind: 'three.Plan', category: 'node', pistarType: 'rationalAgents.Plan' }],
      }),
    ).toThrow(MetamodelError);
  });
});

function setup() {
  const store = createModelStore(undefined, {
    metamodel: RATIONAL_AGENTS,
    createId: (() => {
      let n = 0;
      return () => `id${++n}`;
    })(),
  });
  const agent = store.addElement({ kind: 'istar.Agent', x: 0, y: 0 });
  const inner = <K extends Parameters<typeof store.addElement>[0]['kind']>(
    kind: K,
    name?: string,
  ) => store.addElement({ kind, x: 10, y: 10, parent: agent.id, ...(name ? { name } : {}) });
  return {
    store,
    agent,
    goal: inner('istar.Goal'),
    goal2: inner('istar.Goal'),
    task: inner('istar.Task'),
    resource: inner('istar.Resource'),
    planning: inner('rationalAgents.Planning'),
    plan: inner('rationalAgents.Plan', 'Delivery plan'),
  };
}

describe('canLink with extended kinds', () => {
  test('the store creates extended elements with their label as name', () => {
    const { planning, store } = setup();
    expect(planning).toMatchObject({ kind: 'rationalAgents.Planning', name: 'Planning' });
    expect(metamodelOf(store.getModel())).toBe(RATIONAL_AGENTS);
  });

  test('behavesLike: a Planning follows the Task rules', () => {
    const { store, planning, goal, resource, plan } = setup();
    expect(store.canLink(planning, goal, 'istar.AndRefinementLink')).toEqual({ ok: true });
    expect(store.canLink(resource, planning, 'istar.NeededByLink')).toEqual({ ok: true });
    expect(store.canLink(plan, goal, 'istar.AndRefinementLink')).toMatchObject({
      code: 'invalid-source',
    });
  });

  test('declarative rules, with readable reasons, then the extra predicate', () => {
    const { store, planning, plan, goal, agent } = setup();
    expect(store.canLink(planning, plan, 'rationalAgents.GeneratesLink')).toEqual({ ok: true });
    expect(store.canLink(plan, planning, 'rationalAgents.GeneratesLink')).toEqual({
      ok: false,
      code: 'invalid-source',
      reason: 'the source of a Generates link must be a Planning',
    });
    expect(store.canLink(planning, goal, 'rationalAgents.GeneratesLink')).toMatchObject({
      code: 'invalid-target',
      reason: 'the target of a Generates link must be a Plan',
    });
    const other = store.addElement({ kind: 'istar.Role', x: 500, y: 0 });
    const farPlan = store.addElement({
      kind: 'rationalAgents.Plan',
      x: 510,
      y: 10,
      parent: other.id,
    });
    expect(store.canLink(planning, farPlan, 'rationalAgents.GeneratesLink')).toMatchObject({
      code: 'different-actors',
    });
    store.connect({ kind: 'rationalAgents.GeneratesLink', source: planning.id, target: plan.id });
    expect(store.canLink(planning, plan, 'rationalAgents.GeneratesLink')).toMatchObject({
      code: 'duplicate-link',
    });
    const twin = store.addElement({
      kind: 'rationalAgents.Plan',
      x: 0,
      y: 0,
      parent: agent.id,
      name: 'Planning',
    });
    expect(store.canLink(planning, twin, 'rationalAgents.GeneratesLink')).toMatchObject({
      reason: 'a Planning cannot generate a Plan of the same name',
    });
  });

  test('an extension link behaving like OR-refinement counts as one for iStar 2.0 rules', () => {
    const { store, task, goal, planning } = setup();
    expect(
      store.connect({ kind: 'rationalAgents.AlternativeLink', source: task.id, target: goal.id })
        .ok,
    ).toBe(true);
    // AND and OR can't be mixed on the same parent (iStar 2.0 Guide, page 10).
    expect(store.canLink(planning, goal, 'istar.AndRefinementLink')).toMatchObject({
      code: 'mixed-refinement',
    });
    expect(store.canLink(planning, goal, 'istar.OrRefinementLink')).toEqual({ ok: true });
  });

  test('extended actors and dependencies', () => {
    const m = extendMetamodel(RATIONAL_AGENTS, {
      name: 'org',
      elements: [{ kind: 'org.Team', behavesLike: 'istar.Agent' }],
      links: [{ kind: 'org.DelegationLink', behavesLike: 'istar.DependencyLink' }],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const team = store.addElement({ kind: 'org.Team', x: 0, y: 0 });
    const role = store.addElement({ kind: 'istar.Role', x: 400, y: 0 });
    expect(isActor(team, m)).toBe(true);
    expect(store.canLink(team, role, 'istar.ParticipatesInLink')).toEqual({ ok: true });
    const dep = store.addDependency({
      depender: team.id,
      dependee: role.id,
      dependum: { kind: 'rationalAgents.Plan' },
      linkKind: 'org.DelegationLink',
    });
    expect(dep.ok).toBe(true);
    if (!dep.ok) return;
    expect(dep.links.map((l) => l.kind)).toEqual(['org.DelegationLink', 'org.DelegationLink']);
    // Removing a half removes the whole dependency, as for iStar 2.0 dependencies.
    store.disconnect(dep.links[0].id);
    expect(store.getModel().elements.has(dep.dependum.id)).toBe(false);
    // Moving the extended actor moves nothing else but it; nesting into it works.
    const goal = store.addElement({ kind: 'istar.Goal', x: 5, y: 5, parent: team.id });
    store.moveElement(team.id, 10, 0);
    expect(store.getModel().elements.get(goal.id)?.x).toBe(15);
  });

  test('connect retries reversed for kinds behaving like Needed-By', () => {
    const m = extendMetamodel(ISTAR_2_0, {
      name: 'n',
      links: [{ kind: 'n.UsesLink', behavesLike: 'istar.NeededByLink' }],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const task = store.addElement({ kind: 'istar.Task', x: 0, y: 0, parent: actor.id });
    const res = store.addElement({ kind: 'istar.Resource', x: 0, y: 0, parent: actor.id });
    expect(store.connect({ kind: 'n.UsesLink', source: task.id, target: res.id })).toMatchObject({
      ok: true,
      reversed: true,
    });
  });

  test('canLink on an iStar 2.0 model rejects extension kinds', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 0, y: 0, parent: actor.id });
    expect(canLink(store.getModel() as never, goal.id, goal.id, 'x.Link' as never)).toMatchObject({
      code: 'unknown-link-kind',
    });
    expect(() => store.addElement({ kind: 'x.Plan' as never, x: 0, y: 0 })).toThrow(
      /unknown element kind/,
    );
  });
});

describe('property schemas on extended kinds', () => {
  test('defineProperties accepts and types extension kinds', () => {
    const planSchema = defineProperties('rationalAgents.Plan', {
      horizon: prop.number({ integer: true, min: 1 }),
    });
    expectTypeOf(planSchema.kind).toEqualTypeOf<'rationalAgents.Plan'>();
    const store = createModelStore(undefined, { metamodel: RATIONAL_AGENTS });
    const agent = store.addElement({ kind: 'istar.Agent', x: 0, y: 0 });
    const plan = store.addElement({
      kind: 'rationalAgents.Plan',
      x: 0,
      y: 0,
      parent: agent.id,
      customProperties: { horizon: '0' },
    });
    expect(validateModelProperties(store.getModel(), [planSchema])).toEqual([
      { id: plan.id, key: 'horizon', message: 'must be at least 1' },
    ]);
  });
});
