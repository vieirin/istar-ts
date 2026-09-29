/**
 * Default element shapes, drawn after piStar's `tool/language/shapes.js`. Each shape scales to
 * the node's size; strokes use `vector-effect: non-scaling-stroke` as upstream does.
 */
import type { ElementKind } from '@istar-ts/core';
import type { ReactElement } from 'react';

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

/** Radius of the actor symbol circle (upstream `r: 40`). */
export const ACTOR_RADIUS = 40;

/** Decorations that distinguish Role and Agent from Actor, relative to the circle's box. */
const ACTOR_DECORATOR: Partial<Record<ElementKind, string>> = {
  // Upstream paths are relative to the actor position, with the circle's box at (-20,-20).
  'istar.Role': 'm 9 65 q 30 15 62 0',
  'istar.Agent': 'm 9 15 62 0',
};

export function ActorSymbol({ kind, fill }: { kind: ElementKind; fill?: string }): ReactElement {
  const size = ACTOR_RADIUS * 2;
  const decorator = ACTOR_DECORATOR[kind];
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
        style={stroke}
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
