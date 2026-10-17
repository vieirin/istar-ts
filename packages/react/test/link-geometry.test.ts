import { describe, expect, test } from 'vitest';
import type { Anchor } from '../src/link-geometry';
import { borderPoint, linkMidpoint, linkPath, linkPoints, pointAlong } from '../src/link-geometry';

const box = (x: number, y: number, width = 100, height = 40): Anchor => ({
  center: { x: x + width / 2, y: y + height / 2 },
  width,
  height,
});

describe('link geometry', () => {
  test('borderPoint leaves a box through the side facing the other point', () => {
    const a = box(0, 0);
    expect(borderPoint(a, { x: 500, y: 20 })).toEqual({ x: 100, y: 20 });
    expect(borderPoint(a, { x: 50, y: 500 })).toEqual({ x: 50, y: 40 });
    expect(borderPoint(a, a.center)).toBe(a.center);
  });

  test('borderPoint leaves a circle at its radius', () => {
    const actor: Anchor = { center: { x: 0, y: 0 }, radius: 40, width: 80, height: 80 };
    expect(borderPoint(actor, { x: 0, y: 100 })).toEqual({ x: 0, y: 40 });
  });

  test('a straight link goes border to border; its midpoint is halfway', () => {
    const a = box(0, 0);
    const b = box(300, 0);
    expect(linkPoints(a, b)).toEqual([
      { x: 100, y: 20 },
      { x: 300, y: 20 },
    ]);
    const { d } = linkPath(a, b);
    expect(d).toBe('M 100 20 L 300 20');
    expect(linkMidpoint(a, b)).toEqual({ x: 200, y: 20, angle: 0 });
  });

  test('a link through vertices is smoothed, and its midpoint lies on the curve', () => {
    const a = box(0, 0);
    const b = box(300, 0);
    const vertices = [{ x: 200, y: 200 }];
    const { d, points } = linkPath(a, b, vertices);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' C ');
    const middle = linkMidpoint(a, b, vertices);
    expect(middle).toEqual(pointAlong(points, 0.5));
    // Symmetric layout: the middle is on the axis of symmetry, below the nodes.
    expect(middle.x).toBeCloseTo(200, 0);
    expect(middle.y).toBeGreaterThan(100);
  });

  test('a curved link bends between the same border points as a straight one', () => {
    const a = box(0, 0);
    const b = box(0, 200);
    const { d, points } = linkPath(a, b, [], 'curved');
    expect(d).toMatch(/^M 50 40 C .* 50 200$/);
    expect(points[0]).toEqual({ x: 50, y: 40 });
    expect(points[points.length - 1]).toEqual({ x: 50, y: 200 });
  });
});
