import { expect, test } from 'vitest';
import { CORE_VERSION } from '../src/index';

test('package loads and resolves core from source', () => {
  expect(CORE_VERSION).toBe('0.1.0');
});
