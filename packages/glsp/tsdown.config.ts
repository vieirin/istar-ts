import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/kaos.ts', 'src/nfr.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
});
