import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/glsp.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
});
