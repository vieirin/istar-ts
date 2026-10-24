import { defineConfig } from 'tsdown';

export default defineConfig({
  // One build, so the entry points share chunks (one `IstarModelState`, one service identifier).
  entry: [
    'src/index.ts',
    'src/kaos.ts',
    'src/nfr.ts',
    'src/node.ts',
    'src/browser.ts',
    'src/page.ts',
    'src/serve.ts',
  ],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  // `@istar-ts/glsp/node` and the `serve` CLI use Node's built-ins.
  deps: { neverBundle: [/^node:/] },
  dts: true,
  sourcemap: true,
  clean: true,
});
