import { createEmptyModel, toPistar } from '@istar-ts/core';
import { DSM3_FILE_KEYS } from '@istar-ts/core';
import { describe, expect, it } from 'vitest';
import { NFR, NFR_CONTRIBUTION_LABELS, NFR_ELEMENT_KINDS } from '../src';

describe('NFR', () => {
  it('is a root metamodel of its own, under the nfr prefix', () => {
    expect(NFR.framework).toBe('nfr');
    expect(NFR.prefix).toBe('nfr');
    expect([...NFR.elements.keys()]).toEqual([...NFR_ELEMENT_KINDS]);
  });

  it('puts every node on the paper, at DSM3’s size', () => {
    for (const definition of NFR.elements.values()) {
      expect(definition.info?.canBeOnPaper).toBe(true);
      expect(definition.info?.canBeInnerElement).toBe(false);
      expect(definition.size).toEqual({ width: 90, height: 55 });
    }
  });

  it('gives Contribution and Correlation DSM3’s changeable labels', () => {
    for (const kind of ['nfr.ContributionLink', 'nfr.CorrelationLink'] as const) {
      expect(NFR.links.get(kind)?.info).toEqual({
        changeableLabel: true,
        possibleLabels: NFR_CONTRIBUTION_LABELS,
      });
    }
  });

  it('gives every element and link kind a non-empty description', () => {
    for (const definition of NFR.elements.values()) {
      expect(definition.description).toMatch(/\S/);
    }
    for (const definition of NFR.links.values()) {
      expect(definition.description).toMatch(/\S/);
    }
  });

  it('writes new models as DSM3-goals does', () => {
    const file = JSON.parse(toPistar(createEmptyModel(undefined, { metamodel: NFR })));
    expect(file).toMatchObject({ tool: 'dsm3-goals', metamodelVersion: '1.0' });
    expect(file).not.toHaveProperty('istar');
    const keys = Object.keys(file);
    expect(keys).toEqual(DSM3_FILE_KEYS.filter((key) => keys.includes(key)));
  });
});
