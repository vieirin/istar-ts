/**
 * Opts the current test out of the frozen clock installed by `./freeze-date.ts`. Call it inside
 * (or in a `beforeEach` local to) a test that needs the real wall clock to pass, e.g. one
 * measuring real elapsed time. The global `afterEach` restores real timers again regardless, so
 * this only matters for code the test runs before that point.
 */
import { vi } from 'vitest';

export function useRealDate(): void {
  vi.useRealTimers();
}
