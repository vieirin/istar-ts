import { describe, expect, expectTypeOf, test } from 'vitest';
import type { FileMetamodel, IstarModel } from '../src';
import {
  ISTAR_2_0,
  MetamodelError,
  PistarParseError,
  createModelStore,
  fileMetamodelOf,
  metamodelOf,
  parsePistar,
  toPistar,
  validateFileMetamodel,
  validateModel,
  withFileMetamodel,
} from '../src';
import { loadExtensionFixtures, loadFixtures } from './fixtures';
import { RATIONAL_AGENTS } from './rationalAgents';

const fixture = loadExtensionFixtures().find((f) => f.name === 'extensions/fileMetamodel.txt')!;
const blockOf = (text: string): FileMetamodel => JSON.parse(text).metamodel;

describe('reading a file’s own metamodel', () => {
  test('applied with fileMetamodel: true, and written back byte for byte', () => {
    const model = parsePistar(fixture.text, { fileMetamodel: true });
    expectTypeOf(model).toEqualTypeOf<IstarModel<string, string>>();
    const metamodel = metamodelOf(model);
    expect(metamodel.extensions).toEqual(['iStar4RationalAgents']);
    expect(metamodel.elements.get('ra4.Planning')).toMatchObject({
      behavesLike: 'istar.Task',
      pistarType: 'istar.Planning',
      shape: { path: 'M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 L 14 20 Z' },
    });
    expect(metamodel.links.get('ra4.GeneratesLink')?.line).toMatchObject({ dash: '1,3' });
    expect(model.elements.get('p1')?.kind).toBe('ra4.Planning');
    expect(validateModel(model)).toEqual([]);
    // Unknown keys in the block (groupers, an entry's stereotypes) are the host's: kept.
    expect(fileMetamodelOf(model)).toEqual(blockOf(fixture.text));
    expect(toPistar(model)).toBe(fixture.text);
  });

  test('by default the block is kept but not applied, as before', () => {
    expect(() => parsePistar(fixture.text)).toThrow(PistarParseError);
    expect(() => parsePistar(fixture.text)).toThrow(/unknown element type "istar\.Planning"/);
    const withoutKinds = JSON.parse(fixture.text);
    withoutKinds.actors[0].nodes = withoutKinds.actors[0].nodes.filter((n: { type: string }) =>
      ['istar.Goal', 'istar.Task'].includes(n.type),
    );
    withoutKinds.dependencies = [];
    withoutKinds.links = [];
    const model = parsePistar(withoutKinds);
    expect(fileMetamodelOf(model)).toBeUndefined();
    expect(metamodelOf(model)).toBe(ISTAR_2_0);
    expect(JSON.parse(toPistar(model)).metamodel).toEqual(withoutKinds.metamodel);
  });

  test('every other fixture reads and writes the same with the option', () => {
    for (const f of loadFixtures()) {
      const model = parsePistar(f.text, { fileMetamodel: true });
      expect(fileMetamodelOf(model)).toBeUndefined();
      expect(JSON.parse(toPistar(model))).toStrictEqual(JSON.parse(f.text));
    }
  });

  test('an empty block round-trips exactly', () => {
    const text = JSON.stringify(
      { actors: [], saveDate: 'Thu, 08 Oct 2026 12:00:00 GMT', metamodel: { name: 'nothing' } },
      null,
      2,
    );
    const model = parsePistar(text, { fileMetamodel: true });
    expect(fileMetamodelOf(model)).toEqual({ name: 'nothing' });
    expect(toPistar(model)).toBe(text);
  });
});

const withBlock = (block: unknown) => JSON.stringify({ actors: [], metamodel: block });

describe('collisions and malformed blocks', () => {
  test('file vs host extension: a pistarType both claim', () => {
    expect(() =>
      parsePistar(fixture.text, { fileMetamodel: true, metamodel: RATIONAL_AGENTS }),
    ).toThrow(/pistarType "istar\.Planning" of kind "ra4\.Planning" is already used/);
  });

  test('file vs base: the reserved istar. prefix, or a built-in type', () => {
    expect(() =>
      parsePistar(
        withBlock({ name: 'x', elements: [{ kind: 'istar.Belief', category: 'node' }] }),
        {
          fileMetamodel: true,
        },
      ),
    ).toThrow(/reserved "istar\." prefix/);
    expect(() =>
      parsePistar(
        withBlock({
          name: 'x',
          elements: [{ kind: 'x.Belief', category: 'node', pistarType: 'istar.Goal' }],
        }),
        { fileMetamodel: true },
      ),
    ).toThrow(MetamodelError);
  });

  test('a kind declared twice in the block', () => {
    expect(() =>
      parsePistar(
        withBlock({
          name: 'x',
          elements: [
            { kind: 'x.Belief', category: 'node' },
            { kind: 'x.Belief', category: 'node' },
          ],
        }),
        { fileMetamodel: true },
      ),
    ).toThrow(/kind "x\.Belief" already exists/);
  });

  test.each([
    [[], /metamodel must be an object/],
    [{ elements: [] }, /metamodel\.name must be a non-empty string/],
    [{ name: 'x', elements: {} }, /metamodel\.elements must be a list/],
    [
      { name: 'x', elements: [{ kind: 'x.A', category: 'node' }, { kind: 3 }] },
      /metamodel\.elements\[1\]\.kind must be a string/,
    ],
    [
      { name: 'x', elements: [{ kind: 'x.A', category: 'thing' }] },
      /elements\[0\]\.category must be "node" or "actor"/,
    ],
    [
      { name: 'x', elements: [{ kind: 'x.A', category: 'node', size: { width: 0, height: 4 } }] },
      /size\.width must be a positive number/,
    ],
    [
      { name: 'x', elements: [{ kind: 'x.A', category: 'node', shape: { path: '' } }] },
      /shape\.path must be SVG path data/,
    ],
    [
      { name: 'x', links: [{ kind: 'x.L', rules: { sources: [], targets: ['node'] } }] },
      /links\[0\]\.rules\.sources must be a non-empty list/,
    ],
    [
      {
        name: 'x',
        links: [{ kind: 'x.L', rules: { sources: ['node'], targets: ['node'], unique: 'yes' } }],
      },
      /rules\.unique must be "kind", "any" or false/,
    ],
    [
      { name: 'x', links: [{ kind: 'x.L', behavesLike: 'istar.OrRefinementLink', check: 'code' }] },
      /links\[0\]\.check cannot be stored in a file/,
    ],
  ])('rejects %j precisely', (block, error) => {
    expect(() => validateFileMetamodel(block)).toThrow(MetamodelError);
    expect(() => validateFileMetamodel(block)).toThrow(error);
  });
});

describe('withFileMetamodel: constructs added at run time', () => {
  const belief: FileMetamodel = {
    name: 'beliefs',
    elements: [
      { kind: 'beliefs.Belief', category: 'node', shape: { path: 'M 0 0 H 10 V 6 H 0 Z' } },
    ],
  };

  test('adds a construct, edits with it, and writes the block', () => {
    const base = parsePistar(
      '{"actors":[],"orphans":[],"dependencies":[],"links":[],"display":{}}',
    );
    const model = withFileMetamodel(base, belief);
    expect(metamodelOf(model).elements.has('beliefs.Belief')).toBe(true);
    const store = createModelStore(model);
    const actor = store.addElement({ kind: 'istar.Agent', x: 0, y: 0 });
    store.addElement({
      kind: 'beliefs.Belief',
      x: 10,
      y: 10,
      parent: actor.id,
      name: 'Lab is open',
    });
    const text = toPistar(store.getModel());
    expect(JSON.parse(text).metamodel).toEqual(belief);
    // …and the file reads back with its own construct.
    const again = parsePistar(text, { fileMetamodel: true });
    expect([...again.elements.values()].map((e) => e.kind)).toContain('beliefs.Belief');
    expect(toPistar(again)).toBe(text);
  });

  test('replaces the file’s constructs, keeping the host’s', () => {
    const model = parsePistar(fixture.text, { fileMetamodel: true });
    const block = blockOf(fixture.text);
    const more: FileMetamodel = {
      ...block,
      elements: [...(block.elements ?? []), ...(belief.elements ?? [])],
    };
    const next = withFileMetamodel(model, more);
    expect(metamodelOf(next).elements.has('beliefs.Belief')).toBe(true);
    expect(metamodelOf(next).extensions).toEqual(['iStar4RationalAgents']);
    expect(fileMetamodelOf(next)).toEqual(more);
    // The block keeps its place among the top-level keys.
    expect(Object.keys(JSON.parse(toPistar(next)))).toEqual(Object.keys(JSON.parse(fixture.text)));
  });

  test('never writes the host dialect’s kinds', () => {
    const host = parsePistar(
      loadExtensionFixtures().find((f) => f.name === 'extensions/rationalAgents.txt')!.text,
      { metamodel: RATIONAL_AGENTS },
    );
    const model = withFileMetamodel(host, belief);
    expect(metamodelOf(model).extensions).toEqual(['rationalAgents', 'beliefs']);
    expect(JSON.parse(toPistar(model)).metamodel).toEqual(belief);
    // Removing the block goes back to the host's metamodel.
    const back = withFileMetamodel(model, null);
    expect(metamodelOf(back)).toBe(RATIONAL_AGENTS);
    expect(JSON.parse(toPistar(back))).not.toHaveProperty('metamodel');
  });

  test('rejects collisions, and dropping a kind still in use', () => {
    const model = parsePistar(fixture.text, { fileMetamodel: true });
    expect(() =>
      withFileMetamodel(model, {
        name: 'ra',
        elements: [{ kind: 'istar.Goal', category: 'node' }],
      }),
    ).toThrow(MetamodelError);
    expect(() => withFileMetamodel(model, null)).toThrow(
      /uses kind "ra4\.Planning", which the new metamodel lacks/,
    );
  });
});
