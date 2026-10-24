import { describe, expect, it } from 'vitest';
import { ACTIONS_PROTOCOL_VERSION } from '../src/index';

describe('@istar-ts/actions', () => {
  it('exports a protocol version string', () => {
    expect(typeof ACTIONS_PROTOCOL_VERSION).toBe('string');
  });
});
