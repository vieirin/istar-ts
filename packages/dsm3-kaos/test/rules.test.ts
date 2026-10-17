// One test per branch of DSM3-goals' `language_kaos_constraints.js` that core can express
// today. The refinement-hub branches ("towards an existing Refinement link", "one leg per
// source") arrive with core's n-ary links.
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
  };
  return { add, check, connect };
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
