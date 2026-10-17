// One test per branch of DSM3-goals' `language_kaos_constraints.js`, by constraint code. Its
// "must be an element" branches are the cases where a link id is the source or the target.
import { canLink, createEmptyModel, createModelStore } from '@istar-ts/core';
import type { IstarElement } from '@istar-ts/core';
import { describe, expect, it } from 'vitest';
import { KAOS } from '../src';
import type { KaosElementKind, KaosLinkKind } from '../src';

function setup() {
  const store = createModelStore(createEmptyModel(undefined, { metamodel: KAOS }));
  let y = 0;
  const add = (kind: KaosElementKind): IstarElement<KaosElementKind> =>
    store.addElement({ kind, x: 0, y: (y += 60) });
  const check = (s: IstarElement<string>, t: IstarElement<string>, kind: KaosLinkKind) =>
    canLink(store.getModel(), s.id, t.id, kind);
  const connect = (s: IstarElement<string>, t: IstarElement<string>, kind: KaosLinkKind) => {
    const result = store.connect({ kind, source: s.id, target: t.id });
    if (!result.ok) throw new Error(`setup: ${result.reason}`);
    return result;
  };
  /** A refinement of `parent` by `child`: its hub. */
  const refine = (child: IstarElement<string>, parent: IstarElement<string>) =>
    connect(child, parent, 'kaos.RefinementLink').hub!.hub as IstarElement<string>;
  return { store, add, check, connect, refine };
}

describe('RefinementLink.isValid', () => {
  it('rejects a refinement from an element onto itself', () => {
    const { add, check } = setup();
    const goal = add('kaos.BehavioralGoal');
    expect(check(goal, goal, 'kaos.RefinementLink')).toMatchObject({
      ok: false,
      code: 'self-link',
    });
  });

  it('rejects refining with an agent or environment agent', () => {
    const { add, check } = setup();
    const goal = add('kaos.BehavioralGoal');
    for (const kind of ['kaos.Agent', 'kaos.EnvironmentAgent'] as const) {
      expect(check(add(kind), goal, 'kaos.RefinementLink')).toMatchObject({
        ok: false,
        code: 'invalid-source',
      });
    }
  });

  it('rejects a new refinement towards an existing refinement’s circle: that adds a leg', () => {
    // DSM3 refuses it ("create just a Refinement leg"); here the same gesture adds the leg.
    const { add, check, refine, store } = setup();
    const hub = refine(add('kaos.BehavioralGoal'), add('kaos.Softgoal'));
    const second = add('kaos.DomainProperty');
    expect(check(second, hub, 'kaos.RefinementLink')).toEqual({ ok: true });
    const result = store.connect({
      kind: 'kaos.RefinementLink',
      source: second.id,
      target: hub.id,
    });
    expect(result.ok && result.hub?.legs.map((leg) => leg.source)).toContain(second.id);
  });

  it('accepts goals and domain properties refining any element, more than once', () => {
    const { add, check, connect } = setup();
    const parent = add('kaos.Softgoal');
    for (const kind of ['kaos.BehavioralGoal', 'kaos.Softgoal', 'kaos.DomainProperty'] as const) {
      expect(check(add(kind), parent, 'kaos.RefinementLink')).toEqual({ ok: true });
    }
    // DSM3 leaves its "only one Refinement link between the same two elements" check commented out.
    const child = add('kaos.BehavioralGoal');
    connect(child, parent, 'kaos.RefinementLink');
    expect(check(child, parent, 'kaos.RefinementLink')).toEqual({ ok: true });
  });
});

describe('RefinementLinkStart.isValid (a leg)', () => {
  it('rejects a leg from the hub onto itself, and from an agent', () => {
    const { add, check, refine } = setup();
    const hub = refine(add('kaos.BehavioralGoal'), add('kaos.Softgoal'));
    expect(check(hub, hub, 'kaos.RefinementLinkStart')).toMatchObject({ ok: false });
    expect(check(add('kaos.Agent'), hub, 'kaos.RefinementLinkStart')).toMatchObject({
      ok: false,
      code: 'invalid-source',
    });
  });

  it('only goes towards the circle of an existing refinement', () => {
    const { add, check } = setup();
    expect(
      check(add('kaos.BehavioralGoal'), add('kaos.Softgoal'), 'kaos.RefinementLinkStart'),
    ).toMatchObject({ ok: false, code: 'invalid-target' });
  });

  it('allows one leg per source for a refinement', () => {
    const { add, check, refine } = setup();
    const child = add('kaos.BehavioralGoal');
    const hub = refine(child, add('kaos.Softgoal'));
    expect(check(child, hub, 'kaos.RefinementLinkStart')).toMatchObject({
      ok: false,
      code: 'duplicate-link',
    });
    expect(check(add('kaos.Softgoal'), hub, 'kaos.RefinementLinkStart')).toEqual({ ok: true });
  });
});

describe('ResponsibilityAssignment.isValid', () => {
  it('rejects an assignment from an element onto itself', () => {
    const { add, check } = setup();
    const agent = add('kaos.Agent');
    expect(check(agent, agent, 'kaos.ResponsibilityAssignment')).toMatchObject({
      ok: false,
      code: 'self-link',
    });
  });

  it('needs an Agent or Environment Agent as its source', () => {
    const { add, check } = setup();
    const goal = add('kaos.BehavioralGoal');
    expect(check(add('kaos.Softgoal'), goal, 'kaos.ResponsibilityAssignment')).toMatchObject({
      ok: false,
      code: 'invalid-source',
    });
    expect(check(add('kaos.Agent'), goal, 'kaos.ResponsibilityAssignment')).toEqual({ ok: true });
    expect(check(add('kaos.EnvironmentAgent'), goal, 'kaos.ResponsibilityAssignment')).toEqual({
      ok: true,
    });
  });

  it('rejects an assignment towards a refinement’s circle', () => {
    const { add, check, refine } = setup();
    const hub = refine(add('kaos.BehavioralGoal'), add('kaos.Softgoal'));
    expect(check(add('kaos.Agent'), hub, 'kaos.ResponsibilityAssignment')).toMatchObject({
      ok: false,
      code: 'hub-target',
    });
  });

  it('allows one assignment between the same two elements', () => {
    const { add, check, connect } = setup();
    const agent = add('kaos.Agent');
    const goal = add('kaos.BehavioralGoal');
    connect(agent, goal, 'kaos.ResponsibilityAssignment');
    expect(check(agent, goal, 'kaos.ResponsibilityAssignment')).toMatchObject({
      ok: false,
      code: 'duplicate-link',
    });
  });
});

describe('Conflict.isValid', () => {
  it('rejects a conflict from an element onto itself', () => {
    const { add, check } = setup();
    const goal = add('kaos.BehavioralGoal');
    expect(check(goal, goal, 'kaos.Conflict')).toMatchObject({ ok: false, code: 'self-link' });
  });

  it('rejects a conflict towards a refinement’s circle', () => {
    const { add, check, refine } = setup();
    const hub = refine(add('kaos.BehavioralGoal'), add('kaos.Softgoal'));
    expect(check(add('kaos.DomainProperty'), hub, 'kaos.Conflict')).toMatchObject({
      ok: false,
      code: 'hub-target',
    });
  });

  it('allows one conflict between the same two elements, either way', () => {
    const { add, check, connect } = setup();
    const a = add('kaos.BehavioralGoal');
    const b = add('kaos.DomainProperty');
    expect(check(a, b, 'kaos.Conflict')).toEqual({ ok: true });
    connect(a, b, 'kaos.Conflict');
    expect(check(a, b, 'kaos.Conflict')).toMatchObject({ ok: false, code: 'duplicate-link' });
    expect(check(b, a, 'kaos.Conflict')).toMatchObject({ ok: false, code: 'duplicate-link' });
  });
});

/** A model with one Conflict link, for links whose source or target is a link. */
function withLink() {
  const t = setup();
  const link = t.connect(t.add('kaos.Softgoal'), t.add('kaos.DomainProperty'), 'kaos.Conflict');
  return { ...t, link };
}

// DSM3's `!source.isElement()` / `!target.isElement()`: a link as the source is no element at all
// (unknown-element); a link as the target matches none of the element selectors (invalid-target).
describe.each([
  ['kaos.RefinementLink', 'kaos.BehavioralGoal'],
  ['kaos.RefinementLinkStart', 'kaos.BehavioralGoal'],
  ['kaos.ResponsibilityAssignment', 'kaos.Agent'],
  ['kaos.Conflict', 'kaos.BehavioralGoal'],
] as const)('%s.isValid: endpoints must be elements', (kind, sourceKind) => {
  it('!source.isElement()', () => {
    const { store, add, link } = withLink();
    const target = add('kaos.Softgoal');
    expect(canLink(store.getModel(), link.link.id, target.id, kind)).toMatchObject({
      ok: false,
      code: 'unknown-element',
    });
  });

  it('!target.isElement()', () => {
    const { store, add, link } = withLink();
    const source = add(sourceKind);
    expect(canLink(store.getModel(), source.id, link.link.id, kind)).toMatchObject({
      ok: false,
      code: 'invalid-target',
    });
  });
});
