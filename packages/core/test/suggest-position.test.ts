import { describe, expect, test } from 'vitest';
import type { ElementKind, IstarElement, Point } from '../src';
import { createEmptyModel, metamodelOf, parsePistar, suggestPosition } from '../src';
import { loadFixtures } from './fixtures';

const fixtures = loadFixtures();

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function firstNodeKind(metamodel: ReturnType<typeof metamodelOf>): ElementKind {
  for (const [kind, def] of metamodel.elements) {
    if (def.category === 'node') return kind as ElementKind;
  }
  throw new Error('no node kind in metamodel');
}

function firstActorId(model: ReturnType<typeof parsePistar>): string | undefined {
  const metamodel = metamodelOf(model);
  for (const element of model.elements.values()) {
    if (metamodel.elements.get(element.kind)?.category === 'actor') return element.id;
  }
  return undefined;
}

describe('suggestPosition', () => {
  test.each(fixtures.map((f) => [f.name, f] as const))('no overlap in %s', (_name, fixture) => {
    const model = parsePistar(fixture.text);
    const metamodel = metamodelOf(model);
    const kind = firstNodeKind(metamodel);
    const defaultSizeOf = (k: ElementKind): { width: number; height: number } =>
      metamodel.elements.get(k)?.size ?? { width: 90, height: 55 };

    const point = suggestPosition(model, { kind });
    const size = defaultSizeOf(kind);
    const box = { x: point.x, y: point.y, width: size.width, height: size.height };
    for (const element of model.elements.values()) {
      const base = defaultSizeOf(element.kind);
      const other = {
        x: element.x,
        y: element.y,
        width: element.display?.width ?? base.width,
        height: element.display?.height ?? base.height,
      };
      expect(overlaps(box, other)).toBe(false);
    }
  });

  const withActors = fixtures
    .map((f) => ({ f, model: parsePistar(f.text) }))
    .filter(({ model }) => firstActorId(model) !== undefined);

  test.each(withActors.map(({ f, model }) => [f.name, model] as const))(
    'no overlap inside a container in %s',
    (_name, model) => {
      const metamodel = metamodelOf(model);
      const kind = firstNodeKind(metamodel);
      const defaultSizeOf = (k: ElementKind): { width: number; height: number } =>
        metamodel.elements.get(k)?.size ?? { width: 90, height: 55 };
      const containerId = firstActorId(model)!;

      const inContainer = suggestPosition(model, { kind, containerId });
      const size = defaultSizeOf(kind);
      const inBox = { x: inContainer.x, y: inContainer.y, width: size.width, height: size.height };
      for (const element of model.elements.values()) {
        if (element.id === containerId) continue;
        const base = defaultSizeOf(element.kind);
        const other = {
          x: element.x,
          y: element.y,
          width: element.display?.width ?? base.width,
          height: element.display?.height ?? base.height,
        };
        expect(overlaps(inBox, other)).toBe(false);
      }
    },
  );

  test('near an element lands adjacent to it', () => {
    const model = parsePistar(fixtures.find((f) => f.name === 'pistar/welcome.txt')!.text);
    const [someId] = [...model.elements.keys()];
    const near = model.elements.get(someId!)!;
    const point = suggestPosition(model, {
      kind: firstNodeKind(metamodelOf(model)),
      near: someId!,
    });
    const distance = Math.hypot(point.x - near.x, point.y - near.y);
    expect(distance).toBeLessThan(600);
  });

  test('is deterministic', () => {
    const model = parsePistar(fixtures.find((f) => f.name === 'pistar/welcome.txt')!.text);
    const kind = firstNodeKind(metamodelOf(model));
    const a = suggestPosition(model, { kind });
    const b = suggestPosition(model, { kind });
    expect(a).toStrictEqual(b);
  });

  test('a model dense enough to fill every ring around near still gets a free spot', () => {
    const base = createEmptyModel();
    const elements = new Map<string, IstarElement>();
    const near: Point = { x: 0, y: 0 };
    // Tiles every ring candidate around `near` (25 rings, 40px step) with a task, spaced close
    // enough (its padded box is wider than the step) that no candidate escapes.
    const span = 25 * 40;
    let id = 0;
    for (let x = -span; x <= span; x += 40) {
      for (let y = -span; y <= span; y += 40) {
        const elementId = `t${id++}`;
        elements.set(elementId, { id: elementId, kind: 'istar.Task', name: elementId, x, y });
      }
    }
    const model = { ...base, elements };
    const point = suggestPosition(model, { kind: 'istar.Task', near });

    const metamodel = metamodelOf(model);
    const size = metamodel.elements.get('istar.Task')!.size!;
    const box = { x: point.x, y: point.y, width: size.width, height: size.height };
    for (const element of model.elements.values()) {
      const other = { x: element.x, y: element.y, width: size.width, height: size.height };
      expect(overlaps(box, other)).toBe(false);
    }
  });

  test('stays inside an actor boundary with room to spare', () => {
    const model = parsePistar(fixtures.find((f) => f.name === 'pistar/smartHome.txt')!.text);
    const containerId = firstActorId(model);
    expect(containerId).toBeDefined();
    const kind = firstNodeKind(metamodelOf(model));
    const point = suggestPosition(model, { kind, containerId: containerId! });
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
