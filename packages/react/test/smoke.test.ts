import { ELEMENT_KINDS } from '@istar-ts/core';
import { expect, test } from 'vitest';

test('resolves @istar-ts/core from source', () => {
  expect(ELEMENT_KINDS).toContain('istar.Goal');
});
