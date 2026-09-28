import { describe, expect, test } from 'vitest';
import {
  PistarParseError,
  childrenOf,
  createEmptyModel,
  parsePistar,
  toPistar,
  toPistarObject,
  validateModel,
} from '../src';
import { loadFixtures } from './fixtures';

const fixtures = loadFixtures();

describe('fixture round trip', () => {
  test('fixtures are present', () => {
    expect(fixtures.length).toBeGreaterThan(50);
  });

  test.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const out = toPistar(parsePistar(fixture.text));
    expect(JSON.parse(out)).toStrictEqual(JSON.parse(fixture.text));
  });

  // Files saved by the piStar tool itself are exactly JSON.stringify(_, null, 2); for those we
  // reproduce the bytes, not just the structure.
  const canonical = fixtures.filter((f) => JSON.stringify(JSON.parse(f.text), null, 2) === f.text);
  test('most fixtures were saved by piStar', () => {
    expect(canonical.length).toBeGreaterThan(40);
  });
  test.each(canonical.map((f) => [f.name, f] as const))('byte-identical: %s', (_name, f) => {
    expect(toPistar(parsePistar(f.text))).toBe(f.text);
  });

  test.each(fixtures.map((f) => [f.name, f] as const))(
    'custom properties stay strings: %s',
    (_name, fixture) => {
      const model = parsePistar(fixture.text);
      for (const owner of [...model.elements.values(), ...model.links.values()]) {
        for (const value of Object.values(owner.customProperties ?? {})) {
          expect(typeof value).toBe('string');
        }
      }
    },
  );
});

describe('parsePistar', () => {
  const sample = {
    actors: [
      {
        id: 'a1',
        text: 'Robot',
        type: 'istar.Actor',
        x: 10,
        y: 20,
        customProperties: { Description: '' },
        nodes: [
          {
            id: 'g1',
            text: 'G1: Collect',
            type: 'istar.Goal',
            x: 50,
            y: 60,
            customProperties: { maintain: 'false', PreCond: 'battery > 10' },
            futureKey: { nested: [1, 2] },
          },
          { id: 't1', text: 'T1', type: 'istar.Task', x: 0, y: 0 },
        ],
      },
      { id: 'a2', text: 'Operator', type: 'istar.Role', x: 400, y: 20, nodes: [] },
    ],
    orphans: [],
    dependencies: [
      {
        id: 'd1',
        text: 'Sample',
        type: 'istar.Resource',
        x: 200,
        y: 30,
        source: 'a1',
        target: 'a2',
      },
    ],
    links: [
      { id: 'l1', type: 'istar.AndRefinementLink', source: 't1', target: 'g1' },
      { id: 'l2', type: 'istar.DependencyLink', source: 'a1', target: 'd1' },
      { id: 'l3', type: 'istar.DependencyLink', source: 'd1', target: 'a2' },
    ],
    display: {
      g1: { backgroundColor: '#FAE573', width: 120 },
      l1: { vertices: [{ x: 1, y: 2 }] },
      gone: { backgroundColor: 'red' },
    },
    tool: 'pistar.2.1.0',
    istar: '2.0',
    saveDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
    diagram: { width: 1000, height: 800, name: 'Demo', customProperties: { Description: 'x' } },
    somethingNew: true,
  };

  test('builds a typed model', () => {
    const model = parsePistar(sample);
    const g1 = model.elements.get('g1')!;
    expect(g1).toMatchObject({
      kind: 'istar.Goal',
      name: 'G1: Collect',
      parent: 'a1',
      customProperties: { maintain: 'false', PreCond: 'battery > 10' },
      display: { backgroundColor: '#FAE573', width: 120 },
      extra: { futureKey: { nested: [1, 2] } },
    });
    expect(model.elements.get('t1')).toMatchObject({ x: 0, y: 0 });
    expect(model.elements.get('d1')).toMatchObject({ isDependum: true });
    expect(childrenOf(model, 'a1').map((e) => e.id)).toEqual(['g1', 't1']);
    expect(model.links.get('l1')?.display).toEqual({ vertices: [{ x: 1, y: 2 }] });
    expect(model.extraDisplay).toEqual({ gone: { backgroundColor: 'red' } });
    expect(model.extra).toEqual({ somethingNew: true });
    expect(model.diagram?.name).toBe('Demo');
    expect(validateModel(model)).toEqual([]);
  });

  test('round-trips unknown keys at every level', () => {
    expect(toPistarObject(parsePistar(sample))).toStrictEqual(sample);
  });

  test('does not mutate object input', () => {
    const copy = structuredClone(sample);
    parsePistar(copy);
    expect(copy).toStrictEqual(sample);
  });

  test('rejects malformed input with PistarParseError', () => {
    expect(() => parsePistar('{nope')).toThrow(PistarParseError);
    expect(() => parsePistar('[]')).toThrow(/JSON object/);
    expect(() =>
      parsePistar({ ...sample, orphans: [{ id: 'x', type: 'istar.Softgoal', x: 1, y: 1 }] }),
    ).toThrow(/unknown element type "istar.Softgoal"/);
    expect(() =>
      parsePistar({
        ...sample,
        links: [{ id: 'l', type: 'istar.Whatever', source: 'a1', target: 'a2' }],
      }),
    ).toThrow(/unknown link type/);
    expect(() =>
      parsePistar({ ...sample, orphans: [{ id: 'g1', type: 'istar.Goal', x: 1, y: 1 }] }),
    ).toThrow(/duplicated id "g1"/);
  });
});

describe('toPistar', () => {
  test('an empty model looks like a fresh piStar save', () => {
    const json = toPistarObject(createEmptyModel(), { saveDate: new Date(Date.UTC(2024, 0, 1)) });
    expect(json).toStrictEqual({
      actors: [],
      orphans: [],
      dependencies: [],
      links: [],
      display: {},
      tool: 'pistar.2.1.0',
      istar: '2.0',
      saveDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
      diagram: { width: 2000, height: 1300 },
    });
    expect(Object.keys(json)).toEqual([
      'actors',
      'orphans',
      'dependencies',
      'links',
      'display',
      'tool',
      'istar',
      'saveDate',
      'diagram',
    ]);
  });

  test('saveDate: keeps the model value by default, overridable', () => {
    const model = { ...createEmptyModel(), saveDate: 'then' };
    expect(toPistarObject(model).saveDate).toBe('then');
    expect(toPistarObject(model, { saveDate: 'now' }).saveDate).toBe('now');
  });

  test('derives dependency source/target from its links', () => {
    const model = parsePistar({
      actors: [
        { id: 'a', text: 'A', type: 'istar.Actor', x: 1, y: 1, nodes: [] },
        { id: 'b', text: 'B', type: 'istar.Actor', x: 1, y: 1, nodes: [] },
      ],
      orphans: [],
      dependencies: [
        { id: 'd', text: 'D', type: 'istar.Goal', x: 1, y: 1, source: 'stale', target: 'stale' },
      ],
      links: [
        { id: 'l1', type: 'istar.DependencyLink', source: 'a', target: 'd' },
        { id: 'l2', type: 'istar.DependencyLink', source: 'd', target: 'b' },
      ],
      display: {},
    });
    expect(toPistarObject(model).dependencies?.[0]).toMatchObject({ source: 'a', target: 'b' });
  });
});
