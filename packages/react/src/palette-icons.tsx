/**
 * Small previews used as palette icons, like the piStar toolbar: each element is drawn with
 * its own shape, and each link as a diagonal line with its iStar marker.
 */
import type { ElementKind, LinkKind, NodeKind } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { DEPENDENCY_D, TARGET_MARKERS } from './edges';
import { QUALITY_PATH } from './shapes';

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
  x,
  y,
  w,
  h,
}: {
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}): ReactElement {
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
  }
}

export function elementIcon(kind: ElementKind): ReactElement {
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
      <NodeShape kind={kind} x={3} y={4} w={34} h={16} />
    </Icon>
  );
}

// Link icons run from bottom-left to top-right; markers sit at the top-right end.
const START = { x: 5, y: 20 };
const END = { x: 35, y: 4 };
const BACK_ANGLE = (Math.atan2(START.y - END.y, START.x - END.x) * 180) / Math.PI;
const FORWARD_ANGLE = BACK_ANGLE - 180;

export function linkIcon(kind: LinkKind, caption?: string): ReactElement {
  const marker = TARGET_MARKERS[kind];
  return (
    <Icon>
      <path
        d={`M ${START.x} ${START.y} L ${END.x} ${END.y}`}
        style={
          kind === 'istar.QualificationLink' ? { ...lineStyle, strokeDasharray: '4,2' } : lineStyle
        }
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

/** A small dependum between two line halves, with the dependency "D". */
export function dependencyIcon(dependum: NodeKind): ReactElement {
  return (
    <Icon>
      <path d="M 1 12 H 39" style={lineStyle} />
      <NodeShape kind={dependum} x={2} y={5} w={29} h={14} />
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
