import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// One port per checkout: several git worktrees running `pnpm e2e` at once must not reuse each
// other's dev server (they may hold different code). `E2E_PORT` overrides it.
const checkoutPort =
  4200 +
  (createHash('sha1')
    .update(fileURLToPath(import.meta.url))
    .digest()
    .readUInt16BE(0) %
    700);
const PORT = Number(process.env.E2E_PORT) || checkoutPort;

/**
 * The protocol lab e2e suite (#48): drives the playground's palette/canvas, the action log and
 * the protocol lab's tabs through real browser interaction. `webServer` runs the playground's
 * Vite dev server on a fixed port Playwright waits on before the suite starts.
 */
export default defineConfig({
  testDir: './e2e',
  // Excludes e2e/fixtures/generate-sample-log.test.ts, a one-off fixture generator, not a test.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Reusing a running server is opt-in (E2E_REUSE=1): with a per-checkout port it is this
    // checkout's own `pnpm dev`, never another worktree's.
    reuseExistingServer: !process.env.CI && process.env.E2E_REUSE === '1',
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Wider than `devices['Desktop Chrome']`'s default 1280: at 1280 the sidebar's last lab
        // tab sits past the viewport's right edge, where nothing can scroll it into view (the
        // layout, not the sidebar, would need to scroll) — Playwright's click then never lands.
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
});
