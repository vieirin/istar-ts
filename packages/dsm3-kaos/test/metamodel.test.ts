import { createEmptyModel, extendMetamodel, toPistar } from '@istar-ts/core';
import { describe, expect, it } from 'vitest';
import { DSM3_FILE_KEYS, KAOS, KAOS_ELEMENT_KINDS } from '../src';

describe('KAOS', () => {
  it('is a root metamodel of its own, under the kaos prefix', () => {
    expect(KAOS.framework).toBe('kaos');
    expect(KAOS.prefix).toBe('kaos');
    expect([...KAOS.elements.keys()]).toEqual([...KAOS_ELEMENT_KINDS, 'kaos.RefinementLinkHub']);
    expect([...KAOS.links.keys()]).toEqual([
      'kaos.RefinementLink',
      'kaos.RefinementLinkStart',
      'kaos.RefinementLinkEnd',
      'kaos.ResponsibilityAssignment',
      'kaos.Conflict',
    ]);
  });

  it('generates the refinement’s hub, leg and end kinds with DSM3’s file types', () => {
    const base = KAOS.links.get('kaos.RefinementLink')!;
    expect(base.arity).toBe('n');
    expect(base.parts).toEqual({
      hub: 'kaos.RefinementLinkHub',
      leg: 'kaos.RefinementLinkStart',
      end: 'kaos.RefinementLinkEnd',
    });
    const hub = KAOS.elements.get('kaos.RefinementLinkHub')!;
    expect(hub).toMatchObject({
      role: 'hub',
      of: 'kaos.RefinementLink',
      size: { width: 20, height: 20 },
    });
    expect(hub.pistarType).toBe('kaos.RefinementLinkHub');
    expect(KAOS.links.get('kaos.RefinementLinkStart')).toMatchObject({ role: 'leg' });
    expect(KAOS.links.get('kaos.RefinementLinkEnd')).toMatchObject({ role: 'end' });
  });

  it('puts every node on the paper, at DSM3’s size', () => {
    for (const definition of KAOS.elements.values()) {
      if (definition.role === 'hub') continue;
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
