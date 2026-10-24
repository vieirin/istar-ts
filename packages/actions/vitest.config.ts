import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@istar-ts/dsm3-kaos/metamodel': fileURLToPath(
        new URL('../dsm3-kaos/src/headless.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'actions',
    environment: 'node',
  },
});
