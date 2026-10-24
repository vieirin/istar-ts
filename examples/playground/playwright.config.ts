import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

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
    reuseExistingServer: !process.env.CI,
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
