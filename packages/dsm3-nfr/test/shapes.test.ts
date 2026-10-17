import { describe, expect, it } from 'vitest';
import { NFR_CLOUD_PATH, NFR_CONTRIBUTION_LABELS, NFR_ELEMENT_KINDS, NFR_SHAPES } from '../src';

describe('NFR_SHAPES', () => {
  it('draws every NFR node as DSM3’s cloud', () => {
    for (const kind of NFR_ELEMENT_KINDS) expect(NFR_SHAPES[kind].path).toBe(NFR_CLOUD_PATH);
  });

  it('draws every cloud on white, as DSM3 does', () => {
    for (const shape of Object.values(NFR_SHAPES)) expect(shape.fill).toBe('white');
  });

  it('draws Operationalizations bold and Claims dashed, as DSM3 does', () => {
    expect(NFR_SHAPES['nfr.Operationalization'].strokeWidth).toBe(5);
    expect(NFR_SHAPES['nfr.Claim']).toMatchObject({ dash: '10,5', strokeWidth: 1 });
    expect(NFR_SHAPES['nfr.NFR'].dash).toBeUndefined();
  });
});

describe('NFR_CONTRIBUTION_LABELS', () => {
  it('writes the negative labels with U+2013 EN DASH, as DSM3 files do', () => {
    expect(NFR_CONTRIBUTION_LABELS[4]).toBe('–');
    expect(NFR_CONTRIBUTION_LABELS[5]).toBe('– –');
    expect(NFR_CONTRIBUTION_LABELS.filter((l) => l.includes('-'))).toEqual(['some-']);
  });
});
