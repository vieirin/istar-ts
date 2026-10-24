import { contextActionsFor } from '@istar-ts/actions';
import type {
  AnyMetamodel,
  LinkToolEntryDescription,
  Metamodel,
  PaletteEntryDescription,
} from '@istar-ts/core';
import type { AnyIstarRegistry, ElementToolEntry, LinkToolEntry } from '@istar-ts/react';
import { applyExtensions, registryForMetamodel } from '@istar-ts/react';
import { describe, expect, it } from 'vitest';
import { KAOS, KAOS_OBSTACLES, KAOS_OBSTACLES_PALETTE, KAOS_PALETTE, kaosExtension } from '../src';

function registryFor(metamodel: AnyMetamodel): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(metamodel) as AnyIstarRegistry, [
    kaosExtension,
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

/** `description`'s and the live registry's palette entries, boiled down to their core fields. */
function corePalettes(
  metamodel: Metamodel<string, string>,
  description: Pick<typeof KAOS_PALETTE, 'elements' | 'links'>,
): readonly [CorePalette, CorePalette] {
  const registry = registryFor(metamodel);
  const elements = description.elements as Readonly<
    Record<string, PaletteEntryDescription | false>
  >;
  const links = description.links as Readonly<
    Record<string, readonly LinkToolEntryDescription[] | false>
  >;
  const live: Record<string, unknown> = {};
  const described: Record<string, unknown> = {};
  for (const kind of metamodel.elements.keys()) {
    const entry = registry.elements[kind]?.palette as ElementToolEntry | false;
    const given = elements[kind]!;
    live[kind] = { elements: entry === false ? false : corePart(entry) };
    described[kind] = { elements: given === false ? false : corePart(given) };
  }
  for (const kind of metamodel.links.keys()) {
    const entries = registry.links[kind]?.palette as readonly LinkToolEntry[] | false;
    const given = links[kind]!;
    live[kind] = { links: entries === false ? false : entries.map(corePart) };
    described[kind] = { links: given === false ? false : given.map(corePart) };
  }
  return [live as CorePalette, described as CorePalette];
}

describe('KAOS_PALETTE', () => {
  it('lists KAOS kinds as context actions, React-free', () => {
    const { actions } = contextActionsFor(KAOS_PALETTE, KAOS);
    const labels = actions.map((action) => action.label);
    expect(labels).toEqual([
      'Behavioral Goal',
      'Softgoal',
      'Agent',
      'Environment Agent',
      'Domain Property',
      'Refinement',
      'Responsibility Assignment',
      'Conflict',
    ]);
    // The hub, leg and end kinds core generates for the n-ary refinement are never offered.
    for (const action of actions) {
      expect(action.label).not.toMatch(/Hub|Start|End/);
    }
  });

  it('matches the live registry’s label, order, section and group for every KAOS kind', () => {
    const [live, described] = corePalettes(
      KAOS as unknown as Metamodel<string, string>,
      KAOS_PALETTE,
    );
    expect(live).toEqual(described);
  });

  it('matches the live registry’s label, order, section and group for every KAOS_OBSTACLES kind', () => {
    const [live, described] = corePalettes(
      KAOS_OBSTACLES as unknown as Metamodel<string, string>,
      KAOS_OBSTACLES_PALETTE,
    );
    expect(live).toEqual(described);
  });
});
