import { describe, expect, test } from 'vitest';
import { IstarDiagramConfiguration, ISTAR_GLSP, LINK_ANCHOR_TYPE, gmodelTypes } from '../src';
import type { IstarGlspContribution } from '../src';
import { KAOS_GLSP, KAOS_OBSTACLES_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';
import { GEdge, GNode, ServerLayoutKind } from '@eclipse-glsp/server';

const contributions: Array<[string, IstarGlspContribution]> = [
  ['istar', ISTAR_GLSP],
  ['kaos', KAOS_GLSP],
  ['kaos-obstacles', KAOS_OBSTACLES_GLSP],
  ['nfr', NFR_GLSP],
];

describe.each(contributions)('%s', (_, contribution) => {
  const config = new IstarDiagramConfiguration(contribution);
  const types = gmodelTypes(contribution.metamodel, contribution.types);

  test('every type string in the hints is a type the GModel factory can emit', () => {
    const hinted = [
      ...config.shapeTypeHints.flatMap((h) => [
        h.elementTypeId,
        ...(h.containableElementTypeIds ?? []),
      ]),
      ...config.edgeTypeHints.flatMap((h) => [
        h.elementTypeId,
        ...(h.sourceElementTypeIds ?? []),
        ...(h.targetElementTypeIds ?? []),
      ]),
    ];
    expect(hinted.length).toBeGreaterThan(0);
    for (const type of hinted) expect(types.all).toContain(type);
  });

  test('one shape hint per element kind, one edge hint per link kind', () => {
    const { metamodel } = contribution;
    expect(config.shapeTypeHints.map((h) => h.elementTypeId)).toEqual(
      [...metamodel.elements.keys()].map((k) => types.of(k)),
    );
    expect(config.edgeTypeHints.map((h) => h.elementTypeId)).toEqual(
      [...metamodel.links.keys()].map((k) => types.of(k)),
    );
  });

  test('every type maps to a GModel class; layout lives in the model', () => {
    for (const kind of contribution.metamodel.elements.keys()) {
      expect(config.typeMapping.get(types.of(kind)!)).toBe(GNode);
    }
    for (const kind of contribution.metamodel.links.keys()) {
      expect(config.typeMapping.get(types.of(kind)!)).toBe(GEdge);
    }
    expect(config.typeMapping.get(LINK_ANCHOR_TYPE)).toBe(GNode);
    expect(config.needsClientLayout).toBe(false);
    expect(config.layoutKind).toBe(ServerLayoutKind.NONE);
  });
});

test('iStar 2.0: actors contain the inner node kinds; dependencies run between any elements', () => {
  const config = new IstarDiagramConfiguration(ISTAR_GLSP);
  const actor = config.shapeTypeHints.find((h) => h.elementTypeId === 'node:istar.Actor')!;
  expect(actor.containableElementTypeIds).toEqual([
    'node:istar.Goal',
    'node:istar.Quality',
    'node:istar.Resource',
    'node:istar.Task',
  ]);
  const isA = config.edgeTypeHints.find((h) => h.elementTypeId === 'edge:istar.IsALink')!;
  expect(isA.sourceElementTypeIds).toEqual([
    'node:istar.Actor',
    'node:istar.Agent',
    'node:istar.Role',
  ]);
});

test('NFR: an edge that targets links targets the link anchor', () => {
  const config = new IstarDiagramConfiguration(NFR_GLSP);
  const argument = config.edgeTypeHints.find((h) => h.elementTypeId === 'edge:nfr.ArgumentLink')!;
  expect(argument.targetElementTypeIds).toEqual([LINK_ANCHOR_TYPE]);
});

test('overrides rename types in the hints too', () => {
  const config = new IstarDiagramConfiguration({
    ...ISTAR_GLSP,
    types: { 'istar.Goal': 'node:goal' },
  });
  const actor = config.shapeTypeHints.find((h) => h.elementTypeId === 'node:istar.Actor')!;
  expect(actor.containableElementTypeIds).toContain('node:goal');
  expect(config.typeMapping.get('node:goal')).toBe(GNode);
});
