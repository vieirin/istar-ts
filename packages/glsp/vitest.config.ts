import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(new URL('../actions/src/index.ts', import.meta.url)),
      '@istar-ts/gmodel': fileURLToPath(new URL('../gmodel/src/index.ts', import.meta.url)),
      // The dialects' React-free entry points, as `@istar-ts/glsp/kaos` and `/nfr` import them.
      '@istar-ts/dsm3-kaos/metamodel': fileURLToPath(
        new URL('../dsm3-kaos/src/headless.ts', import.meta.url),
      ),
      '@istar-ts/dsm3-nfr/metamodel': fileURLToPath(
        new URL('../dsm3-nfr/src/headless.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'glsp',
    environment: 'node',
    setupFiles: ['../../test-support/freeze-date.ts'],
  },
});
