/**
 * KAOS shapes, from DSM3-goals' `language_kaos_shapes.js` (https://www.cin.ufpe.br/~jhcp/dsm3goals/,
 * read 2026-10-16; no licence stated, see docs/dsm3-goals.md). The polygons keep DSM3's
 * `points`, on its 130×36 drawing; elements are 135×36 and the shape scales to them.
 */
import type { KaosElementKind } from './kinds';

/**
 * A kind's shape as SVG path data, with the dash array and stroke width DSM3 draws it with.
 * Structurally a react `ShapeSpec` (and core `KindShape`) plus their drawing hints.
 */
export interface KaosShape {
  readonly path: string;
  readonly viewBox?: string;
  /** SVG dash array, e.g. '8,4'. */
  readonly dash?: string;
  readonly strokeWidth?: number;
}

/**
 * Path data for an SVG polygon's `points` ("x1,y1 x2,y2 …"): a closed path through them.
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

/** Agent and Environment Agent: a hexagon. */
export const KAOS_AGENT_POINTS = '0,18 30,0 100,0 130,18 100,36 30,36';
/** Behavioral goal and Softgoal: a parallelogram leaning right. */
export const KAOS_GOAL_POINTS = '0,36 15,0 130,0 115,36';
/** Domain property: a trapezoid. */
export const KAOS_DOMAIN_PROPERTY_POINTS = '0,36 15,0 115,0 130,36';

/** The 130×36 drawing plus a one-unit stroke margin, as for piStar's Task. */
export const KAOS_VIEWBOX = '-1 -1 132 38';

/**
 * Environment Agent's stick figure, in the hexagon's coordinates: DSM3's head (circle at 30,12,
 * r 5), arms, body and legs.
 */
const STICK_FIGURE =
  'M 25 12 a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0 M 22 17 L 38 17 M 30 17 L 30 27 M 30 27 L 25 32 M 30 27 L 35 32';

export const KAOS_SHAPES: Readonly<Record<KaosElementKind, KaosShape>> = {
  'kaos.BehavioralGoal': { path: polygonPath(KAOS_GOAL_POINTS), viewBox: KAOS_VIEWBOX },
  'kaos.Softgoal': { path: polygonPath(KAOS_GOAL_POINTS), viewBox: KAOS_VIEWBOX, dash: '8,4' },
  'kaos.Agent': { path: polygonPath(KAOS_AGENT_POINTS), viewBox: KAOS_VIEWBOX },
  'kaos.EnvironmentAgent': {
    path: `${polygonPath(KAOS_AGENT_POINTS)} ${STICK_FIGURE}`,
    viewBox: KAOS_VIEWBOX,
  },
  'kaos.DomainProperty': { path: polygonPath(KAOS_DOMAIN_PROPERTY_POINTS), viewBox: KAOS_VIEWBOX },
};

/** The refinement's target marker: a filled triangle (JointJS convention, +x towards the source). */
export const KAOS_REFINEMENT_MARKER = 'm 12,-6 l -12,6 12,6 z';

/**
 * Glyphs DSM3 draws at a link's midpoint instead of a marker, with (0,0) on the midpoint.
 * Conflict: a lightning bolt. Responsibility assignment: a circle.
 */
export const KAOS_CONFLICT_GLYPH = 'm 10,-7 l 0,20 -5,-15 -15,15 0,-25 5,15 15,-15 0,5';
export const KAOS_ASSIGNMENT_GLYPH = 'm -15,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0';
