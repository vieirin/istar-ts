import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(
        new URL('../../packages/actions/src/index.ts', import.meta.url),
      ),
      '@istar-ts/agent': fileURLToPath(
        new URL('../../packages/agent/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'playground',
    environment: 'node',
    // The Playwright suite lives under e2e/ with its own runner (`pnpm --filter playground e2e`).
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
