/**
 * #108: `typeHintsFor`'s edge hints say `repositionable: true` (a client reads that as "ends can
 * be reconnected", same as `@istar-ts/glsp`'s #107), and an n-ary kind's hint targets its hub too
 * (`createEdge` onto a hub adds a leg to that link).
 */
import { describe, expect, test } from 'vitest';
import { ISTAR_2_0, extendMetamodel, metamodelOf, parsePistar } from '@istar-ts/core';
import { typeHintsFor } from '../src';
import { loadFixtures } from './fixtures';

const fixtures = loadFixtures();

describe('typeHintsFor edge hints', () => {
  test('are repositionable, unlike shape hints', () => {
    const { edgeHints } = typeHintsFor(ISTAR_2_0);
    expect(edgeHints.length).toBeGreaterThan(0);
    for (const hint of edgeHints) expect(hint.repositionable).toBe(true);
  });

  test("an n-ary kind's hint targets its hub", () => {
    const metamodel = extendMetamodel(ISTAR_2_0, {
      name: 'x',
      links: [
        {
          kind: 'x.Joint',
          arity: 'n',
          rules: { sources: ['istar.Goal'], targets: ['istar.Goal'] },
        },
      ],
    });
    const { edgeHints } = typeHintsFor(metamodel);
    const hint = edgeHints.find((h) => h.elementTypeId === 'x.Joint')!;
    const hub = metamodel.links.get('x.Joint')?.parts?.hub;
    expect(hub).toBeDefined();
    expect(hint.targetElementTypeIds).toContain(hub);
  });
});

// Every link in every fixture must pass its kind's hint: a client that checks hints itself
// before sending `createEdge` (as #107's `gmodelTypeHints` does) must never refuse a link the
// model already holds.
describe('edge hints admit every link of every fixture', () => {
  test.each(fixtures.map((f) => [f.name, f] as const))('%s', (_, f) => {
    const model = parsePistar(f.text);
    const metamodel = metamodelOf(model);
    const { edgeHints } = typeHintsFor(metamodel);
    const hints = new Map(edgeHints.map((h) => [h.elementTypeId, h]));
    for (const link of model.links.values()) {
      const hint = hints.get(link.kind)!;
      const source = model.elements.get(link.source)!;
      const targetElement = model.elements.get(link.target);
      const target = targetElement ? targetElement.kind : model.links.get(link.target)!.kind;
      expect(hint.sourceElementTypeIds, `${link.kind} from ${source.kind}`).toContain(source.kind);
      expect(hint.targetElementTypeIds, `${link.kind} to ${target}`).toContain(target);
    }
  });
});
