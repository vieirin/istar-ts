/**
 * Link rendering, after piStar's link shapes in `tool/language/shapes.js`.
 *
 * Edges float: they connect the borders of the two nodes (the actor circle for actors) along
 * the line between their centres, passing through any saved vertices.
 */
import type { IstarLink } from '@istar-ts/core';
import { LINK_KIND_INFO } from '@istar-ts/core';
import type { EdgeProps, EdgeTypes, InternalNode } from '@xyflow/react';
import { BaseEdge, useInternalNode } from '@xyflow/react';
import type { ComponentType, ReactElement } from 'react';
import { memo } from 'react';
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
  if (node.type === 'istarActor') {
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
const TARGET_MARKERS: Partial<Record<IstarLink['kind'], { d: string; filled: boolean }>> = {
  'istar.AndRefinementLink': { d: 'm 10,-6 l 0,12', filled: false },
  'istar.OrRefinementLink': { d: 'm 12,-6 l -12,6 12,6 z', filled: true },
  'istar.NeededByLink': { d: 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0', filled: true },
  'istar.ContributionLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.IsALink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.ParticipatesInLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
};

/** The dependency "D", drawn at the middle of each half and facing the dependee. */
const DEPENDENCY_D = 'm 0,-10 l 0,20 4,0 c 10,0, 10 -20, 0,-20 l -4,0';

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
  const { model } = useIstarEditor();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const link = data ? model.links.get(data.linkId) : undefined;
  if (!sourceNode || !targetNode || !link) return null;

  const points = linkPoints(sourceNode, targetNode, link.display?.vertices);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const end = points[points.length - 1]!;
  const beforeEnd = points[points.length - 2]!;
  const backAngle = (Math.atan2(beforeEnd.y - end.y, beforeEnd.x - end.x) * 180) / Math.PI;
  const marker = TARGET_MARKERS[link.kind];
  const info = LINK_KIND_INFO[link.kind];
  const middle = pointAlong(points, 0.5);

  return (
    <g className={`istar-link${selected ? ' is-selected' : ''}`} data-kind={link.kind}>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        className="istar-link-line"
        style={link.kind === 'istar.QualificationLink' ? { strokeDasharray: '10,5' } : undefined}
      />
      {marker && (
        <path
          className={`istar-link-marker${marker.filled ? ' is-filled' : ''}`}
          d={marker.d}
          transform={`translate(${end.x} ${end.y}) rotate(${backAngle})`}
        />
      )}
      {link.kind === 'istar.DependencyLink' && (
        <path
          className="istar-link-dependency"
          d={DEPENDENCY_D}
          transform={`translate(${middle.x} ${middle.y}) rotate(${middle.angle})`}
        />
      )}
      {link.kind === 'istar.ContributionLink' && link.label && (
        <LinkLabel at={pointAlong(points, 0.4)} text={link.label} className="is-contribution" />
      )}
      {info.label && <LinkLabel at={middle} text={info.label} className="is-actor-link" />}
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
