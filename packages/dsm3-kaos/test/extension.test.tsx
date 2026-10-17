import { ISTAR_2_0, extendMetamodel } from '@istar-ts/core';
import type { IstarLink } from '@istar-ts/core';
import { applyExtensions, registryForMetamodel } from '@istar-ts/react';
import type { AnyIstarRegistry, LinkLabelProps } from '@istar-ts/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ConflictGlyph,
  KAOS_CONFLICT_GLYPH,
  KAOS_ELEMENT_KINDS,
  KAOS_LINK_KINDS,
  KAOS_REFINEMENT_MARKER,
  KAOS_SHAPES,
  kaosExtension,
} from '../src';

// Until core can declare the KAOS root, an extension of iStar 2.0 with the same kind names
// stands in for it: the registry parts only look at kind names.
const standIn = extendMetamodel(ISTAR_2_0, {
  name: 'kaos-stand-in',
  elements: KAOS_ELEMENT_KINDS.map((kind) => ({ kind, category: 'node' as const })),
  links: KAOS_LINK_KINDS.map((kind) => ({ kind, rules: { sources: ['node'], targets: ['node'] } })),
});

function kaosRegistry(): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(standIn) as AnyIstarRegistry, [
    kaosExtension,
  ]);
}

describe('kaosExtension', () => {
  it('draws every KAOS node with its DSM3 shape and names it as DSM3’s toolbar does', () => {
    const registry = kaosRegistry();
    for (const kind of KAOS_ELEMENT_KINDS) {
      expect(registry.elements[kind]?.shape).toBe(KAOS_SHAPES[kind]);
    }
    const palette = registry.elements['kaos.EnvironmentAgent']?.palette;
    expect(palette).toMatchObject({ label: 'Environment Agent' });
  });

  it('ends a refinement with a filled triangle and draws glyphs instead of markers', () => {
    const registry = kaosRegistry();
    expect(registry.links['kaos.RefinementLink']?.line).toEqual({
      marker: KAOS_REFINEMENT_MARKER,
      markerFilled: true,
    });
    expect(registry.links['kaos.Conflict']?.line?.marker).toBe(false);
    expect(registry.links['kaos.Conflict']?.labelComponent).toBe(ConflictGlyph);
    expect(registry.links['kaos.ResponsibilityAssignment']?.line?.marker).toBe(false);
  });

  it('gives goals and conflicts their DSM3 properties', () => {
    const registry = kaosRegistry();
    expect(registry.elements['kaos.Softgoal']?.properties?.defaults()).toMatchObject({
      Type: 'softgoal',
    });
    expect(registry.links['kaos.Conflict']?.properties?.kind).toBe('kaos.Conflict');
  });

  it('draws the conflict glyph centred on the link’s middle', () => {
    const props = {
      link: { id: 'c', kind: 'kaos.Conflict', source: 'a', target: 'b' } as IstarLink<string>,
      labels: { name: 'boundary' },
      selected: false,
    } as unknown as LinkLabelProps;
    const { container } = render(<ConflictGlyph {...props} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('-16 -16 32 32');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(KAOS_CONFLICT_GLYPH);
    expect(container.textContent).toBe('boundary');
  });
});
