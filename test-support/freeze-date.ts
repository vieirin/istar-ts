/**
 * Freezes `Date` to a fixed instant before every test, so two `new Date()` calls in the same
 * test (e.g. `toPistar`'s `saveDate` stamp) can never straddle a wall-clock second and flake a
 * comparison (#41, #119, #168, #228). Only `Date` is faked (`toFake: ['Date']`): timers,
 * microtasks, `performance.now()` and React's scheduler all run normally.
 *
 * Every project's `vitest.config.ts` lists this as a `setupFiles` entry. A test that genuinely
 * needs the real clock calls `useRealDate()` (see `./use-real-date.ts`).
 */
import { afterEach, beforeEach, vi } from 'vitest';

export const FROZEN_DATE: Date = new Date('2024-01-01T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});
