import { contextActionsFor } from '@istar-ts/actions';
import type {
  AnyMetamodel,
  LinkToolEntryDescription,
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

/** The core-relevant fields of a live registry's palette entry, for comparison with a description. */
function corePart(
  entry: PaletteEntryDescription | LinkToolEntryDescription,
): Pick<PaletteEntryDescription, 'label' | 'order' | 'section' | 'group'> {
  const { label, order, section, group } = entry;
  return { label, order, section, group };
}

/**
 * `KAOS_PALETTE`/`KAOS_OBSTACLES_PALETTE` must describe the same palette react's live registry
 * builds (`registryForMetamodel` + `kaosExtension`), so a headless host sees what the canvas
 * does. Icon and title are react presentation and aren't compared.
 */
function expectElementsMatch(
  description: Readonly<
    Record<string, PaletteEntryDescription | readonly PaletteEntryDescription[] | false>
  >,
  registry: AnyIstarRegistry,
  kinds: readonly string[],
): void {
  for (const kind of kinds) {
    const described = description[kind];
    const live = registry.elements[kind]?.palette;
    if (described === false || live === false) {
      expect(live, kind).toBe(false);
      expect(described, kind).toBe(false);
      continue;
    }
    expect(corePart(live as ElementToolEntry), kind).toEqual(
      corePart(described as PaletteEntryDescription),
    );
  }
}

function expectLinksMatch(
  description: Record<string, readonly LinkToolEntryDescription[] | false>,
  registry: AnyIstarRegistry,
  kinds: readonly string[],
): void {
  for (const kind of kinds) {
    const described = description[kind];
    const live = registry.links[kind]?.palette;
    if (described === false || live === false) {
      expect(live, kind).toBe(false);
      expect(described, kind).toBe(false);
      continue;
    }
    const liveEntries = live as readonly LinkToolEntry[];
    expect(liveEntries.map(corePart), kind).toEqual((described ?? []).map(corePart));
  }
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
    const registry = registryFor(KAOS);
    expectElementsMatch(KAOS_PALETTE.elements, registry, [...KAOS.elements.keys()]);
    expectLinksMatch(KAOS_PALETTE.links, registry, [...KAOS.links.keys()]);
  });

  it('matches the live registry’s label, order, section and group for every KAOS_OBSTACLES kind', () => {
    const registry = registryFor(KAOS_OBSTACLES);
    expectElementsMatch(KAOS_OBSTACLES_PALETTE.elements, registry, [
      ...KAOS_OBSTACLES.elements.keys(),
    ]);
    expectLinksMatch(KAOS_OBSTACLES_PALETTE.links, registry, [...KAOS_OBSTACLES.links.keys()]);
  });
});
