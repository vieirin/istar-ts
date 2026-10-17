import { ISTAR_2_0, detectFramework, parsePistar, toPistar, validateModel } from '@istar-ts/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NFR } from '../../dsm3-nfr/src';
import { KAOS } from '../src';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/dsm3', name), 'utf8');

describe('DSM3-goals KAOS files', () => {
  it('kaos-welcome.txt round-trips byte for byte', () => {
    const text = fixture('kaos-welcome.txt');
    expect(toPistar(parsePistar(text, { metamodel: KAOS }))).toBe(text);
  });

  it('reads its refinements as hubs with legs and ends, and is valid', () => {
    const model = parsePistar(fixture('kaos-welcome.txt'), { metamodel: KAOS });
    const count = (kind: string) => [...model.links.values()].filter((l) => l.kind === kind).length;
    const hubs = [...model.elements.values()].filter((e) => e.kind === 'kaos.RefinementLinkHub');
    expect(hubs).toHaveLength(4);
    expect(count('kaos.RefinementLinkStart')).toBe(5);
    expect(count('kaos.RefinementLinkEnd')).toBe(4);
    expect(validateModel(model)).toEqual([]);
  });

  it('is detected as KAOS among the three roots', () => {
    expect(detectFramework(fixture('kaos-welcome.txt'), [ISTAR_2_0, KAOS, NFR])).toBe(KAOS);
  });
});
