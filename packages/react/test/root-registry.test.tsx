// Registries for roots other than iStar 2.0, with core's inline DSM3-goals roots (the full
// languages ship as @istar-ts/dsm3-kaos and @istar-ts/dsm3-nfr).
import { parsePistar } from '@istar-ts/core';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { KAOS, NFR, NFR_CONTRIBUTION_LABELS } from '../../core/test/dsm3-roots';
import type { AnyIstarRegistry, LinkToolEntry } from '../src';
import {
  HubComponent,
  HubInspector,
  IstarCanvas,
  OPEN_ARROW,
  defaultRegistry,
  modelToFlow,
  registryForMetamodel,
  resolveLinkStyle,
} from '../src';

const dsm3 = (name: string): string =>
  readFileSync(join(import.meta.dirname, '../../../fixtures/dsm3', name), 'utf8');

const kaos = (): AnyIstarRegistry => registryForMetamodel(KAOS) as unknown as AnyIstarRegistry;
const nfr = (): AnyIstarRegistry => registryForMetamodel(NFR) as unknown as AnyIstarRegistry;

describe('registryForMetamodel with a root of its own', () => {
  test('keeps only the root’s kinds: no iStar 2.0 kinds in a KAOS registry', () => {
    const registry = kaos();
    expect(Object.keys(registry.elements)).toEqual([...KAOS.elements.keys()]);
    expect(Object.keys(registry.links)).toEqual([...KAOS.links.keys()]);
    expect(Object.keys(registry.elements).some((k) => k.startsWith('istar.'))).toBe(false);
  });

  test('draws a hub as a circle, inspects it as its link, and keeps it off the palette', () => {
    const hub = kaos().elements['kaos.RefinementLinkHub']!;
    expect(hub).toMatchObject({
      label: 'Refinement',
      component: HubComponent,
      inspector: HubInspector,
      resizable: false,
      stereotype: false,
      palette: false,
    });
  });

  test('legs and ends have no tool of their own; the base n-ary kind keeps one', () => {
    const registry = kaos();
    expect(registry.links['kaos.RefinementLinkStart']!.palette).toBe(false);
    expect(registry.links['kaos.RefinementLinkEnd']!.palette).toBe(false);
    expect(registry.links['kaos.RefinementLink']!.palette).toHaveLength(1);
  });

  test('legs draw without a marker; the end draws like its link', () => {
    const registry = createLined();
    expect(resolveLinkStyle(KAOS, registry, 'kaos.RefinementLinkStart').marker).toBeUndefined();
    expect(resolveLinkStyle(KAOS, registry, 'kaos.RefinementLinkEnd')).toEqual(
      resolveLinkStyle(KAOS, registry, 'kaos.RefinementLink'),
    );
    expect(resolveLinkStyle(KAOS, registry, 'kaos.RefinementLinkEnd').marker).toEqual({
      d: 'm 12,-6 l -12,6 12,6 z',
      filled: true,
    });
  });

  test('a kind with changeable labels gets one palette entry per label, in a group', () => {
    const registry = nfr();
    for (const kind of ['nfr.ContributionLink', 'nfr.CorrelationLink']) {
      const palette = registry.links[kind]!.palette as readonly LinkToolEntry<string>[];
      expect(palette.map((entry) => entry.value)).toEqual(NFR_CONTRIBUTION_LABELS);
      expect(new Set(palette.map((entry) => entry.group))).toEqual(new Set([kind]));
      expect(registry.paletteGroups[kind]?.label).toBe(registry.links[kind]!.label);
    }
    // Links that target links still get an open arrow by default.
    expect(resolveLinkStyle(NFR, registry, 'nfr.ArgumentLink').marker).toEqual({
      d: OPEN_ARROW,
      filled: false,
    });
  });

  test('iStar 2.0 completes to the default registry, unchanged', () => {
    expect(Object.keys(defaultRegistry.elements)).toHaveLength(7);
  });
});

describe('IstarCanvas with a root of its own', () => {
  test('offers the root’s palette, not iStar 2.0’s, and draws the hubs of the file', () => {
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas model={parsePistar(dsm3('kaos-welcome.txt'), { metamodel: KAOS })} />
      </div>,
    );
    expect(screen.queryByRole('button', { name: 'Actor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'BehavioralGoal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refinement' })).toBeTruthy();
    expect(container.querySelectorAll('.istar-hub circle')).toHaveLength(4);
  });
});

/** The KAOS registry with the refinement's DSM3 marker, as the KAOS package sets it. */
function createLined(): AnyIstarRegistry {
  const registry = kaos();
  return {
    ...registry,
    links: {
      ...registry.links,
      'kaos.RefinementLink': {
        ...registry.links['kaos.RefinementLink']!,
        line: { marker: 'm 12,-6 l -12,6 12,6 z', markerFilled: true },
      },
    },
  };
}

describe('modelToFlow with hubs', () => {
  test('draws each refinement as a hub node, legs into it and one end out of it', () => {
    const model = parsePistar(dsm3('kaos-welcome.txt'), { metamodel: KAOS });
    const { nodes, edges } = modelToFlow(model as never, kaos() as never);
    const hubs = nodes.filter((n) => model.elements.get(n.id)?.kind === 'kaos.RefinementLinkHub');
    expect(hubs).toHaveLength(4);
    for (const hub of hubs) expect([hub.width, hub.height]).toEqual([20, 20]);
    const hubIds = new Set(hubs.map((h) => h.id));
    const kindOf = (id: string) => model.links.get(id)?.kind;
    const legs = edges.filter((e) => kindOf(e.id) === 'kaos.RefinementLinkStart');
    const ends = edges.filter((e) => kindOf(e.id) === 'kaos.RefinementLinkEnd');
    expect(legs).toHaveLength(5);
    expect(ends).toHaveLength(4);
    expect(legs.every((e) => hubIds.has(e.target))).toBe(true);
    expect(ends.every((e) => hubIds.has(e.source))).toBe(true);
    expect(new Set(ends.map((e) => e.source))).toEqual(hubIds);
  });
});
