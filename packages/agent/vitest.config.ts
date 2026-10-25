import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@istar-ts/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@istar-ts/actions': fileURLToPath(new URL('../actions/src/index.ts', import.meta.url)),
      // Backend A's integration test (test/glsp-mcp.test.ts) only.
      '@istar-ts/glsp/browser': fileURLToPath(new URL('../glsp/src/browser.ts', import.meta.url)),
      '@istar-ts/glsp': fileURLToPath(new URL('../glsp/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'agent',
    environment: 'node',
  },
});
