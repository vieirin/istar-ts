import type { ElementKindOf, IstarModel, LinkKindOf } from '@istar-ts/core';
import {
  ISTAR_2_0,
  createModelStore,
  defineMetamodelExtension,
  extendMetamodel,
  parsePistar,
} from '@istar-ts/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { IstarExtension } from '../src';
import {
  IstarCanvas,
  LINE_DASHES,
  defaultRegistry,
  dependencyIcon,
  elementIcon,
  paletteSections,
  pathBounds,
  registryForMetamodel,
} from '../src';

const rationalAgents = defineMetamodelExtension({
  name: 'rationalAgents',
  elements: [
    { kind: 'rationalAgents.Planning', behavesLike: 'istar.Task', pistarType: 'istar.Planning' },
    { kind: 'rationalAgents.Plan', category: 'node', size: { width: 90, height: 40 } },
  ],
  links: [
    {
      kind: 'rationalAgents.GeneratesLink',
      label: 'Generates',
      rules: { sources: ['rationalAgents.Planning'], targets: ['rationalAgents.Plan'] },
    },
    {
      kind: 'rationalAgents.AlternativeLink',
      label: 'Alternative',
      behavesLike: 'istar.OrRefinementLink',
    },
  ],
});
const METAMODEL = extendMetamodel(ISTAR_2_0, rationalAgents);
type EK = ElementKindOf<typeof METAMODEL>;
type LK = LinkKindOf<typeof METAMODEL>;

const PLANNING_PATH = 'M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 L 20 20 Z';
const GENERATES_MARKER = 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0';

/** The presentation part of the extension: piStar-ext's "Shape" and "Kind of Line" fields. */
const presentation: IstarExtension<EK, LK> = {
  name: 'rationalAgents',
  elements: { 'rationalAgents.Planning': { shape: { path: PLANNING_PATH } } },
  links: {
    'rationalAgents.GeneratesLink': {
      line: { dash: LINE_DASHES.dotted, marker: GENERATES_MARKER, markerFilled: true },
    },
  },
};

const fixture = readFileSync(
  join(import.meta.dirname, '../../../fixtures/extensions/rationalAgents.txt'),
  'utf8',
);

describe('registryForMetamodel', () => {
  test('adds defaults for extended kinds after the built-in ones', () => {
    const registry = registryForMetamodel(METAMODEL);
    expect(registry.elements['rationalAgents.Plan']).toMatchObject({
      kind: 'rationalAgents.Plan',
      label: 'Plan',
      size: { width: 90, height: 40 },
      palette: { label: 'Plan', section: 'elements' },
    });
    const taskOrder = (defaultRegistry.elements['istar.Task'].palette as { order: number }).order;
    const planningOrder = (
      registry.elements['rationalAgents.Planning'].palette as { order: number }
    ).order;
    expect(planningOrder).toBeGreaterThan(taskOrder);
    expect(registry.links['rationalAgents.GeneratesLink'].palette).toEqual([
      expect.objectContaining({ label: 'Generates', section: 'elements' }),
    ]);
    // New node kinds that can be dependums join the dependency menu.
    const dependums = (
      registry.links['istar.DependencyLink'].palette as readonly { dependum?: string }[]
    ).map((e) => e.dependum);
    expect(dependums).toEqual([
      'istar.Goal',
      'istar.Quality',
      'istar.Resource',
      'istar.Task',
      'rationalAgents.Planning',
      'rationalAgents.Plan',
    ]);
    // The default registry is unchanged.
    expect(Object.keys(defaultRegistry.elements)).toHaveLength(7);
  });
});

function renderFixture() {
  const model = parsePistar(fixture, { metamodel: METAMODEL });
  expectTypeOf(model).toEqualTypeOf<IstarModel<EK, LK>>();
  const store = createModelStore(model);
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <IstarCanvas store={store} extensions={[presentation]} />
    </div>,
  );
  return { ...utils, store };
}

describe('IstarCanvas with an extended metamodel', () => {
  test('draws extended nodes with their shape, or as a «stereotyped» default node', () => {
    const { container } = renderFixture();
    const planning = container.querySelector('.react-flow__node[data-id="p1"]')!;
    expect(planning.querySelector(`.istar-shape path[d="${PLANNING_PATH}"]`)).toBeTruthy();
    expect(planning.querySelector('.istar-stereotype')).toBeNull();
    const plan = container.querySelector('.react-flow__node[data-id="x1"]')!;
    expect(plan.querySelector('.istar-stereotype')?.textContent).toBe('«Plan»');
    expect(plan.textContent).toContain('Delivery plan');
  });

  test('draws extended links with their line style, or like the kind they behave like', () => {
    const { container } = renderFixture();
    const generates = container.querySelector('.react-flow__edge[data-id="l2"]')!;
    expect(generates).toBeTruthy();
    expect((generates.querySelector('.istar-link-line') as SVGElement).style.strokeDasharray).toBe(
      '1,3',
    );
    const marker = generates.querySelector('.istar-link-marker')!;
    expect(marker.getAttribute('d')).toBe(GENERATES_MARKER);
    expect(marker.classList.contains('is-filled')).toBe(true);
    // Alternative behaves like an OR-refinement: its filled triangle.
    const alternative = container.querySelector(
      '.react-flow__edge[data-id="l3"] .istar-link-marker',
    )!;
    expect(alternative.getAttribute('d')).toBe('m 12,-6 l -12,6 12,6 z');
    // The Plan dependum's links are dependency halves, with the "D".
    expect(
      container.querySelector('.react-flow__edge[data-id="l4"] .istar-link-dependency'),
    ).toBeTruthy();
  });

  test('palette offers the new kinds and links', () => {
    renderFixture();
    expect(screen.getByRole('button', { name: 'Planning' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More: Dependency' }));
    expect(screen.getByRole('menuitemradio', { name: 'Plan dependency' })).toBeTruthy();
  });
});

describe('pathBounds', () => {
  test.each([
    ['M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 Z', { x: 0, y: 0, width: 100, height: 40 }],
    ['m 10 10 h 20 v 30 h -20 z', { x: 10, y: 10, width: 20, height: 30 }],
    // A circle of radius 10 around (10, 0), as two arcs.
    ['M 0 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0', { x: 0, y: -10, width: 20, height: 20 }],
  ])('%s', (d, expected) => {
    const b = pathBounds(d)!;
    expect(b.x).toBeCloseTo(expected.x, 1);
    expect(b.y).toBeCloseTo(expected.y, 1);
    expect(b.width).toBeCloseTo(expected.width, 1);
    expect(b.height).toBeCloseTo(expected.height, 1);
  });

  test('curves are bounded by the curve, not its control points', () => {
    const b = pathBounds('M 0 0 C 0 100 100 100 100 0')!;
    expect(b.height).toBeCloseTo(75, 0);
  });

  test('empty or malformed data has no bounds', () => {
    expect(pathBounds('')).toBeUndefined();
    expect(pathBounds('12 34')).toBeUndefined();
  });
});

describe('helpers stay safe as array callbacks', () => {
  test('elementIcon, dependencyIcon and paletteSections ignore the index', () => {
    const kinds = ['istar.Goal', 'istar.Task'] as const;
    expect(kinds.map(elementIcon)).toHaveLength(2);
    expect(kinds.map(dependencyIcon)).toHaveLength(2);
    const sections = [defaultRegistry].map(paletteSections);
    expect(sections[0]).toEqual(paletteSections(defaultRegistry));
    expectTypeOf(sections).toEqualTypeOf<ReturnType<typeof paletteSections>[]>();
  });
});
