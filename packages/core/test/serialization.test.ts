import { describe, expect, test } from 'vitest';
import {
  PistarParseError,
  actorBounds,
  childrenOf,
  createEmptyModel,
  inheritSourceLayout,
  metamodelOf,
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

  test.each(fixtures.map((f) => [f.name, f] as const))(
    'actor box geometry parity: %s',
    (_name, fixture) => {
      const model = parsePistar(fixture.text);
      const metamodel = metamodelOf(model);
      const json = toPistarObject(model);
      for (const actor of json.actors ?? []) {
        const box = actorBounds(model, actor.id, metamodel, undefined, 0);
        expect([actor.x, actor.y]).toEqual([box.x, box.y]);
        const display = json.display?.[actor.id];
        const hasSize = display && ('width' in display || 'height' in display);
        expect(hasSize ? [display.width, display.height] : [box.width, box.height]).toEqual([
          box.width,
          box.height,
        ]);
      }
    },
  );
});

describe('toPistarObject: actor box follows its children', () => {
  const baseFile = {
    actors: [
      {
        id: 'a1',
        text: 'Robot',
        type: 'istar.Actor',
        x: 0,
        y: 0,
        nodes: [{ id: 'g1', text: 'G1', type: 'istar.Goal', x: 50, y: 50 }],
      },
    ],
    orphans: [],
    dependencies: [],
    links: [],
    display: {},
    tool: 'pistar.2.1.0',
    istar: '2.0',
  };

  function moveChild(x: number, y: number) {
    const model = parsePistar(baseFile);
    const child = model.elements.get('g1')!;
    return {
      ...model,
      elements: new Map(model.elements).set('g1', { ...child, x, y }),
    };
  }

  test('grows to enclose a child moved outside it, then shrinks back', () => {
    const grown = toPistarObject(moveChild(3050, 3050));
    const actor = grown.actors[0]!;
    const box = actorBounds(
      moveChild(3050, 3050),
      'a1',
      metamodelOf(moveChild(3050, 3050)),
      undefined,
      0,
    );
    expect([actor.x, actor.y]).toEqual([box.x, box.y]);
    expect(box.width).toBeGreaterThan(3050);
    expect(box.height).toBeGreaterThan(3050);

    const reparsed = parsePistar(toPistar(moveChild(3050, 3050)));
    const reparsedBox = actorBounds(reparsed, 'a1', metamodelOf(reparsed), undefined, 0);
    expect([reparsedBox.x, reparsedBox.y, reparsedBox.width, reparsedBox.height]).toEqual([
      box.x,
      box.y,
      box.width,
      box.height,
    ]);

    const shrunk = toPistarObject(moveChild(50, 50));
    expect([shrunk.actors[0]!.x, shrunk.actors[0]!.y]).toEqual([0, 0]);
  });

  test('display width/height: overwritten when present, not added when absent', () => {
    const noSize = toPistarObject(moveChild(3050, 3050));
    expect(noSize.display?.a1).toBeUndefined();

    const model = moveChild(3050, 3050);
    const withStaleSize = {
      ...model,
      elements: new Map(model.elements).set('a1', {
        ...model.elements.get('a1')!,
        display: { width: 10, height: 10 },
      }),
    };
    const json = toPistarObject(withStaleSize);
    const box = actorBounds(withStaleSize, 'a1', metamodelOf(withStaleSize), undefined, 0);
    expect(json.display?.a1).toEqual({ width: box.width, height: box.height });
  });

  test('extraDisplay entries (ids not in the model) are untouched', () => {
    const model = moveChild(3050, 3050);
    const withExtra = { ...model, extraDisplay: { ghost: { backgroundColor: 'red' } } };
    const json = toPistarObject(withExtra);
    expect(json.display?.ghost).toEqual({ backgroundColor: 'red' });
  });
});

describe('parsePistar', () => {
  const sample = {
    actors: [
      {
        id: 'a1',
        text: 'Robot',
        type: 'istar.Actor',
        x: 0,
        y: 0,
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

describe('source key order (per object) and an absent saveDate', () => {
  // A file another tool wrote: keys in its own order, no saveDate. Every object's order is kept.
  const foreign = `{
  "actors": [
    {
      "id": "A1",
      "text": "Actor",
      "type": "istar.Actor",
      "nodes": [
        {
          "id": "G1",
          "text": "Goal",
          "type": "istar.Goal",
          "customProperties": {
            "Description": ""
          },
          "x": 10,
          "y": 20
        },
        {
          "id": "T1",
          "text": "Task",
          "type": "istar.Task",
          "x": 30,
          "y": 40,
          "customProperties": {
            "Description": ""
          }
        }
      ],
      "x": 10,
      "y": 20
    }
  ],
  "links": [
    {
      "id": "L1",
      "type": "istar.AndRefinementLink",
      "source": "T1",
      "target": "G1",
      "label": "a label",
      "customProperties": {
        "Description": ""
      }
    }
  ],
  "diagram": {
    "customProperties": {
      "Description": ""
    },
    "name": "Diagram",
    "width": 800,
    "height": 600
  },
  "tool": "pistar.2.0.0",
  "istar": "2.0"
}`;

  test('writes a foreign file back byte for byte', () => {
    expect(toPistar(parsePistar(foreign))).toBe(foreign);
  });

  test('keeps the order through edits, and new objects get piStar’s order', () => {
    const model = parsePistar(foreign);
    const edited = inheritSourceLayout(model, {
      ...model,
      elements: new Map([
        ...model.elements,
        ['G2', { id: 'G2', kind: 'istar.Goal', name: 'New', x: 1, y: 2, parent: 'A1' }],
      ]),
    });
    const json = toPistarObject(edited);
    const actor = json.actors[0]!;
    expect(Object.keys(actor)).toEqual(['id', 'text', 'type', 'nodes', 'x', 'y']);
    expect(Object.keys(actor.nodes[0]!)).toEqual([
      'id',
      'text',
      'type',
      'customProperties',
      'x',
      'y',
    ]);
    expect(Object.keys(actor.nodes[2]!)).toEqual(['id', 'text', 'type', 'x', 'y']);
    expect(Object.keys(json.links![0]!)).toEqual([
      'id',
      'type',
      'source',
      'target',
      'label',
      'customProperties',
    ]);
    expect(Object.keys(json.diagram!)).toEqual(['customProperties', 'name', 'width', 'height']);
    expect(json.saveDate).toBeUndefined();
  });

  test('a save that passes saveDate adds it to a file that had none', () => {
    const json = toPistarObject(parsePistar(foreign), { saveDate: new Date(Date.UTC(2024, 0, 1)) });
    expect(json.saveDate).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    expect(Object.keys(json).at(-1)).toBe('saveDate');
  });

  test('a model that was never a file still gets a saveDate', () => {
    expect(typeof toPistarObject(createEmptyModel()).saveDate).toBe('string');
  });

  test('an unordered model (no layout) writes piStar’s order', () => {
    const json = toPistarObject(parsePistar(foreign));
    const copy = toPistarObject(parsePistar(JSON.stringify(json)));
    expect(copy).toEqual(json);
  });
});
