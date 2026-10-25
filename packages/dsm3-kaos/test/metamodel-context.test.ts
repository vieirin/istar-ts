/**
 * #240: `@istar-ts/actions`' `metamodelContext`/`metamodelContextText` are dialect-agnostic —
 * they work unchanged over KAOS, with its hub-joined AND-refinement and its property schemas.
 */
import { describe, expect, test } from 'vitest';
import { metamodelContext, metamodelContextText } from '@istar-ts/actions';
import type { AnyMetamodel, PropertySchema, PropertyShape } from '@istar-ts/core';
import { KAOS, KAOS_PROPERTY_SCHEMAS, KAOS_REFINEMENT_HUB } from '../src';

const metamodel = KAOS as unknown as AnyMetamodel;
const schemas = KAOS_PROPERTY_SCHEMAS as unknown as readonly PropertySchema<
  PropertyShape,
  string
>[];

describe('metamodelContext(KAOS)', () => {
  test('hides the AND-refinement hub, but keeps the refinement link kind, marked n-ary', () => {
    const context = metamodelContext(metamodel);
    expect(context.elements.map((e) => e.kind)).not.toContain(KAOS_REFINEMENT_HUB);
    const refinement = context.links.find((l) => l.kind === 'kaos.RefinementLink');
    expect(refinement?.arity).toBe('n');
  });

  test('attaches a kind’s property schema', () => {
    const context = metamodelContext(metamodel, { schemas });
    const goal = context.elements.find((e) => e.kind === 'kaos.BehavioralGoal')!;
    expect(goal.properties?.map((p) => p.key)).toContain('Priority');
  });
});

describe('metamodelContextText(KAOS)', () => {
  test('is deterministic and matches a snapshot', () => {
    const text = metamodelContextText(metamodelContext(metamodel, { schemas }));
    expect(text).toBe(metamodelContextText(metamodelContext(metamodel, { schemas })));
    expect(text).toMatchSnapshot();
  });
});
