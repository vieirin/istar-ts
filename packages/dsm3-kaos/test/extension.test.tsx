import type { IstarLink } from '@istar-ts/core';
import { parsePistar } from '@istar-ts/core';
import {
  IstarCanvas,
  applyExtensions,
  paletteSections,
  registryForMetamodel,
} from '@istar-ts/react';
import type { AnyIstarRegistry, LinkLabelProps } from '@istar-ts/react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConflictGlyph,
  KAOS_ASSIGNMENT_GLYPH,
  KAOS_CONFLICT_GLYPH,
  KAOS_ELEMENT_KINDS,
  KAOS_REFINEMENT_MARKER,
  KAOS_SHAPES,
  KAOS,
  KAOS_FILL,
  KAOS_OBSTACLES,
  KAOS_OBSTACLE_SHAPES,
  KAOS_OBSTRUCTION_MARKER,
  domainPropertyProperties,
  kaosExtension,
  obstacleProperties,
  resolutionProperties,
} from '../src';

function kaosRegistry(): AnyIstarRegistry {
  return applyExtensions<string, string>(registryForMetamodel(KAOS) as AnyIstarRegistry, [
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

describe('kaos-welcome.txt on the canvas', () => {
  it('draws DSM3’s shapes, the refinement circles and the midpoint glyphs', () => {
    const text = readFileSync(
      join(import.meta.dirname, '../../../fixtures/dsm3/kaos-welcome.txt'),
      'utf8',
    );
    const model = parsePistar(text, { metamodel: KAOS });
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas model={model} extensions={[kaosExtension]} />
      </div>,
    );
    // Behavioral goals and Softgoals share DSM3's parallelogram (Softgoals dashed).
    const goals = [...model.elements.values()].filter(
      (e) => e.kind === 'kaos.BehavioralGoal' || e.kind === 'kaos.Softgoal',
    );
    expect(goals.length).toBeGreaterThan(0);
    const goalPath = KAOS_SHAPES['kaos.BehavioralGoal'].path;
    expect(container.querySelectorAll(`.istar-shape path[d="${goalPath}"]`)).toHaveLength(
      goals.length,
    );
    const dashed = [...container.querySelectorAll<SVGPathElement>('.istar-shape path')].filter(
      (path) => path.style.strokeDasharray === '8,4',
    );
    expect(dashed).toHaveLength(
      [...model.elements.values()].filter((e) => e.kind === 'kaos.Softgoal').length,
    );
    // Every node in DSM3's grey (KindShape.fill): no element of the file saves a colour.
    const fills = new Set(
      [...container.querySelectorAll<SVGPathElement>('.istar-shape path')].map((path) =>
        path.getAttribute('fill'),
      ),
    );
    expect(fills).toEqual(new Set(['rgb(205,205,205)']));
    expect(container.querySelectorAll('.istar-hub circle')).toHaveLength(4);
    const glyphLinks = [...model.links.values()].filter(
      (l) => l.kind === 'kaos.Conflict' || l.kind === 'kaos.ResponsibilityAssignment',
    );
    expect(container.querySelectorAll('.kaos-link-glyph')).toHaveLength(glyphLinks.length);
    // No iStar palette: KAOS's own tools only.
    expect(screen.queryByRole('button', { name: 'Actor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Behavioral Goal' })).toBeTruthy();
  });
});

describe('KAOS palette icons', () => {
  it('show the Conflict and Assignment glyphs, as the canvas draws them', () => {
    const items = paletteSections(kaosRegistry() as never, KAOS as never)
      .flat()
      .flatMap((slot) => (slot.type === 'item' ? [slot.item] : slot.items));
    for (const [label, glyph] of [
      ['Conflict', KAOS_CONFLICT_GLYPH],
      ['Responsibility Assignment', KAOS_ASSIGNMENT_GLYPH],
    ] as const) {
      const entry = items.find((item) => item.entry.label === label)!.entry;
      const { container } = render(<>{entry.icon}</>);
      expect(container.querySelector('.istar-palette-glyph')?.getAttribute('d')).toBe(glyph);
    }
  });
});

describe('kaosExtension with the obstacle analysis', () => {
  const registry = (): AnyIstarRegistry =>
    applyExtensions<string, string>(registryForMetamodel(KAOS_OBSTACLES) as AnyIstarRegistry, [
      kaosExtension,
    ]);

  it('draws an obstacle as the mirrored parallelogram, in KAOS grey', () => {
    const obstacle = registry().elements['kaosObstacles.Obstacle'];
    expect(obstacle?.shape).toBe(KAOS_OBSTACLE_SHAPES['kaosObstacles.Obstacle']);
    expect(obstacle?.shape?.fill).toBe(KAOS_FILL);
    expect(obstacle?.palette).toMatchObject({ label: 'Obstacle' });
    expect(obstacle?.properties).toBe(obstacleProperties);
  });

  it('offers the three obstacle links, with their lines and the resolution’s keys', () => {
    const links = registry().links;
    expect(links['kaosObstacles.ObstructionLink']?.line?.marker).toBe(KAOS_OBSTRUCTION_MARKER);
    expect(links['kaosObstacles.ResolutionLink']?.properties).toBe(resolutionProperties);
    const labels = paletteSections(registry() as never, KAOS_OBSTACLES as never)
      .flat()
      .flatMap((slot) => (slot.type === 'item' ? [slot.item] : slot.items))
      .map((item) => item.entry.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Obstacle', 'Obstacle Refinement', 'Obstruction', 'Resolution']),
    );
  });

  it('adds nothing to plain KAOS', () => {
    const plain = kaosRegistry();
    expect(plain.elements['kaosObstacles.Obstacle']).toBeUndefined();
    expect(plain.links['kaosObstacles.ResolutionLink']).toBeUndefined();
    expect(plain.elements['kaos.DomainProperty']?.properties).toBe(domainPropertyProperties);
  });

  it('draws kaos-las.txt', () => {
    const text = readFileSync(
      join(import.meta.dirname, '../../../fixtures/dsm3/kaos-las.txt'),
      'utf8',
    );
    const model = parsePistar(text, { metamodel: KAOS_OBSTACLES });
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas model={model} extensions={[kaosExtension]} />
      </div>,
    );
    expect(container.querySelectorAll('.react-flow__node').length).toBe(model.elements.size);
  });
});
