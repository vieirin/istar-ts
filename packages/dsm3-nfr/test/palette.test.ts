import { contextActionsFor } from '@istar-ts/actions';
import type { LinkToolEntryDescription, Metamodel, PaletteEntryDescription } from '@istar-ts/core';
import type { AnyIstarRegistry, LinkToolEntry } from '@istar-ts/react';
import { applyExtensions, registryForMetamodel } from '@istar-ts/react';
import { describe, expect, it } from 'vitest';
import { NFR, NFR_PALETTE, nfrExtension } from '../src';

function nfrRegistry(): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(NFR) as AnyIstarRegistry, [
    nfrExtension,
  ]);
}

/** The core-relevant fields of a palette entry, for comparing a description with the live registry. */
function corePart(
  entry: PaletteEntryDescription | LinkToolEntryDescription,
): Pick<PaletteEntryDescription, 'label' | 'order' | 'section' | 'group'> {
  const { label, order, section, group } = entry;
  return { label, order, section, group };
}

type CorePalette = Readonly<
  Record<
    string,
    | { readonly elements: ReturnType<typeof corePart> | false }
    | { readonly links: readonly ReturnType<typeof corePart>[] | false }
  >
>;

/** `NFR_PALETTE`'s and the live registry's palette entries, boiled down to their core fields. */
function corePalettes(metamodel: Metamodel<string, string>): readonly [CorePalette, CorePalette] {
  const registry = nfrRegistry();
  const elements = NFR_PALETTE.elements as Readonly<Record<string, PaletteEntryDescription>>;
  const links = NFR_PALETTE.links as Readonly<Record<string, readonly LinkToolEntryDescription[]>>;
  const live: Record<string, unknown> = {};
  const described: Record<string, unknown> = {};
  for (const kind of metamodel.elements.keys()) {
    const entry = registry.elements[kind]?.palette as PaletteEntryDescription | false;
    live[kind] = { elements: entry === false ? false : corePart(entry) };
    described[kind] = { elements: corePart(elements[kind]!) };
  }
  for (const kind of metamodel.links.keys()) {
    const entries = registry.links[kind]?.palette as readonly LinkToolEntry[] | false;
    live[kind] = { links: entries === false ? false : entries.map(corePart) };
    described[kind] = { links: links[kind]!.map(corePart) };
  }
  return [live as CorePalette, described as CorePalette];
}

describe('NFR_PALETTE', () => {
  it('lists NFR kinds as context actions, React-free', () => {
    const { actions } = contextActionsFor(NFR_PALETTE, NFR);
    const labels = actions.map((action) => action.label);
    expect(labels).toEqual(
      expect.arrayContaining(['NFR', 'Operationalization', 'Claim', 'And', 'Or', 'Argument']),
    );
  });

  it('matches the live registry’s label, order, section and group for every NFR kind', () => {
    const [live, described] = corePalettes(NFR as unknown as Metamodel<string, string>);
    expect(live).toEqual(described);
  });
});
