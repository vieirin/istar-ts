import { contextActionsFor } from '@istar-ts/actions';
import type { LinkToolEntryDescription, PaletteEntryDescription } from '@istar-ts/core';
import type { AnyIstarRegistry, LinkToolEntry } from '@istar-ts/react';
import { applyExtensions, registryForMetamodel } from '@istar-ts/react';
import { describe, expect, it } from 'vitest';
import { NFR, NFR_PALETTE, nfrExtension } from '../src';

function nfrRegistry(): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(NFR) as AnyIstarRegistry, [
    nfrExtension,
  ]);
}

/** The core-relevant fields of a live registry's palette entry, for comparison with a description. */
function corePart(
  entry: PaletteEntryDescription | LinkToolEntryDescription,
): Pick<PaletteEntryDescription, 'label' | 'order' | 'section' | 'group'> {
  const { label, order, section, group } = entry;
  return { label, order, section, group };
}

describe('NFR_PALETTE', () => {
  it('lists NFR kinds as context actions, React-free', () => {
    const { actions } = contextActionsFor(NFR_PALETTE, NFR);
    const labels = actions.map((action) => action.label);
    expect(labels).toEqual(
      expect.arrayContaining(['NFR', 'Operationalization', 'Claim', 'And', 'Or', 'Argument']),
    );
  });

  it('matches the live registry’s label, order and section for every NFR element kind', () => {
    const registry = nfrRegistry();
    for (const kind of NFR.elements.keys()) {
      const live = registry.elements[kind]?.palette;
      expect(live, kind).not.toBe(false);
      expect(corePart(live as PaletteEntryDescription), kind).toEqual(
        corePart(NFR_PALETTE.elements[kind] as PaletteEntryDescription),
      );
    }
  });

  it('matches the live registry’s label, order, section and group for every NFR link kind', () => {
    const registry = nfrRegistry();
    for (const kind of NFR.links.keys()) {
      const live = registry.links[kind]?.palette;
      const described = NFR_PALETTE.links[kind];
      if (described === false || live === false) {
        expect(live, kind).toBe(false);
        expect(described, kind).toBe(false);
        continue;
      }
      const liveEntries = live as readonly LinkToolEntry[];
      expect(liveEntries.map(corePart), kind).toEqual(described.map(corePart));
    }
  });
});
