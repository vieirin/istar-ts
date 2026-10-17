/**
 * Link geometry, free of React Flow: where a link leaves and enters its nodes' outlines, the
 * path it is drawn with, and points along it. The canvas's edges and the layout (which places
 * anchors on the middle of links that other links target) share it.
 */
import type { LinkShape } from './canvas-options';

export interface Point {
  x: number;
  y: number;
}

/** A node's outline as links see it: a circle (actors) or a box around `center`. */
export interface Anchor {
  center: Point;
  /** Circle radius for actors; otherwise a box. */
  radius?: number;
  width: number;
  height: number;
}

/** Where the segment from the anchor's centre towards `toward` leaves the anchor's outline. */
export function borderPoint(anchor: Anchor, toward: Point): Point {
  const dx = toward.x - anchor.center.x;
  const dy = toward.y - anchor.center.y;
  if (dx === 0 && dy === 0) return anchor.center;
  if (anchor.radius !== undefined) {
    const len = Math.hypot(dx, dy);
    return {
      x: anchor.center.x + (dx / len) * anchor.radius,
      y: anchor.center.y + (dy / len) * anchor.radius,
    };
  }
  const sx = dx === 0 ? Infinity : anchor.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : anchor.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: anchor.center.x + dx * s, y: anchor.center.y + dy * s };
}

/** The point at `ratio` of the polyline's length, and the direction of travel there (deg). */
export function pointAlong(points: readonly Point[], ratio: number): Point & { angle: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    lengths.push(l);
    total += l;
  }
  let remaining = total * ratio;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = lengths[i - 1]!;
    if (remaining <= l || i === points.length - 1) {
      const t = l === 0 ? 0 : Math.min(1, remaining / l);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    remaining -= l;
  }
  const p = points[0] ?? { x: 0, y: 0 };
  return { ...p, angle: 0 };
}

/** A path of cubic Bézier segments, with its SVG data. */
export interface CurvePath {
  d: string;
  segments: [Point, Point, Point, Point][];
}

/**
 * Cubic Bézier spline through `knots`, as JointJS's `smooth` connector draws it
 * (`g.Curve.throughPoints`: first control points from a tridiagonal system, second ones
 * mirrored). piStar switches a link to this connector as soon as it has vertices.
 */
export function smoothCurve(knots: readonly Point[]): CurvePath {
  const n = knots.length - 1;
  if (n < 1) return { d: '', segments: [] };
  if (n === 1) {
    const [a, b] = [knots[0]!, knots[1]!];
    const c1 = { x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 };
    const c2 = { x: 2 * c1.x - a.x, y: 2 * c1.y - a.y };
    return {
      d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`,
      segments: [[a, c1, c2, b]],
    };
  }
  const solve = (rhs: number[]): number[] => {
    const x: number[] = [];
    const tmp: number[] = [];
    let b = 2;
    x[0] = rhs[0]! / b;
    for (let i = 1; i < n; i++) {
      tmp[i] = 1 / b;
      b = (i < n - 1 ? 4 : 3.5) - tmp[i]!;
      x[i] = (rhs[i]! - x[i - 1]!) / b;
    }
    for (let i = 1; i < n; i++) x[n - i - 1]! -= tmp[n - i]! * x[n - i]!;
    return x;
  };
  const rhs = (axis: 'x' | 'y'): number[] => {
    const r: number[] = [];
    for (let i = 1; i < n - 1; i++) r[i] = 4 * knots[i]![axis] + 2 * knots[i + 1]![axis];
    r[0] = knots[0]![axis] + 2 * knots[1]![axis];
    r[n - 1] = (8 * knots[n - 1]![axis] + knots[n]![axis]) / 2;
    return r;
  };
  const fx = solve(rhs('x'));
  const fy = solve(rhs('y'));
  const segments: [Point, Point, Point, Point][] = [];
  for (let i = 0; i < n; i++) {
    const first = { x: fx[i]!, y: fy[i]! };
    const second =
      i < n - 1
        ? { x: 2 * knots[i + 1]!.x - fx[i + 1]!, y: 2 * knots[i + 1]!.y - fy[i + 1]! }
        : { x: (knots[n]!.x + fx[n - 1]!) / 2, y: (knots[n]!.y + fy[n - 1]!) / 2 };
    segments.push([knots[i]!, first, second, knots[i + 1]!]);
  }
  const d =
    `M ${knots[0]!.x} ${knots[0]!.y} ` +
    segments.map(([, c1, c2, e]) => `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`).join(' ');
  return { d, segments };
}

/** Points along the Bézier segments, for placing markers and labels on a curved link. */
export function sampleCurve(
  segments: readonly [Point, Point, Point, Point][],
  perSegment = 24,
): Point[] {
  const out: Point[] = [];
  segments.forEach(([p0, p1, p2, p3], s) => {
    for (let i = s === 0 ? 0 : 1; i <= perSegment; i++) {
      const t = i / perSegment;
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  });
  return out;
}

/** Unit vector out of the anchor's outline at `p`: radial for circles, the side's normal for boxes. */
function outwardNormal(anchor: Anchor, p: Point): Point {
  const dx = p.x - anchor.center.x;
  const dy = p.y - anchor.center.y;
  if (anchor.radius !== undefined) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }
  // Which side the point lies on: compare against the box's proportions.
  return Math.abs(dx) * anchor.height >= Math.abs(dy) * anchor.width
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 };
}

/** React Flow's Bézier control offset (`calculateControlOffset`, curvature 0.25). */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
}

/**
 * A curved link without vertices, like React Flow's Bézier edges: it leaves each node at the
 * same border point as a straight link, perpendicular to that side (e.g. out of the bottom of a
 * goal and into the top of its sub-goal), and bends in between.
 */
export function curvedLink(a: Anchor, b: Anchor): CurvePath {
  const p0 = borderPoint(a, b.center);
  const p3 = borderPoint(b, a.center);
  const n0 = outwardNormal(a, p0);
  const n3 = outwardNormal(b, p3);
  const k0 = controlOffset((p3.x - p0.x) * n0.x + (p3.y - p0.y) * n0.y);
  const k3 = controlOffset((p0.x - p3.x) * n3.x + (p0.y - p3.y) * n3.y);
  const c1 = { x: p0.x + n0.x * k0, y: p0.y + n0.y * k0 };
  const c2 = { x: p3.x + n3.x * k3, y: p3.y + n3.y * k3 };
  return {
    d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`,
    segments: [[p0, c1, c2, p3]],
  };
}

/** The link's polyline: border to border through the saved vertices. */
export function linkPoints(a: Anchor, b: Anchor, vertices: readonly Point[] = []): Point[] {
  const first = vertices[0] ?? b.center;
  const last = vertices[vertices.length - 1] ?? a.center;
  return [borderPoint(a, first), ...vertices, borderPoint(b, last)];
}

/**
 * How a link between two anchors is drawn: its SVG path, and points along it for placing
 * markers and labels. Smooth through saved vertices (piStar's `_toggleSmoothness`); otherwise
 * straight, or a Bézier curve with `linkShape="curved"`.
 */
export function linkPath(
  a: Anchor,
  b: Anchor,
  vertices: readonly Point[] = [],
  shape: LinkShape = 'straight',
): { d: string; points: Point[] } {
  const knots = linkPoints(a, b, vertices);
  const curve =
    vertices.length > 0 ? smoothCurve(knots) : shape === 'curved' ? curvedLink(a, b) : null;
  if (!curve) {
    return {
      d: knots.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '),
      points: knots,
    };
  }
  return { d: curve.d, points: sampleCurve(curve.segments) };
}

/** The middle of a link as it is drawn: where a link that targets it ends (DSM3's `virtualTarget`). */
export function linkMidpoint(
  a: Anchor,
  b: Anchor,
  vertices: readonly Point[] = [],
  shape: LinkShape = 'straight',
): Point & { angle: number } {
  return pointAlong(linkPath(a, b, vertices, shape).points, 0.5);
}
