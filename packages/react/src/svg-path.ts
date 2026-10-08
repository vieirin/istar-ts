/**
 * Bounding box of SVG path data, without a DOM. Used to scale a shape given as path data
 * (piStar-ext's "Create a new Construct" takes an SVG path) to an element's size, as JointJS's
 * `resetOffset` does upstream. Curves and arcs are sampled, which is exact enough for layout.
 */

export interface PathBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARGS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};
const SAMPLES = 16;

/** The bounds of path data `d`, or `undefined` if it has no drawable points. */
export function pathBounds(d: string): PathBounds | undefined {
  const tokens = d.match(TOKEN) ?? [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Last control point, for the smooth S/T commands.
  let lastControl: { x: number; y: number; kind: 'C' | 'Q' } | undefined;

  const next = (): number => Number(tokens[i++]);

  while (i < tokens.length) {
    if (COMMAND.test(tokens[i]!)) command = tokens[i++]!;
    else if (!command) return undefined;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const count = ARGS[upper]!;
    if (count > 0 && i + count > tokens.length) break;
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    let control: typeof lastControl;

    switch (upper) {
      case 'M':
      case 'L':
      case 'T': {
        const nx = ox + next();
        const ny = oy + next();
        if (upper === 'T') {
          const cx = lastControl?.kind === 'Q' ? 2 * x - lastControl.x : x;
          const cy = lastControl?.kind === 'Q' ? 2 * y - lastControl.y : y;
          sampleQuad(x, y, cx, cy, nx, ny, add);
          control = { x: cx, y: cy, kind: 'Q' };
        }
        x = nx;
        y = ny;
        add(x, y);
        if (upper === 'M') {
          startX = x;
          startY = y;
          // Further pairs after a moveto are linetos.
          command = relative ? 'l' : 'L';
        }
        break;
      }
      case 'H':
        x = ox + next();
        add(x, y);
        break;
      case 'V':
        y = oy + next();
        add(x, y);
        break;
      case 'C':
      case 'S': {
        let c1x: number;
        let c1y: number;
        if (upper === 'C') {
          c1x = ox + next();
          c1y = oy + next();
        } else {
          c1x = lastControl?.kind === 'C' ? 2 * x - lastControl.x : x;
          c1y = lastControl?.kind === 'C' ? 2 * y - lastControl.y : y;
        }
        const c2x = ox + next();
        const c2y = oy + next();
        const nx = ox + next();
        const ny = oy + next();
        sampleCubic(x, y, c1x, c1y, c2x, c2y, nx, ny, add);
        control = { x: c2x, y: c2y, kind: 'C' };
        x = nx;
        y = ny;
        break;
      }
      case 'Q': {
        const cx = ox + next();
        const cy = oy + next();
        const nx = ox + next();
        const ny = oy + next();
        sampleQuad(x, y, cx, cy, nx, ny, add);
        control = { x: cx, y: cy, kind: 'Q' };
        x = nx;
        y = ny;
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const rotation = next();
        const large = next() !== 0;
        const sweep = next() !== 0;
        const nx = ox + next();
        const ny = oy + next();
        sampleArc(x, y, rx, ry, rotation, large, sweep, nx, ny, add);
        x = nx;
        y = ny;
        break;
      }
      case 'Z':
        x = startX;
        y = startY;
        break;
    }
    lastControl = control;
  }
  if (minX === Infinity) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type Add = (x: number, y: number) => void;

function sampleCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  add: Add,
): void {
  for (let s = 1; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const u = 1 - t;
    add(
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    );
  }
}

function sampleQuad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  add: Add,
): void {
  for (let s = 1; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const u = 1 - t;
    add(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

/** The signed angle from vector u to vector v. */
function angle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/** Endpoint-to-centre arc conversion (SVG 1.1, appendix F.6.5), then sampling. */
function sampleArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  add: Add,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    add(x2, y2);
    return;
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = SAMPLES * 2;
  for (let s = 1; s <= steps; s++) {
    const t = theta1 + (delta * s) / steps;
    add(
      cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    );
  }
}
