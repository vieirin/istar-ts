import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        react: path.resolve(rootDir, 'react.html'),
        glsp: path.resolve(rootDir, 'glsp.html'),
      },
    },
  },
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
        find: '@istar-ts/actions',
        replacement: path.resolve(rootDir, '../../packages/actions/src/index.ts'),
      },
      // The dialects' React-free entry points (as `@istar-ts/glsp/kaos` and `/nfr` import them):
      // matched before the plain `@istar-ts/dsm3-{kaos,nfr}` aliases below, since Vite's alias
      // matching treats a string `find` as a path prefix too.
      {
        find: '@istar-ts/dsm3-kaos/metamodel',
        replacement: path.resolve(rootDir, '../../packages/dsm3-kaos/src/headless.ts'),
      },
      {
        find: '@istar-ts/dsm3-nfr/metamodel',
        replacement: path.resolve(rootDir, '../../packages/dsm3-nfr/src/headless.ts'),
      },
      {
        find: '@istar-ts/dsm3-kaos',
        replacement: path.resolve(rootDir, '../../packages/dsm3-kaos/src/index.ts'),
      },
      {
        find: '@istar-ts/dsm3-nfr',
        replacement: path.resolve(rootDir, '../../packages/dsm3-nfr/src/index.ts'),
      },
      {
        find: '@istar-ts/react',
        replacement: path.resolve(rootDir, '../../packages/react/src/index.ts'),
      },
      // The GLSP server (glsp.html only; react.html never imports these).
      {
        find: '@istar-ts/glsp/kaos',
        replacement: path.resolve(rootDir, '../../packages/glsp/src/kaos.ts'),
      },
      {
        find: '@istar-ts/glsp/nfr',
        replacement: path.resolve(rootDir, '../../packages/glsp/src/nfr.ts'),
      },
      {
        find: '@istar-ts/glsp/browser',
        replacement: path.resolve(rootDir, '../../packages/glsp/src/browser.ts'),
      },
      {
        find: '@istar-ts/glsp',
        replacement: path.resolve(rootDir, '../../packages/glsp/src/index.ts'),
      },
      {
        find: 'glsp-client',
        replacement: path.resolve(rootDir, '../glsp-client/src/index.ts'),
      },
    ],
  },
});
