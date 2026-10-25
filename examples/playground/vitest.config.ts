import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(
        new URL('../../packages/actions/src/index.ts', import.meta.url),
      ),
      '@istar-ts/react': fileURLToPath(
        new URL('../../packages/react/src/index.ts', import.meta.url),
      ),
      // Before '@istar-ts/glsp', which would otherwise match these subpaths as a prefix.
      '@istar-ts/glsp/browser': fileURLToPath(
        new URL('../../packages/glsp/src/browser.ts', import.meta.url),
      ),
      '@istar-ts/glsp/kaos': fileURLToPath(
        new URL('../../packages/glsp/src/kaos.ts', import.meta.url),
      ),
      '@istar-ts/glsp/nfr': fileURLToPath(
        new URL('../../packages/glsp/src/nfr.ts', import.meta.url),
      ),
      '@istar-ts/glsp': fileURLToPath(new URL('../../packages/glsp/src/index.ts', import.meta.url)),
      '@istar-ts/dsm3-kaos/metamodel': fileURLToPath(
        new URL('../../packages/dsm3-kaos/src/headless.ts', import.meta.url),
      ),
      '@istar-ts/dsm3-nfr/metamodel': fileURLToPath(
        new URL('../../packages/dsm3-nfr/src/headless.ts', import.meta.url),
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
