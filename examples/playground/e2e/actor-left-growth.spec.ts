import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { dragNodeBy, nodeById } from './helpers';

/**
 * `/both.html?server=worker&latency=NNN` (see `WorkerBothApp.tsx`'s `delayed`): the mirror
 * store's dispatch is delayed `NNN`ms before it reaches the worker, so its echo lags the
 * canvas's optimistic hold (`IstarCanvas`'s `pendingMoves`/#266) the way a real network would.
 *
 * Growing an actor's boundary to the right by dragging a child out never moved the actor's own
 * origin (`actorBounds`' `x`/`y`), so a held position and its later echo always agreed. Growing
 * it to the left does move the origin — every other child's drawn position is relative to it —
 * and two bugs made the held box disagree with the echoed one while more than one move was in
 * flight at once: `onNodeDragStop` computed a second drag's new position from the store's stale
 * (pre-hold) coordinates instead of the held one, and an older move's resolved dispatch cleared
 * a newer hold on the same element before *its* dispatch had resolved. Both are fixed in
 * `IstarCanvas.tsx`; this pins the fix with the exact sequence from the bug report.
 *
 * Ids are `fixtures/pistar/welcome.txt`'s own (as `worker-mirror.spec.ts`/`cross-client.spec.ts`
 * use): the "piStar tool v2.1.0" actor (`530,55`, no saved size — its box is `actorBounds`'
 * fresh one) and two of its tasks.
 */
const ID = {
  piStarTool: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
  leftChild: 'f9035e8c-0294-44a8-a93e-85a349d2f21a',
  otherChild: 'c9d1ae28-8b77-4643-a7ac-7e70903dadb7',
} as const;

const LATENCY_MS = 150;

function reactActorNode(page: Page) {
  return page.locator(`.pg-both-react .react-flow__node[data-id="${ID.piStarTool}"]`);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sample extends Box {
  t: number;
}

/** Rounded so sub-pixel zoom noise doesn't manufacture a spurious distinct box. */
function roundBox(box: Box): Box {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Samples `selector`'s bounding box (and `performance.now()`) every animation frame, starting
 * now and until `stop()`, so a settle window can be checked by wall-clock time rather than by
 * sample index (every `await` between gestures, like the drags themselves, takes a variable
 * number of frames).
 */
async function startBoxSampler(
  page: Page,
  selector: string,
): Promise<{ stop(): Promise<Sample[]>; now(): Promise<number> }> {
  await page.evaluate((sel) => {
    const samples: Sample[] = [];
    (window as unknown as { __boxSamples: Sample[] }).__boxSamples = samples;
    const el = document.querySelector(sel);
    if (!el) throw new Error(`startBoxSampler: no element matches "${sel}"`);
    let raf = 0;
    const tick = (): void => {
      const r = el.getBoundingClientRect();
      samples.push({ x: r.x, y: r.y, width: r.width, height: r.height, t: performance.now() });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { __boxSamplerRaf: number }).__boxSamplerRaf = raf;
  }, selector);
  return {
    async stop() {
      return page.evaluate(() => {
        cancelAnimationFrame((window as unknown as { __boxSamplerRaf: number }).__boxSamplerRaf);
        return (window as unknown as { __boxSamples: Sample[] }).__boxSamples;
      });
    },
    now() {
      return page.evaluate(() => performance.now());
    },
  };
}

/** Consecutive duplicates collapsed to one entry each, rounded. */
function distinctRuns(samples: Box[]): Box[] {
  const runs: Box[] = [];
  for (const sample of samples) {
    const box = roundBox(sample);
    if (runs.length === 0 || !sameBox(runs[runs.length - 1]!, box)) runs.push(box);
  }
  return runs;
}

/** Every sampled box from `sinceMs` onward, as `distinctRuns` would collapse them. */
function runsSince(samples: Sample[], sinceMs: number): Box[] {
  return distinctRuns(samples.filter((sample) => sample.t >= sinceMs));
}

test.describe('an actor grown past its left edge, over a mirror store with latency', () => {
  // As `worker-mirror.spec.ts`: both panes need room, though only the React one is asserted on.
  test.use({ viewport: { width: 3200, height: 1000 } });

  test('the boundary holds continuously through the drag, drop and echo, with no flicker', async ({
    page,
  }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto(`/both.html?server=worker&latency=${LATENCY_MS}`);
    await expect(reactActorNode(page)).toBeVisible();
    await expect(nodeById(page, ID.leftChild)).toBeVisible();
    await expect(nodeById(page, ID.otherChild)).toBeVisible();
    // Let the initial fit settle before sampling, so it isn't read as a spurious box change.
    await page.waitForTimeout(200);

    const sampler = await startBoxSampler(
      page,
      `.pg-both-react .react-flow__node[data-id="${ID.piStarTool}"]`,
    );

    // Drag the left child 150px past the actor's left edge and drop.
    await dragNodeBy(page, nodeById(page, ID.leftChild), -150, 0);
    // Move the other child while the first drop's echo (still `LATENCY_MS` away) is pending:
    // both dispatches are now in flight together, the race the bug needed.
    await dragNodeBy(page, nodeById(page, ID.otherChild), 0, 20);
    // The drops' own (expected, one-time) render has settled by now, before either echo could
    // possibly have arrived (`LATENCY_MS` away); from here on, both echoes landing must not
    // move the held box again.
    await page.waitForTimeout(50);
    const droppedFirstPair = await sampler.now();
    await page.waitForTimeout(LATENCY_MS * 4);
    const afterFirstPair = runsSince(await sampler.stop(), droppedFirstPair);
    expect(afterFirstPair.length).toBeLessThanOrEqual(1);

    // Drag the left child back inside, past the (bugged) hold described in the report.
    const resumed = await startBoxSampler(
      page,
      `.pg-both-react .react-flow__node[data-id="${ID.piStarTool}"]`,
    );
    await dragNodeBy(page, nodeById(page, ID.leftChild), 150, 0);
    await page.waitForTimeout(50);
    const droppedThird = await resumed.now();
    await page.waitForTimeout(LATENCY_MS * 4);
    const afterThird = runsSince(await resumed.stop(), droppedThird);
    expect(afterThird.length).toBeLessThanOrEqual(1);

    expect(errors).toEqual([]);
  });
});
