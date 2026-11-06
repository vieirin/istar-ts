import { describe, expect, test } from 'vitest';
import {
  PistarParseError,
  childrenOf,
  createEmptyModel,
  createModelStore,
  inheritSourceLayout,
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
    'actor box is a pure projection of the element: %s',
    (_name, fixture) => {
      const model = parsePistar(fixture.text);
      const json = toPistarObject(model);
      for (const actor of json.actors ?? []) {
        const element = model.elements.get(actor.id)!;
        expect([actor.x, actor.y]).toEqual([element.x, element.y]);
        const display = json.display?.[actor.id];
        expect([display?.width, display?.height]).toEqual([
          element.display?.width,
          element.display?.height,
        ]);
      }
    },
  );
});

describe('toPistarObject: an actor’s x/y/display are a verbatim projection', () => {
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

  // These tests mutate the raw model (bypassing `moveElement`/`updateElement`, which keep an
  // actor's `x`/`y`/stored size in sync with its children via `operations.ts`'s
  // `refreshActorBoxes`), to pin down `toPistarObject` itself: it writes an actor's `x`/`y` and
  // `display` exactly as the model holds them, never deriving or adjusting either — keeping the
  // children in sync is the operations layer's job (see `store.test.ts`'s "refreshing an
  // actor’s box" describe), not serialization's.

  test('a child moved anywhere does not change the actor’s x/y', () => {
    const movedOut = toPistarObject(moveChild(3050, 3050));
    expect([movedOut.actors[0]!.x, movedOut.actors[0]!.y]).toEqual([0, 0]);

    const movedLeftUp = toPistarObject(moveChild(-200, -300));
    expect([movedLeftUp.actors[0]!.x, movedLeftUp.actors[0]!.y]).toEqual([0, 0]);

    const reparsed = parsePistar(toPistar(moveChild(3050, 3050)));
    expect([reparsed.elements.get('a1')!.x, reparsed.elements.get('a1')!.y]).toEqual([0, 0]);
  });

  test('display width/height: never added when absent, always verbatim when present', () => {
    const noSize = toPistarObject(moveChild(3050, 3050));
    expect(noSize.display?.a1).toBeUndefined();

    const model = moveChild(3050, 3050);
    const withSize = {
      ...model,
      elements: new Map(model.elements).set('a1', {
        ...model.elements.get('a1')!,
        display: { width: 10, height: 10 },
      }),
    };
    const json = toPistarObject(withSize);
    expect(json.display?.a1).toEqual({ width: 10, height: 10 });
  });

  test('a stored size smaller than the content is still copied verbatim', () => {
    const model = parsePistar(baseFile);
    const withStoredSize = {
      ...model,
      elements: new Map(model.elements)
        .set('a1', {
          ...model.elements.get('a1')!,
          x: 80,
          y: 20,
          display: { width: 820, height: 520 },
        })
        .set('g1', { ...model.elements.get('g1')!, x: 100, y: 40 }),
    };
    const json = toPistarObject(withStoredSize);
    const actor = json.actors[0]!;
    expect([actor.x, actor.y]).toEqual([80, 20]);
    expect(json.display?.a1).toEqual({ width: 820, height: 520 });
  });

  test('a goal-controller-like actor with a slack box is kept exactly', () => {
    const file = {
      ...baseFile,
      actors: [
        {
          id: 'a1',
          text: 'Robot',
          type: 'istar.Actor',
          x: 80,
          y: 20,
          nodes: [{ id: 'g1', text: 'G1', type: 'istar.Goal', x: 100, y: 40 }],
        },
      ],
      display: { a1: { width: 820, height: 520 } },
    };
    const model = parsePistar(file);

    const json = toPistarObject(model);
    expect([json.actors[0]!.x, json.actors[0]!.y]).toEqual([80, 20]);
    expect(json.display?.a1).toEqual({ width: 820, height: 520 });

    const reparsed = parsePistar(toPistar(model));
    expect(reparsed.elements.get('a1')?.display).toEqual({ width: 820, height: 520 });
  });

  test('extraDisplay entries (ids not in the model) are untouched', () => {
    const model = moveChild(3050, 3050);
    const withExtra = { ...model, extraDisplay: { ghost: { backgroundColor: 'red' } } };
    const json = toPistarObject(withExtra);
    expect(json.display?.ghost).toEqual({ backgroundColor: 'red' });
  });
});

describe('ratchet regression: moving a child out and back never grows the saved actor box', () => {
  function fileWith(actorDisplay: { width: number; height: number }, goalX: number, goalY: number) {
    return {
      actors: [
        {
          id: 'a1',
          text: 'Robot',
          type: 'istar.Actor',
          x: 10,
          y: 10,
          nodes: [{ id: 'g1', text: 'G1', type: 'istar.Goal', x: goalX, y: goalY }],
        },
      ],
      orphans: [],
      dependencies: [],
      links: [],
      display: { a1: actorDisplay },
      tool: 'pistar.2.1.0',
      istar: '2.0',
    };
  }

  const originalDisplay = { width: 300, height: 200 };
  const originalGoal = { x: 50, y: 50 };

  // A second, stationary child pins the box's other corner (here, the top-left) while `g1`
  // moves, so moving `g1` far away genuinely grows the saved box past both the original stored
  // size and the kind default — unlike a lone child, whose box can never exceed its own size.
  function fileWithTwoGoals(actorDisplay: { width: number; height: number }) {
    return {
      actors: [
        {
          id: 'a1',
          text: 'Robot',
          type: 'istar.Actor',
          x: 10,
          y: 10,
          nodes: [
            { id: 'g1', text: 'G1', type: 'istar.Goal', x: originalGoal.x, y: originalGoal.y },
            { id: 'g2', text: 'G2', type: 'istar.Goal', x: 50, y: 150 },
          ],
        },
      ],
      orphans: [],
      dependencies: [],
      links: [],
      display: { a1: actorDisplay },
      tool: 'pistar.2.1.0',
      istar: '2.0',
    };
  }

  test('move +3000 in x: the saved box grows to enclose both goals, anchored on the stationary one', () => {
    const store = createModelStore(parsePistar(fileWithTwoGoals(originalDisplay)));
    store.moveElement('g1', originalGoal.x + 3000, originalGoal.y);

    const json = toPistarObject(store.getModel());
    const actor = json.actors[0]!;
    const g1 = actor.nodes.find((node) => node.id === 'g1')!;
    expect(actor.x).toBe(50);
    expect(actor.y).toBe(50);
    const displayWidth = json.display!.a1!.width as number;
    expect(actor.x + displayWidth).toBeGreaterThanOrEqual(g1.x + 90); // istar.Goal default width
    expect(displayWidth).toBeGreaterThan(originalDisplay.width);
  });

  test('move out, re-parse, move back: the saved box is the (default-floored) content box, not the original', () => {
    let store = createModelStore(parsePistar(fileWithTwoGoals(originalDisplay)));
    store.moveElement('g1', originalGoal.x + 3000, originalGoal.y);
    store = createModelStore(parsePistar(toPistar(store.getModel())));
    store.moveElement('g1', originalGoal.x, originalGoal.y);

    const json = toPistarObject(store.getModel());
    expect([json.actors[0]!.x, json.actors[0]!.y]).toEqual([50, 50]);
    // Width floors to the kind default (200); height still reflects g2's own extent (135), which
    // was never the original 300x200 stored value (replaced outright, not consulted).
    expect(json.display?.a1).toEqual({ width: 200, height: 135 });
  });

  test('repeating move out / move back gives the identical saved box every time (no ratchet)', () => {
    let store = createModelStore(
      parsePistar(fileWith(originalDisplay, originalGoal.x, originalGoal.y)),
    );
    const outputs: string[] = [];
    for (let i = 0; i < 3; i++) {
      store.moveElement('g1', originalGoal.x + 3000, originalGoal.y);
      store = createModelStore(parsePistar(toPistar(store.getModel())));
      store.moveElement('g1', originalGoal.x, originalGoal.y);
      store = createModelStore(parsePistar(toPistar(store.getModel())));
      outputs.push(toPistar(store.getModel()));
    }
    expect(outputs).toEqual(outputs.map(() => outputs[0]));
  });

  test('toPistar is idempotent for the moved-out state', () => {
    const store = createModelStore(
      parsePistar(fileWith(originalDisplay, originalGoal.x, originalGoal.y)),
    );
    store.moveElement('g1', originalGoal.x + 3000, originalGoal.y);

    const once = toPistar(store.getModel());
    const twice = toPistar(parsePistar(once));
    expect(twice).toBe(once);
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
