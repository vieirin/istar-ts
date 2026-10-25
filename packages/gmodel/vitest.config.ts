import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(new URL('../actions/src/index.ts', import.meta.url)),
      // The dialects' React-free entry points, for the KAOS and NFR fixtures (tests only).
      '@istar-ts/dsm3-kaos/metamodel': fileURLToPath(
        new URL('../dsm3-kaos/src/headless.ts', import.meta.url),
      ),
      '@istar-ts/dsm3-nfr/metamodel': fileURLToPath(
        new URL('../dsm3-nfr/src/headless.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'gmodel',
    environment: 'node',
    setupFiles: ['../../test-support/freeze-date.ts'],
  },
});
