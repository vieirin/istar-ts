import { createEmptyModel, extendMetamodel, toPistar } from '@istar-ts/core';
import { describe, expect, it } from 'vitest';
import { DSM3_FILE_KEYS, KAOS, KAOS_ELEMENT_KINDS, KAOS_LINK_KINDS } from '../src';

describe('KAOS', () => {
  it('is a root metamodel of its own, under the kaos prefix', () => {
    expect(KAOS.framework).toBe('kaos');
    expect(KAOS.prefix).toBe('kaos');
    expect([...KAOS.elements.keys()]).toEqual([...KAOS_ELEMENT_KINDS]);
    expect([...KAOS.links.keys()]).toEqual([...KAOS_LINK_KINDS]);
  });

  it('puts every node on the paper, at DSM3’s size', () => {
    for (const definition of KAOS.elements.values()) {
      expect(definition.category).toBe('node');
      expect(definition.info).toEqual({
        canBeInnerElement: false,
        canBeDependum: false,
        canBeOnPaper: true,
      });
      expect(definition.size).toEqual({ width: 135, height: 36 });
    }
  });

  it('writes new models as DSM3-goals does: its tool, metamodelVersion, no istar, DSM3’s key order', () => {
    const file = JSON.parse(toPistar(createEmptyModel(undefined, { metamodel: KAOS })));
    expect(file.tool).toBe('dsm3-goals');
    expect(file.metamodelVersion).toBe('1.0');
    expect(file).not.toHaveProperty('istar');
    const keys = Object.keys(file);
    expect(keys).toEqual(DSM3_FILE_KEYS.filter((key) => keys.includes(key)));
  });

  it('reserves its namespace: an extension may not add kaos kinds', () => {
    expect(() =>
      extendMetamodel(KAOS, { name: 'x', elements: [{ kind: 'kaos.Obstacle', category: 'node' }] }),
    ).toThrow('uses the reserved "kaos." prefix');
    expect(
      extendMetamodel(KAOS, {
        name: 'x',
        elements: [{ kind: 'x.Obstacle', category: 'node' }],
      }).elements.has('x.Obstacle'),
    ).toBe(true);
  });
});
