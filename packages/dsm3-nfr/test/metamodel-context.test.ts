/**
 * #240: `@istar-ts/actions`' `metamodelContext`/`metamodelContextText` are dialect-agnostic —
 * they work unchanged over NFR, with its own contribution label set.
 */
import { describe, expect, test } from 'vitest';
import { metamodelContext, metamodelContextText } from '@istar-ts/actions';
import type { AnyMetamodel } from '@istar-ts/core';
import { NFR, NFR_CONTRIBUTION_LABELS } from '../src';

const metamodel = NFR as unknown as AnyMetamodel;

describe('metamodelContext(NFR)', () => {
  test("the Contribution link's values are NFR's own labels", () => {
    const context = metamodelContext(metamodel);
    const contribution = context.links.find((l) => l.kind.endsWith('ContributionLink'));
    expect(contribution?.values).toEqual([...NFR_CONTRIBUTION_LABELS]);
  });
});

describe('metamodelContextText(NFR)', () => {
  test('is deterministic and matches a snapshot', () => {
    const text = metamodelContextText(metamodelContext(metamodel));
    expect(text).toBe(metamodelContextText(metamodelContext(metamodel)));
    expect(text).toMatchSnapshot();
  });
});
