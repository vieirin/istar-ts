import { ISTAR_2_0, detectFramework, parsePistar, toPistar, validateModel } from '@istar-ts/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KAOS } from '../../dsm3-kaos/src';
import { NFR, NFR_CONTRIBUTION_LABELS } from '../src';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/dsm3', name), 'utf8');

describe('DSM3-goals NFR files', () => {
  it('nfr-welcome.txt round-trips byte for byte', () => {
    const text = fixture('nfr-welcome.txt');
    expect(toPistar(parsePistar(text, { metamodel: NFR }))).toBe(text);
  });

  it('reads its Argument as a link towards a link, and is valid', () => {
    const model = parsePistar(fixture('nfr-welcome.txt'), { metamodel: NFR });
    const argument = [...model.links.values()].find((l) => l.kind === 'nfr.ArgumentLink')!;
    expect(model.links.get(argument.target)?.kind).toBe('nfr.ContributionLink');
    expect(validateModel(model)).toEqual([]);
  });

  it('uses only DSM3’s contribution labels', () => {
    const model = parsePistar(fixture('nfr-welcome.txt'), { metamodel: NFR });
    const labels = [...model.links.values()].flatMap((l) => (l.label ? [l.label] : []));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(NFR_CONTRIBUTION_LABELS).toContain(label);
  });

  it('is detected as NFR among the three roots; DSM3’s iStar 2.0 example as iStar 2.0', () => {
    const roots = [ISTAR_2_0, KAOS, NFR];
    expect(detectFramework(fixture('nfr-welcome.txt'), roots)).toBe(NFR);
    expect(detectFramework(fixture('istar2-welcome.txt'), roots)).toBe(ISTAR_2_0);
  });
});
