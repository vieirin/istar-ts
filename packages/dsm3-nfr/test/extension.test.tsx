import { LINE_DASHES, applyExtensions, registryForMetamodel } from '@istar-ts/react';
import type { AnyIstarRegistry, LinkToolEntry } from '@istar-ts/react';
import { describe, expect, it } from 'vitest';
import {
  NFR_AND_MARKER,
  NFR_CONTRIBUTION_LABELS,
  NFR_ELEMENT_KINDS,
  NFR_SHAPES,
  NFR,
  nfrExtension,
} from '../src';

function nfrRegistry(): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(NFR) as AnyIstarRegistry, [
    nfrExtension,
  ]);
}

describe('nfrExtension', () => {
  it('draws every NFR node with its DSM3 shape', () => {
    const registry = nfrRegistry();
    for (const kind of NFR_ELEMENT_KINDS) {
      expect(registry.elements[kind]?.shape).toBe(NFR_SHAPES[kind]);
    }
  });

  it('offers one palette entry per label for Contribution and Correlation', () => {
    const registry = nfrRegistry();
    for (const kind of ['nfr.ContributionLink', 'nfr.CorrelationLink']) {
      const palette = registry.links[kind]?.palette as readonly LinkToolEntry<string>[];
      expect(palette.map((entry) => entry.value)).toEqual([...NFR_CONTRIBUTION_LABELS]);
      expect(new Set(palette.map((entry) => entry.group)).size).toBe(1);
    }
    expect(registry.paletteGroups['nfr-contributions']?.label).toBe('Contribution');
  });

  it('uses DSM3’s markers and dashes', () => {
    const registry = nfrRegistry();
    expect(registry.links['nfr.AndRefinementLink']?.line?.marker).toBe(NFR_AND_MARKER);
    expect(registry.links['nfr.OrRefinementLink']?.line?.markerFilled).toBe(true);
    expect(registry.links['nfr.CorrelationLink']?.line?.dash).toBe(LINE_DASHES.dashed);
    expect(registry.links['nfr.ContributionLink']?.line).toBeUndefined();
  });
});
