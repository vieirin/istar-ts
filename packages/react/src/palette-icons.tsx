/**
 * Small previews used as palette icons, like the piStar toolbar: each element is drawn with
 * its own shape, and each link as a diagonal line with its iStar marker.
 */
import type { ElementKind, LinkKind } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { DEPENDENCY_D, TARGET_MARKERS } from './edges';
import type { ShapeSpec } from './shapes';
import { QUALITY_PATH, shapeViewBox } from './shapes';

const W = 40;
const H = 24;

const shapeStyle = {
  fill: 'var(--istar-node-fill)',
  stroke: 'var(--istar-stroke)',
  strokeWidth: 1.5,
} as const;
const lineStyle = { stroke: 'var(--istar-stroke)', strokeWidth: 1.2, fill: 'none' } as const;

function Icon({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg className="istar-palette-icon" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {children}
    </svg>
  );
}

function NodeShape({
  kind,
  shape,
  x,
  y,
  w,
  h,
}: {
  kind: string;
  shape?: ShapeSpec;
  x: number;
  y: number;
  w: number;
  h: number;
}): ReactElement {
  if (shape) {
    return (
      <svg
        x={x}
        y={y}
        width={w}
        height={h}
        viewBox={shapeViewBox(shape)}
        preserveAspectRatio="none"
      >
        <path d={shape.path} style={{ ...shapeStyle, vectorEffect: 'non-scaling-stroke' }} />
      </svg>
    );
  }
  switch (kind) {
    case 'istar.Goal':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} style={shapeStyle} />;
    case 'istar.Resource':
      return <rect x={x} y={y} width={w} height={h} style={shapeStyle} />;
    case 'istar.Task': {
      const d = h / 2;
      const points = `${x},${y + d} ${x + d * 0.8},${y} ${x + w - d * 0.8},${y} ${x + w},${y + d} ${x + w - d * 0.8},${y + h} ${x + d * 0.8},${y + h}`;
      return <polygon points={points} style={shapeStyle} />;
    }
    case 'istar.Quality':
      return (
        <svg
          x={x}
          y={y}
          width={w}
          height={h}
          viewBox="-0.5 -12.5 117 55.4"
          preserveAspectRatio="none"
        >
          <path d={QUALITY_PATH} style={{ ...shapeStyle, vectorEffect: 'non-scaling-stroke' }} />
        </svg>
      );
    default:
      // piStar's DefaultNode: kinds without a shape of their own.
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          style={{ ...shapeStyle, fill: 'var(--istar-canvas-bg, #fff)', strokeDasharray: '3 2' }}
        />
      );
  }
}

export interface ElementIconOptions {
  /** The kind's shape as SVG path data (extended node kinds). */
  readonly shape?: ShapeSpec;
  /** Draw an actor symbol: `true` for an extended actor kind (a dashed circle). */
  readonly actor?: boolean;
}

/**
 * A palette preview of an element kind. Extended kinds pass their `shape`, or `actor` for an
 * extended actor kind; without either they get piStar's default node, a dashed box.
 */
export function elementIcon(
  kind: ElementKind | (string & {}),
  options: ElementIconOptions,
): ReactElement;
// The one-argument signature comes last, so `kinds.map(elementIcon)` types as before.
export function elementIcon(kind: ElementKind | (string & {})): ReactElement;
export function elementIcon(
  kind: ElementKind | (string & {}),
  given?: ElementIconOptions,
): ReactElement {
  // As an array callback the second argument is an index: ignore anything but options.
  const options: ElementIconOptions = typeof given === 'object' && given !== null ? given : {};
  if (options.actor) {
    return (
      <Icon>
        <circle cx={W / 2} cy={H / 2} r={10} style={{ ...shapeStyle, strokeDasharray: '3 2' }} />
      </Icon>
    );
  }
  if (kind === 'istar.Actor' || kind === 'istar.Agent' || kind === 'istar.Role') {
    return (
      <Icon>
        <circle cx={W / 2} cy={H / 2} r={10} style={shapeStyle} />
        {kind === 'istar.Agent' ? <path d="M 12 7.5 H 28" style={lineStyle} /> : <g />}
        {kind === 'istar.Role' ? <path d="M 12 16 Q 20 20 28 16" style={lineStyle} /> : <g />}
      </Icon>
    );
  }
  return (
    <Icon>
      <NodeShape
        kind={kind}
        {...(options.shape ? { shape: options.shape } : {})}
        x={3}
        y={4}
        w={34}
        h={16}
      />
    </Icon>
  );
}

// Link icons run from bottom-left to top-right; markers sit at the top-right end.
const START = { x: 5, y: 20 };
const END = { x: 35, y: 4 };
const BACK_ANGLE = (Math.atan2(START.y - END.y, START.x - END.x) * 180) / Math.PI;
const FORWARD_ANGLE = BACK_ANGLE - 180;

export interface LinkIconStyle {
  /** Dash array of the line, e.g. '10,5'. */
  readonly dash?: string;
  /** Target marker (JointJS convention, as in the canvas); `null` for none. */
  readonly marker?: { readonly d: string; readonly filled: boolean } | null;
}

/**
 * A palette preview of a link kind: a diagonal line with its marker. Extended kinds pass their
 * resolved `style` (dash and marker).
 */
export function linkIcon(
  kind: LinkKind | (string & {}),
  caption?: string,
  style?: LinkIconStyle,
): ReactElement {
  const marker =
    style && style.marker !== undefined ? style.marker : TARGET_MARKERS[kind as LinkKind];
  const dash = style ? style.dash : kind === 'istar.QualificationLink' ? '10,5' : undefined;
  return (
    <Icon>
      <path
        d={`M ${START.x} ${START.y} L ${END.x} ${END.y}`}
        style={dash ? { ...lineStyle, strokeDasharray: scaleDash(dash) } : lineStyle}
      />
      {marker ? (
        <path
          d={marker.d}
          transform={`translate(${END.x} ${END.y}) rotate(${BACK_ANGLE}) scale(0.7)`}
          style={{ ...lineStyle, fill: marker.filled ? 'var(--istar-stroke)' : 'none' }}
        />
      ) : (
        <g />
      )}
      {caption ? (
        <text
          x={W / 2 - 3}
          y={H / 2 - 3}
          fontSize={7}
          textAnchor="middle"
          transform={`rotate(${FORWARD_ANGLE} ${W / 2} ${H / 2})`}
          fill="var(--istar-text)"
        >
          {caption}
        </text>
      ) : (
        <g />
      )}
    </Icon>
  );
}

/** Dash arrays are drawn at canvas scale; the icon is smaller. */
function scaleDash(dash: string): string {
  return dash
    .split(/[\s,]+/)
    .map((n) => String(Math.max(1, Number(n) * 0.4)))
    .join(',');
}

/** A small dependum between two line halves, with the dependency "D". */
export function dependencyIcon(
  dependum: ElementKind | (string & {}),
  options: { readonly shape?: ShapeSpec },
): ReactElement;
// The one-argument signature comes last, so `kinds.map(dependencyIcon)` types as before.
export function dependencyIcon(dependum: ElementKind | (string & {})): ReactElement;
export function dependencyIcon(
  dependum: ElementKind | (string & {}),
  given?: { readonly shape?: ShapeSpec },
): ReactElement {
  const options = typeof given === 'object' && given !== null ? given : {};
  return (
    <Icon>
      <path d="M 1 12 H 39" style={lineStyle} />
      <NodeShape
        kind={dependum}
        {...(options.shape ? { shape: options.shape } : {})}
        x={2}
        y={5}
        w={29}
        h={14}
      />
      <text
        x={16.5}
        y={13.5}
        fontSize={4.2}
        fontWeight="bold"
        textAnchor="middle"
        fill="var(--istar-text)"
      >
        DEPENDUM
      </text>
      <path
        d={DEPENDENCY_D}
        transform="translate(33 12) scale(0.45)"
        style={{ ...lineStyle, fill: '#fff' }}
      />
    </Icon>
  );
}
