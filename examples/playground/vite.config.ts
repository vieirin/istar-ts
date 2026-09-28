import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@istar-ts/react/styles.css',
        replacement: path.resolve(rootDir, '../../packages/react/src/styles.css'),
      },
      {
        find: '@istar-ts/core',
        replacement: path.resolve(rootDir, '../../packages/core/src/index.ts'),
      },
      {
        find: '@istar-ts/react',
        replacement: path.resolve(rootDir, '../../packages/react/src/index.ts'),
      },
    ],
  },
});
