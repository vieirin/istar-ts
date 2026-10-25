import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    setupFiles: ['../../test-support/freeze-date.ts'],
  },
});
