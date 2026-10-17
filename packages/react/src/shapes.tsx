/**
 * Default element shapes, drawn after piStar's `tool/language/shapes.js`. Each shape scales to
 * the node's size; strokes use `vector-effect: non-scaling-stroke` as upstream does.
 */
import type { ElementKind, KindShape } from '@istar-ts/core';
import type { CSSProperties, ReactElement } from 'react';
import { pathBounds } from './svg-path';

export interface ShapeProps {
  readonly width: number;
  readonly height: number;
  readonly fill?: string;
}

const stroke = {
  stroke: 'var(--istar-node-stroke)',
  strokeWidth: 'var(--istar-stroke-width)',
  vectorEffect: 'non-scaling-stroke',
} as const;

function Svg(props: {
  width: number;
  height: number;
  viewBox?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <svg
      className="istar-shape"
      width={props.width}
      height={props.height}
      viewBox={props.viewBox ?? `0 0 ${props.width} ${props.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {props.children}
    </svg>
  );
}

export function GoalShape({ width, height, fill }: ShapeProps): ReactElement {
  const r = Math.min(20, height / 2);
  return (
    <Svg width={width} height={height}>
      <rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        rx={r}
        ry={r}
        fill={fill ?? 'var(--istar-node-fill)'}
        style={stroke}
      />
    </Svg>
  );
}

export function ResourceShape({ width, height, fill }: ShapeProps): ReactElement {
  return (
    <Svg width={width} height={height}>
      <rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        fill={fill ?? 'var(--istar-node-fill)'}
        style={stroke}
      />
    </Svg>
  );
}

export function TaskShape({ width, height, fill }: ShapeProps): ReactElement {
  // Upstream polygon: '0,18 15,0 115,0 130,18 115,36 15,36' on a 130x36 box.
  return (
    <Svg width={width} height={height} viewBox="-1 -1 132 38">
      <polygon
        points="0,18 15,0 115,0 130,18 115,36 15,36"
        fill={fill ?? 'var(--istar-node-fill)'}
        style={stroke}
      />
    </Svg>
  );
}

export const QUALITY_PATH =
  'm 60.637955,-4.0358 c 17.5174,2.2042 29.9953,-10.69554 41.892705,-4.7858 22.34142,10.8714 11.2203,43.7743 -2.25,47.7322 -8.276505,2.9084 -13.960205,5.1934 -46.142805,-2.1786 -6.7454,-2.2317 -28.2652,6.0799 -35.4643,4.7143 C 9.072156,39.4809 6.491756,33.7693 3.744956,28.482 c -6.3069,-15.1266 -2.5738,-28.0439 7.981099,-34.7856 10.5549,-6.74179 27.9316,-7.30796 48.9119,2.2678 z';

export function QualityShape({ width, height, fill }: ShapeProps): ReactElement {
  // viewBox is the path's bounding box (0.67, -11.31, 114.61 x 52.98) plus stroke margin.
  return (
    <Svg width={width} height={height} viewBox="-0.5 -12.5 117 55.4">
      <path d={QUALITY_PATH} fill={fill ?? 'var(--istar-node-fill)'} style={stroke} />
    </Svg>
  );
}

/**
 * A shape given as SVG path data, as piStar-ext's "Create a new Construct" dialog takes it.
 * The path is scaled to the element's size (like JointJS's `resetOffset`), so it can be drawn
 * at any scale; `viewBox` overrides the computed bounds. It is core's `KindShape`, so a
 * metamodel's shapes are used as they are:
 *
 * - `dash`: SVG dash array of the outline, e.g. '8,4' (DSM3's KAOS Softgoal); default continuous;
 * - `strokeWidth`: outline width in screen pixels (strokes don't scale with the element), e.g.
 *   5 for DSM3's NFR Operationalization; default the theme's `--istar-stroke-width`.
 */
export type ShapeSpec = KindShape;

/**
 * Path data for an SVG polygon's `points` ("x1,y1 x2,y2 …"): a closed path through them, so a
 * JointJS polygon shape (piStar, DSM3-goals) can be given as a `ShapeSpec`.
 */
export function polygonPath(points: string): string {
  const coords = points
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (coords.length < 4 || coords.length % 2 !== 0 || coords.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid polygon points: "${points}"`);
  }
  const parts: string[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'} ${coords[i]} ${coords[i + 1]}`);
  }
  return `${parts.join(' ')} Z`;
}

/** The outline style a shape spec asks for, over the default stroke. */
function shapeStrokeStyle(spec: Pick<ShapeSpec, 'dash' | 'strokeWidth'>): CSSProperties {
  return {
    ...stroke,
    ...(spec.dash ? { strokeDasharray: spec.dash } : {}),
    ...(spec.strokeWidth !== undefined ? { strokeWidth: spec.strokeWidth } : {}),
  };
}

const boundsCache = new Map<string, string>();

/** The `viewBox` a shape is drawn with: its own, or its path's bounds plus a small margin. */
export function shapeViewBox(spec: ShapeSpec): string {
  if (spec.viewBox) return spec.viewBox;
  let viewBox = boundsCache.get(spec.path);
  if (viewBox === undefined) {
    const b = pathBounds(spec.path) ?? { x: 0, y: 0, width: 1, height: 1 };
    // A margin so the stroke at the edge isn't clipped.
    const mx = Math.max(b.width, 1) * 0.02;
    const my = Math.max(b.height, 1) * 0.02;
    viewBox = `${b.x - mx} ${b.y - my} ${Math.max(b.width, 1) + 2 * mx} ${Math.max(b.height, 1) + 2 * my}`;
    boundsCache.set(spec.path, viewBox);
  }
  return viewBox;
}

export function PathShape({
  path,
  viewBox,
  dash,
  strokeWidth,
  width,
  height,
  fill,
}: ShapeProps & ShapeSpec): ReactElement {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={shapeViewBox({ path, ...(viewBox ? { viewBox } : {}) })}
    >
      <path
        d={path}
        fill={fill ?? 'var(--istar-node-fill)'}
        style={shapeStrokeStyle({ dash, strokeWidth })}
      />
    </Svg>
  );
}

/**
 * piStar's `DefaultNode`: the shape of a node kind that has none of its own, a white dashed
 * box (the label adds the kind's «stereotype»).
 */
export function DefaultNodeShape({ width, height, fill }: ShapeProps): ReactElement {
  return (
    <Svg width={width} height={height}>
      <rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        fill={fill ?? 'var(--istar-canvas-bg, #fff)'}
        style={{ ...stroke, strokeDasharray: '8 4' }}
      />
    </Svg>
  );
}

/** Radius of the actor symbol circle (upstream `r: 40`). */
export const ACTOR_RADIUS = 40;

/** Decorations that distinguish Role and Agent from Actor, relative to the circle's box. */
const ACTOR_DECORATOR: Partial<Record<ElementKind, string>> = {
  // Upstream paths are relative to the actor position, with the circle's box at (-20,-20).
  'istar.Role': 'm 9 65 q 30 15 62 0',
  'istar.Agent': 'm 9 15 62 0',
};

export function ActorSymbol({
  kind,
  fill,
  dashed,
}: {
  /** Actor, Agent or Role (Agent and Role add their decoration); other kinds draw a plain circle. */
  kind: string;
  fill?: string;
  /** piStar's `DefaultContainer` look, for actor kinds without a symbol of their own. */
  dashed?: boolean;
}): ReactElement {
  const size = ACTOR_RADIUS * 2;
  const decorator = ACTOR_DECORATOR[kind as ElementKind];
  return (
    <svg
      className="istar-shape"
      width={size + 4}
      height={size + 4}
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      aria-hidden
    >
      <circle
        cx={ACTOR_RADIUS}
        cy={ACTOR_RADIUS}
        r={ACTOR_RADIUS}
        fill={fill ?? 'var(--istar-node-fill)'}
        style={dashed ? { ...stroke, strokeDasharray: '8 4' } : stroke}
      />
      {decorator && (
        <path d={decorator} fill="none" stroke="var(--istar-node-stroke)" strokeWidth={1.5} />
      )}
    </svg>
  );
}

export const DEFAULT_SHAPES: Readonly<
  Partial<Record<ElementKind, (props: ShapeProps) => ReactElement>>
> = {
  'istar.Goal': GoalShape,
  'istar.Quality': QualityShape,
  'istar.Resource': ResourceShape,
  'istar.Task': TaskShape,
};
