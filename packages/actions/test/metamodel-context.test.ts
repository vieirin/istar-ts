/**
 * #240: `metamodelContext`/`metamodelContextText` are derived only from a `Metamodel`, so they
 * work unchanged for iStar 2.0 and any `extendMetamodel` result. KAOS and NFR's own snapshots
 * live in their packages (`packages/dsm3-kaos/test`, `packages/dsm3-nfr/test`), which already
 * depend on `@istar-ts/actions` — not the other way around.
 */
import { describe, expect, test } from 'vitest';
import {
  ISTAR_2_0,
  createEmptyModel,
  defineProperties,
  extendMetamodel,
  metamodelOf,
  prop,
} from '@istar-ts/core';
import type { AnyMetamodel, PropertySchema, PropertyShape } from '@istar-ts/core';
import { metamodelContext, metamodelContextProvider, metamodelContextText } from '../src';

const ISTAR = ISTAR_2_0 as unknown as AnyMetamodel;

describe('metamodelContext(ISTAR_2_0)', () => {
  const context = metamodelContext(ISTAR);

  test('lists actor and node kinds, without hubs', () => {
    const kinds = context.elements.map((e) => e.kind);
    expect(kinds).toEqual([
      'istar.Actor',
      'istar.Agent',
      'istar.Role',
      'istar.Goal',
      'istar.Quality',
      'istar.Resource',
      'istar.Task',
    ]);
  });

  test('every link kind carries its sources, targets and category', () => {
    const contribution = context.links.find((l) => l.kind === 'istar.ContributionLink')!;
    expect(contribution.category).toBe('node');
    expect(contribution.values).toEqual(['make', 'help', 'hurt', 'break']);
    expect(contribution.sources).toContain('istar.Goal');
    expect(contribution.targets).toContain('istar.Quality');
  });

  test('the dependency link spans actor and node kinds, not just one category', () => {
    const dependency = context.links.find((l) => l.kind === 'istar.DependencyLink')!;
    expect(dependency.category).toBe('dependency');
    expect(dependency.sources).toEqual(expect.arrayContaining(['istar.Actor', 'istar.Goal']));
  });
});

describe('metamodelContextText', () => {
  test('is deterministic across calls', () => {
    const a = metamodelContextText(metamodelContext(ISTAR));
    const b = metamodelContextText(metamodelContext(ISTAR));
    expect(a).toBe(b);
  });

  test('matches a snapshot for iStar 2.0', () => {
    expect(metamodelContextText(metamodelContext(ISTAR))).toMatchSnapshot();
  });
});

const JOINT_SOURCE_SELECTOR = ['istar.Goal'];

describe('a synthetic extended metamodel', () => {
  const extended = extendMetamodel(ISTAR_2_0, {
    name: 'x',
    elements: [{ kind: 'x.Milestone', category: 'node', behavesLike: 'istar.Goal' }],
    links: [
      {
        kind: 'x.Joint',
        arity: 'n',
        rules: { sources: JOINT_SOURCE_SELECTOR, targets: ['istar.Goal'] },
      },
    ],
  }) as unknown as AnyMetamodel;

  test('includes the extension kind but hides its generated hub/leg/end kinds', () => {
    const context = metamodelContext(extended);
    expect(context.elements.map((e) => e.kind)).toContain('x.Milestone');
    const hub = extended.links.get('x.Joint')!.parts!.hub;
    expect(context.elements.map((e) => e.kind)).not.toContain(hub);
    expect(context.links.map((l) => l.kind)).toEqual(expect.arrayContaining(['x.Joint']));
    expect(context.links.map((l) => l.kind)).not.toContain(
      extended.links.get('x.Joint')!.parts!.leg,
    );
  });

  test('marks the n-ary link kind as such', () => {
    const joint = metamodelContext(extended).links.find((l) => l.kind === 'x.Joint')!;
    expect(joint.arity).toBe('n');
  });

  test('matches a snapshot', () => {
    expect(metamodelContextText(metamodelContext(extended))).toMatchSnapshot();
  });
});

interface MilestoneProperties extends PropertyShape {
  readonly Rationale: ReturnType<typeof prop.string>;
}

describe('schemas', () => {
  const schema: PropertySchema<MilestoneProperties, 'istar.Goal'> = defineProperties('istar.Goal', {
    Rationale: prop.string({ description: 'Why this goal exists.' }),
  });

  test('attach a kind’s property schema to its context entry', () => {
    const context = metamodelContext(ISTAR, {
      schemas: [schema as unknown as PropertySchema<PropertyShape, string>],
    });
    const goal = context.elements.find((e) => e.kind === 'istar.Goal')!;
    expect(goal.properties).toEqual([
      { key: 'Rationale', type: 'string', description: 'Why this goal exists.' },
    ]);
  });

  test('a kind with no schema carries none', () => {
    const context = metamodelContext(ISTAR, {
      schemas: [schema as unknown as PropertySchema<PropertyShape, string>],
    });
    const task = context.elements.find((e) => e.kind === 'istar.Task')!;
    expect(task.properties).toBeUndefined();
  });
});

describe('metamodelContextProvider', () => {
  test('reads the text from the model at hand, whatever its metamodel', () => {
    const provider = metamodelContextProvider();
    const model = createEmptyModel();
    const text = provider.text as (m: typeof model) => string;
    expect(text(model)).toBe(
      metamodelContextText(metamodelContext(metamodelOf(model) as AnyMetamodel)),
    );
  });
});
