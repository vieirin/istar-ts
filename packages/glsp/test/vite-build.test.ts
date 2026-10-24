/**
 * The worker entry builds with Vite, in a minimal page (`vite-fixture/`): the page imports
 * `@istar-ts/glsp/page`, its module worker `@istar-ts/glsp/browser`. The build only; the sizes
 * are logged (and reported in the PR).
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { build, defaultClientConditions } from 'vite';

const root = join(import.meta.dirname, 'vite-fixture');
const src = join(import.meta.dirname, '../src');

function kB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

test('the worker entry builds with Vite', { timeout: 60_000 }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'istar-glsp-vite-'));
  const resolve = {
    // The workspace's sources, as the playground resolves them.
    alias: [{ find: /^@istar-ts\/glsp\/(.*)$/, replacement: `${src}/$1.ts` }],
    conditions: ['@istar-ts/source', ...defaultClientConditions],
  };
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    resolve,
    worker: { format: 'es' },
    build: { outDir, emptyOutDir: true, minify: true },
  });
  const assets = join(outDir, 'assets');
  const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
  const worker = files.find((f) => f.startsWith('worker'));
  const page = files.find((f) => f.startsWith('index'));
  expect(worker).toBeDefined();
  expect(page).toBeDefined();
  const sizes = Object.fromEntries(
    [worker!, page!].map((f) => {
      const bytes = readFileSync(join(assets, f));
      return [
        f.startsWith('worker') ? 'worker' : 'page',
        `${kB(bytes.length)} (gzip ${kB(gzipSync(bytes).length)})`,
      ];
    }),
  );
  console.log('vite build:', sizes);
  // The page stays free of the GLSP server.
  const pageText = readFileSync(join(assets, page!), 'utf8');
  expect(pageText).not.toContain('GLSPServer');
  expect(readFileSync(join(assets, worker!), 'utf8')).toContain('istar.dispatcherPort');
});
