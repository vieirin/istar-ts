import { parsePistar } from '@istar-ts/core';
import {
  IstarCanvas,
  LINE_DASHES,
  applyExtensions,
  linkAnchorId,
  registryForMetamodel,
} from '@istar-ts/react';
import type { AnyIstarRegistry, LinkToolEntry } from '@istar-ts/react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NFR_AND_MARKER,
  NFR_CLOUD_PATH,
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
      expect(new Set(palette.map((entry) => entry.group))).toEqual(new Set([kind]));
    }
    expect(registry.paletteGroups['nfr.ContributionLink']?.label).toBe('Contribution');
  });

  it('uses DSM3’s markers and dashes', () => {
    const registry = nfrRegistry();
    expect(registry.links['nfr.AndRefinementLink']?.line?.marker).toBe(NFR_AND_MARKER);
    expect(registry.links['nfr.OrRefinementLink']?.line?.markerFilled).toBe(true);
    expect(registry.links['nfr.CorrelationLink']?.line?.dash).toBe(LINE_DASHES.dashed);
    expect(registry.links['nfr.ContributionLink']?.line).toBeUndefined();
  });
});

describe('nfr-welcome.txt on the canvas', () => {
  it('draws DSM3’s clouds and the Argument’s anchor on its contribution', () => {
    const text = readFileSync(
      join(import.meta.dirname, '../../../fixtures/dsm3/nfr-welcome.txt'),
      'utf8',
    );
    const model = parsePistar(text, { metamodel: NFR });
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas model={model} extensions={[nfrExtension]} />
      </div>,
    );
    expect(container.querySelectorAll(`.istar-shape path[d="${NFR_CLOUD_PATH}"]`)).toHaveLength(
      model.elements.size,
    );
    const argument = [...model.links.values()].find((l) => l.kind === 'nfr.ArgumentLink')!;
    expect(container.querySelector(`[data-id="${linkAnchorId(argument.target)}"]`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actor' })).toBeNull();
  });
});
