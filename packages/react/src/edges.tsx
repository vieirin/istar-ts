/**
 * Link rendering, after piStar's link shapes in `tool/language/shapes.js`.
 *
 * Edges float: they connect the borders of the two nodes (the actor circle for actors) along
 * the line between their centres, passing through any saved vertices.
 */
import type { IstarLink } from '@istar-ts/core';
import type { AnyMetamodel, LinkKind } from '@istar-ts/core';
import { LINK_KINDS, effectiveLinkKind } from '@istar-ts/core';
import type { AnyIstarRegistry, IstarRegistry } from './registry';
import type { EdgeProps, EdgeTypes, InternalNode } from '@xyflow/react';
import { BaseEdge, useInternalNode } from '@xyflow/react';
import type { ComponentType, ReactElement } from 'react';
import { memo } from 'react';
import { useCanvasOptions } from './canvas-options';
import { useIstarEditor } from './context';
import type { IstarFlowEdge } from './layout';
import { ACTOR_SYMBOL_OFFSET } from './layout';
import { ACTOR_RADIUS } from './shapes';

export interface Point {
  x: number;
  y: number;
}

interface Anchor {
  center: Point;
  /** Circle radius for actors; otherwise a box. */
  radius?: number;
  width: number;
  height: number;
}

function anchorOf(node: InternalNode): Anchor {
  const pos = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  if (node.type === 'istarActor' && !(node.data as { frameless?: boolean }).frameless) {
    return {
      center: { x: pos.x + ACTOR_SYMBOL_OFFSET, y: pos.y + ACTOR_SYMBOL_OFFSET },
      radius: ACTOR_RADIUS,
      width,
      height,
    };
  }
  return { center: { x: pos.x + width / 2, y: pos.y + height / 2 }, width, height };
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

/**
 * Target markers in JointJS convention: (0,0) is the link end and +x points back along the
 * link towards the source.
 */
export const TARGET_MARKERS: Partial<Record<IstarLink['kind'], { d: string; filled: boolean }>> = {
  'istar.AndRefinementLink': { d: 'm 10,-6 l 0,12', filled: false },
  'istar.OrRefinementLink': { d: 'm 12,-6 l -12,6 12,6 z', filled: true },
  'istar.NeededByLink': { d: 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0', filled: true },
  'istar.ContributionLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.IsALink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.ParticipatesInLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
};

/** The marker of link kinds that have no style of their own: an open arrow. */
export const OPEN_ARROW = 'm 10,-6 l -10,6 10,6';

export interface ResolvedLinkStyle {
  readonly dash?: string;
  readonly marker?: { readonly d: string; readonly filled: boolean };
  /** Draw the dependency "D" (dependency-category kinds). */
  readonly dependency: boolean;
  /** The kind carries a selectable value (contribution), drawn near the source. */
  readonly changeableLabel: boolean;
  /** Fixed text at the middle (e.g. "is-a"). */
  readonly label?: string;
}

/**
 * How a link kind is drawn: its registry `line` if any; else the iStar 2.0 style of the kind
 * it behaves like; else (an extension kind with its own rules) a continuous line with an open
 * arrow, as piStar-ext draws new links by default.
 */
export function resolveLinkStyle(
  metamodel: AnyMetamodel,
  registry: IstarRegistry,
  kind: string,
): ResolvedLinkStyle {
  const definition = metamodel.links.get(kind);
  const line = (registry as unknown as AnyIstarRegistry).links[kind]?.line;
  const effective = effectiveLinkKind(metamodel, kind) as LinkKind;
  const builtIn = (LINK_KINDS as readonly string[]).includes(effective);
  let dash: string | undefined;
  let marker: ResolvedLinkStyle['marker'];
  if (line) {
    dash = line.dash;
    marker =
      line.marker === false
        ? undefined
        : { d: line.marker ?? OPEN_ARROW, filled: line.markerFilled === true };
  } else if (builtIn) {
    dash = effective === 'istar.QualificationLink' ? '10,5' : undefined;
    marker = TARGET_MARKERS[effective];
  } else {
    marker = { d: OPEN_ARROW, filled: false };
  }
  return {
    ...(dash ? { dash } : {}),
    ...(marker ? { marker } : {}),
    dependency: definition?.category === 'dependency',
    changeableLabel: definition?.info.changeableLabel === true,
    ...(definition?.info.label ? { label: definition.info.label } : {}),
  };
}

/** The dependency "D", drawn at the middle of each half and facing the dependee. */
export const DEPENDENCY_D = 'm 0,-10 l 0,20 4,0 c 10,0, 10 -20, 0,-20 l -4,0';

/**
 * Cubic Bézier spline through `knots`, as JointJS's `smooth` connector draws it
 * (`g.Curve.throughPoints`: first control points from a tridiagonal system, second ones
 * mirrored). piStar switches a link to this connector as soon as it has vertices.
 */
export function smoothCurve(knots: readonly Point[]): {
  d: string;
  segments: [Point, Point, Point, Point][];
} {
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
function sampleCurve(segments: readonly [Point, Point, Point, Point][], perSegment = 24): Point[] {
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
export function curvedLink(
  source: InternalNode,
  target: InternalNode,
): { d: string; segments: [Point, Point, Point, Point][] } {
  const a = anchorOf(source);
  const b = anchorOf(target);
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

export function linkPoints(
  source: InternalNode,
  target: InternalNode,
  vertices: readonly Point[] = [],
): Point[] {
  const a = anchorOf(source);
  const b = anchorOf(target);
  const first = vertices[0] ?? b.center;
  const last = vertices[vertices.length - 1] ?? a.center;
  return [borderPoint(a, first), ...vertices, borderPoint(b, last)];
}

export const IstarEdge: ComponentType<EdgeProps<IstarFlowEdge>> = memo(function IstarEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<IstarFlowEdge>): ReactElement | null {
  const { model, metamodel, registry } = useIstarEditor();
  const { linkShape } = useCanvasOptions();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const link = data ? model.links.get(data.linkId) : undefined;
  if (!sourceNode || !targetNode || !link) return null;

  const vertices = link.display?.vertices ?? [];
  const knots = linkPoints(sourceNode, targetNode, vertices);
  // Smooth through saved vertices (piStar's `_toggleSmoothness`); otherwise straight, or a
  // Bézier curve with `linkShape="curved"`.
  const curve =
    vertices.length > 0
      ? smoothCurve(knots)
      : linkShape === 'curved'
        ? curvedLink(sourceNode, targetNode)
        : null;
  const path = curve
    ? curve.d
    : knots.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const points = curve ? sampleCurve(curve.segments) : knots;
  const end = points[points.length - 1]!;
  const beforeEnd = points[points.length - 2]!;
  const backAngle = (Math.atan2(beforeEnd.y - end.y, beforeEnd.x - end.x) * 180) / Math.PI;
  const style = resolveLinkStyle(metamodel, registry, link.kind);
  const marker = style.marker;
  const middle = pointAlong(points, 0.5);

  return (
    <g className={`istar-link${selected ? ' is-selected' : ''}`} data-kind={link.kind}>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        className="istar-link-line"
        style={style.dash ? { strokeDasharray: style.dash } : undefined}
      />
      {marker && (
        <path
          className={`istar-link-marker${marker.filled ? ' is-filled' : ''}`}
          d={marker.d}
          transform={`translate(${end.x} ${end.y}) rotate(${backAngle})`}
        />
      )}
      {style.dependency && (
        <path
          className="istar-link-dependency"
          d={DEPENDENCY_D}
          transform={`translate(${middle.x} ${middle.y}) rotate(${middle.angle})`}
        />
      )}
      {style.changeableLabel && link.label && (
        <LinkLabel at={pointAlong(points, 0.4)} text={link.label} className="is-contribution" />
      )}
      {style.label && <LinkLabel at={middle} text={style.label} className="is-actor-link" />}
    </g>
  );
});

function LinkLabel({
  at,
  text,
  className,
}: {
  at: Point;
  text: string;
  className: string;
}): ReactElement {
  return (
    <text
      className={`istar-link-label ${className}`}
      x={at.x}
      y={at.y}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {text}
    </text>
  );
}

export const edgeTypes: EdgeTypes = { istar: IstarEdge };
