/**
 * Ported from piStar `tool/app/istarcore/test/test.js` (modules ActorLinks and ElementsLinks),
 * plus cases for dependency links and the remaining upstream rules, which qunit never covered.
 *
 * Note: upstream's `istar.addXLink` checks `if (isValid(...))`, which is always truthy (it's an
 * object), so those qunit tests could never pass as written. They are ported against the intent:
 * a link is added only when the constraint allows it.
 */
import { describe, expect, test } from 'vitest';
import type { ElementKind, IstarElement, LinkKind } from '../src';
import { canLink, validateModel } from '../src';
import { TestModel, goalModel } from './helpers';

const pair = (a: ElementKind, b: ElementKind) => {
  const m = new TestModel();
  return { m, el1: m.add(a), el2: m.add(b) };
};

const twoActors = () => {
  const g = goalModel();
  const other = g.m.add('istar.Role');
  const otherGoal = g.m.add('istar.Goal', other);
  return { ...g, other, otherGoal };
};

describe('ActorLinks', () => {
  test.each([
    ['istar.Actor', 'istar.Actor', true],
    ['istar.Role', 'istar.Role', true],
    ['istar.Agent', 'istar.Agent', false],
    ['istar.Actor', 'istar.Role', false],
    ['istar.Role', 'istar.Actor', false],
    ['istar.Actor', 'istar.Agent', false],
    ['istar.Agent', 'istar.Actor', false],
    ['istar.Role', 'istar.Agent', false],
    ['istar.Agent', 'istar.Role', false],
  ] as const)('Is-A link from %s to %s allowed: %s', (a, b, allowed) => {
    const { m, el1, el2 } = pair(a, b);
    const link = m.link(el1, el2, 'istar.IsALink');
    expect(link?.kind).toBe(allowed ? 'istar.IsALink' : undefined);
  });

  test('not add more than one Is-A link between the same actors', () => {
    const { m, el1, el2 } = pair('istar.Actor', 'istar.Actor');
    expect(m.link(el1, el2, 'istar.IsALink')?.kind).toBe('istar.IsALink');
    expect(m.link(el1, el2, 'istar.IsALink')).toBeUndefined();
    expect(m.link(el2, el1, 'istar.IsALink')).toBeUndefined();
  });

  const actorKinds = ['istar.Actor', 'istar.Role', 'istar.Agent'] as const;
  for (const a of actorKinds) {
    for (const b of actorKinds) {
      test(`add Participates-In link from ${a} to ${b}`, () => {
        const { m, el1, el2 } = pair(a, b);
        expect(m.link(el1, el2, 'istar.ParticipatesInLink')?.kind).toBe('istar.ParticipatesInLink');
      });
    }
  }

  test('not add more than one Participates-In link between the same actors', () => {
    const { m, el1, el2 } = pair('istar.Actor', 'istar.Actor');
    expect(m.link(el1, el2, 'istar.ParticipatesInLink')).toBeDefined();
    expect(m.link(el1, el2, 'istar.ParticipatesInLink')).toBeUndefined();
    expect(m.link(el2, el1, 'istar.ParticipatesInLink')).toBeUndefined();
  });

  test('not add a Participates-In and an Is-A link (in this order) between the same actors', () => {
    const { m, el1, el2 } = pair('istar.Actor', 'istar.Actor');
    expect(m.link(el1, el2, 'istar.ParticipatesInLink')).toBeDefined();
    expect(m.link(el1, el2, 'istar.IsALink')).toBeUndefined();
    expect(m.link(el2, el1, 'istar.IsALink')).toBeUndefined();
  });

  test('not add an Is-A and a Participates-In link (in this order) between the same actors', () => {
    const { m, el1, el2 } = pair('istar.Actor', 'istar.Actor');
    expect(m.link(el1, el2, 'istar.IsALink')).toBeDefined();
    expect(m.link(el1, el2, 'istar.ParticipatesInLink')).toBeUndefined();
    expect(m.link(el2, el1, 'istar.ParticipatesInLink')).toBeUndefined();
  });

  test('no self links', () => {
    const m = new TestModel();
    const a = m.add('istar.Actor');
    expect(canLink(m.model, a, a, 'istar.IsALink')).toMatchObject({ ok: false, code: 'self-link' });
    expect(canLink(m.model, a, a, 'istar.ParticipatesInLink')).toMatchObject({
      ok: false,
      code: 'self-link',
    });
  });

  test('actor links reject inner elements', () => {
    const { m, goal1, actor } = goalModel();
    expect(canLink(m.model, goal1, actor, 'istar.ParticipatesInLink')).toMatchObject({
      ok: false,
      code: 'invalid-source',
    });
    expect(canLink(m.model, actor, goal1, 'istar.IsALink')).toMatchObject({
      ok: false,
      code: 'actor-types-differ',
    });
  });

  test('Is-A reason precedence matches upstream', () => {
    // Agent → Role fails both the type-equality and the source-kind checks; upstream reports
    // the source-kind message because that check is evaluated last without a guard.
    const { m, el1, el2 } = pair('istar.Agent', 'istar.Role');
    expect(canLink(m.model, el1, el2, 'istar.IsALink')).toMatchObject({ code: 'invalid-source' });
    const p2 = pair('istar.Actor', 'istar.Role');
    expect(canLink(p2.m.model, p2.el1, p2.el2, 'istar.IsALink')).toMatchObject({
      code: 'actor-types-differ',
    });
  });
});

describe('ElementsLinks', () => {
  test('add And-Refinement from Goal to Goal', () => {
    const { m, goal1, goal2 } = goalModel();
    expect(m.link(goal1, goal2, 'istar.AndRefinementLink')?.kind).toBe('istar.AndRefinementLink');
  });

  test('add 1 to M And-Refinements between different Goals', () => {
    const { m, goal1, goal2, goal3 } = goalModel();
    expect(m.link(goal2, goal1, 'istar.AndRefinementLink')).toBeDefined();
    expect(m.link(goal3, goal1, 'istar.AndRefinementLink')).toBeDefined();
  });

  test('add And-Refinement from Task to Task, but only once', () => {
    const { m, task1, task2 } = goalModel();
    expect(m.link(task1, task2, 'istar.AndRefinementLink')).toBeDefined();
    expect(m.link(task1, task2, 'istar.AndRefinementLink')).toBeUndefined();
  });

  test('add And-Refinement from Goal to Task, but not duplicated in either direction', () => {
    const { m, goal1, task2 } = goalModel();
    expect(m.link(goal1, task2, 'istar.AndRefinementLink')).toBeDefined();
    expect(m.link(goal1, task2, 'istar.AndRefinementLink')).toBeUndefined();
    expect(m.link(task2, goal1, 'istar.AndRefinementLink')).toBeUndefined();
  });

  test('add And-Refinement from Task to Goal, but not duplicated in either direction', () => {
    const { m, task1, goal2 } = goalModel();
    expect(m.link(task1, goal2, 'istar.AndRefinementLink')).toBeDefined();
    expect(m.link(task1, goal2, 'istar.AndRefinementLink')).toBeUndefined();
    expect(m.link(goal2, task1, 'istar.AndRefinementLink')).toBeUndefined();
  });

  test.each([
    ['goal1', 'quality1'],
    ['quality2', 'goal2'],
    ['goal1', 'resource1'],
    ['resource2', 'goal1'],
    ['task1', 'quality1'],
    ['quality2', 'task2'],
    ['task1', 'resource1'],
    ['resource2', 'task2'],
    ['quality1', 'quality2'],
    ['resource1', 'resource2'],
    ['quality1', 'resource1'],
    ['resource1', 'quality2'],
  ] as const)('not allow And-Refinement from %s to %s', (s, t) => {
    const g = goalModel();
    expect(g.m.link(g[s], g[t], 'istar.AndRefinementLink')).toBeUndefined();
  });

  test('add Needed-By from Resource to Task, but only once', () => {
    const { m, resource1, task1 } = goalModel();
    expect(m.link(resource1, task1, 'istar.NeededByLink')?.kind).toBe('istar.NeededByLink');
    expect(m.link(resource1, task1, 'istar.NeededByLink')).toBeUndefined();
  });

  test('add Qualification from Quality to Goal, but only once', () => {
    const { m, quality1, goal1 } = goalModel();
    expect(m.link(quality1, goal1, 'istar.QualificationLink')).toBeDefined();
    expect(m.link(quality1, goal1, 'istar.QualificationLink')).toBeUndefined();
  });

  // The 4x4 tables from upstream's testDifferentNodeLinksCombinations.
  type Name = 'goal' | 'quality' | 'task' | 'resource';
  const names: Name[] = ['goal', 'quality', 'task', 'resource'];
  const allowed: Record<string, [Name, Name][]> = {
    'istar.NeededByLink': [['resource', 'task']],
    'istar.ContributionLink': [
      ['goal', 'quality'],
      ['quality', 'quality'],
      ['task', 'quality'],
      ['resource', 'quality'],
    ],
    'istar.QualificationLink': [
      ['quality', 'goal'],
      ['quality', 'task'],
      ['quality', 'resource'],
    ],
    'istar.AndRefinementLink': [
      ['goal', 'goal'],
      ['goal', 'task'],
      ['task', 'task'],
      ['task', 'goal'],
    ],
    'istar.OrRefinementLink': [
      ['goal', 'goal'],
      ['goal', 'task'],
      ['task', 'task'],
      ['task', 'goal'],
    ],
  };
  for (const [kind, pairs] of Object.entries(allowed)) {
    describe(`only allow valid ${kind} combinations`, () => {
      for (const s of names) {
        for (const t of names) {
          const allow = pairs.some(([a, b]) => a === s && b === t);
          test(`${s} -> ${t}: ${allow}`, () => {
            const g = goalModel();
            const source = g[`${s}1`];
            const target = s === t ? g[`${t}2`] : g[`${t}1`];
            const link = g.m.link(source, target, kind as LinkKind);
            expect(link !== undefined).toBe(allow);
          });
        }
      }
    });
  }
});

describe('further upstream rules', () => {
  test('cannot mix AND and OR refinements targeting the same element', () => {
    const { m, goal1, goal2, goal3 } = goalModel();
    m.link(goal2, goal1, 'istar.AndRefinementLink');
    expect(canLink(m.model, goal3, goal1, 'istar.OrRefinementLink')).toMatchObject({
      ok: false,
      code: 'mixed-refinement',
    });
    const g = goalModel();
    g.m.link(g.goal2, g.goal1, 'istar.OrRefinementLink');
    expect(canLink(g.m.model, g.goal3, g.goal1, 'istar.AndRefinementLink')).toMatchObject({
      ok: false,
      code: 'mixed-refinement',
    });
  });

  test('refinement and node links require the same actor', () => {
    const { m, goal1 } = goalModel();
    const other = m.add('istar.Agent');
    const goal = m.add('istar.Goal', other);
    for (const kind of ['istar.AndRefinementLink', 'istar.OrRefinementLink'] as const) {
      expect(canLink(m.model, goal, goal1, kind)).toMatchObject({ code: 'different-actors' });
    }
    const q = m.add('istar.Quality', other);
    expect(canLink(m.model, goal1, q, 'istar.ContributionLink')).toMatchObject({
      code: 'different-actors',
    });
  });

  test('contribution and qualification cannot coexist between the same pair', () => {
    const { m, quality1, goal1, quality2 } = goalModel();
    m.link(quality1, goal1, 'istar.QualificationLink');
    expect(canLink(m.model, goal1, quality1, 'istar.ContributionLink')).toMatchObject({
      code: 'contribution-and-qualification',
    });
    m.link(quality2, quality1, 'istar.ContributionLink');
    expect(canLink(m.model, quality1, quality2, 'istar.ContributionLink')).toMatchObject({
      code: 'duplicate-link',
    });
  });

  test('self links are rejected for node links', () => {
    const { m, goal1, quality1 } = goalModel();
    expect(canLink(m.model, goal1, goal1, 'istar.AndRefinementLink')).toMatchObject({
      code: 'self-link',
    });
    expect(canLink(m.model, quality1, quality1, 'istar.ContributionLink')).toMatchObject({
      code: 'self-link',
    });
  });

  test('unknown ids are reported, not thrown', () => {
    const { m, goal1 } = goalModel();
    expect(canLink(m.model, 'nope', goal1, 'istar.AndRefinementLink')).toMatchObject({
      ok: false,
      code: 'unknown-element',
    });
  });
});

describe('DependencyLink', () => {
  test('between two actors, or elements of two actors', () => {
    const { m, actor, other, goal1, otherGoal } = twoActors();
    expect(canLink(m.model, actor, other, 'istar.DependencyLink')).toEqual({ ok: true });
    expect(canLink(m.model, goal1, otherGoal, 'istar.DependencyLink')).toEqual({ ok: true });
    expect(canLink(m.model, goal1, other, 'istar.DependencyLink')).toEqual({ ok: true });
  });

  test('must involve two different actors', () => {
    const { m, actor, goal1, goal2 } = twoActors();
    expect(canLink(m.model, goal1, goal2, 'istar.DependencyLink')).toMatchObject({
      code: 'same-actor',
    });
    expect(canLink(m.model, goal1, actor, 'istar.DependencyLink')).toMatchObject({
      code: 'same-actor',
    });
    expect(canLink(m.model, actor, actor, 'istar.DependencyLink')).toMatchObject({
      code: 'self-link',
    });
  });

  test('dependums cannot be depender or dependee, nor take part in node links', () => {
    const { m, actor, other, goal1 } = twoActors();
    const dep = m.dependency(actor, 'istar.Goal', other);
    expect(dep).toBeDefined();
    const dependum = dep!.dependum as IstarElement;
    expect(canLink(m.model, dependum, other, 'istar.DependencyLink')).toMatchObject({
      code: 'dependum-endpoint',
    });
    expect(canLink(m.model, actor, dependum, 'istar.DependencyLink')).toMatchObject({
      code: 'dependum-endpoint',
    });
    // A dependum has no parent, so node links fail the dependum rule before the actor rule.
    expect(canLink(m.model, goal1, dependum, 'istar.AndRefinementLink')).toMatchObject({
      code: 'dependum-endpoint',
    });
  });

  test('a refined or contributed element cannot be a depender', () => {
    const { m, goal1, goal2, quality1, quality2, otherGoal } = twoActors();
    m.link(goal2, goal1, 'istar.AndRefinementLink');
    expect(canLink(m.model, goal1, otherGoal, 'istar.DependencyLink')).toMatchObject({
      code: 'refined-depender',
    });
    m.link(quality2, quality1, 'istar.ContributionLink');
    expect(canLink(m.model, quality1, otherGoal, 'istar.DependencyLink')).toMatchObject({
      code: 'contributed-depender',
    });
    // Refined dependee is fine.
    expect(canLink(m.model, otherGoal, goal1, 'istar.DependencyLink')).toEqual({ ok: true });
  });

  test('a depender element cannot then be refined or contributed to', () => {
    const { m, goal1, goal2, quality1, quality2, otherGoal } = twoActors();
    m.dependency(goal1, 'istar.Resource', otherGoal);
    expect(canLink(m.model, goal2, goal1, 'istar.OrRefinementLink')).toMatchObject({
      code: 'depender-target',
    });
    m.dependency(quality1, 'istar.Goal', otherGoal);
    expect(canLink(m.model, quality2, quality1, 'istar.ContributionLink')).toMatchObject({
      code: 'depender-target',
    });
  });
});

describe('validateModel', () => {
  test('reports links that break the rules, in load order', () => {
    const { m, goal1, goal2, goal3, quality1 } = goalModel();
    m.forceLink(goal2, goal1, 'istar.AndRefinementLink');
    const bad1 = m.forceLink(goal3, goal1, 'istar.OrRefinementLink');
    const bad2 = m.forceLink(goal1, quality1, 'istar.NeededByLink');
    expect(validateModel(m.model).map((i) => [i.linkId, i.code])).toEqual([
      [bad1.id, 'mixed-refinement'],
      [bad2.id, 'invalid-source'],
    ]);
  });

  test('a valid model has no issues', () => {
    const { m, goal1, goal2, actor } = goalModel();
    const other = m.add('istar.Actor');
    m.link(goal2, goal1, 'istar.AndRefinementLink');
    m.dependency(actor, 'istar.Goal', other);
    expect(validateModel(m.model)).toEqual([]);
  });
});
