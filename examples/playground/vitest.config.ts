import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(
        new URL('../../packages/actions/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'playground',
    environment: 'node',
  },
});
