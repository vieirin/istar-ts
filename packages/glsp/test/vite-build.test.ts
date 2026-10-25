/**
 * The worker entry builds with Vite, in a minimal page (`vite-fixture/`): the page imports
 * `@istar-ts/glsp/page`, its module worker `@istar-ts/glsp/browser`. So does a page serving
 * MCP itself (`mcp.html`: `serveIstarGlsp` with `mcp`). The build only; the sizes are logged
 * (and reported in the PR).
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

function size(bytes: Buffer): string {
  return `${kB(bytes.length)} (gzip ${kB(gzipSync(bytes).length)})`;
}

async function buildFixture(page: string): Promise<string> {
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
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: { input: join(root, page) },
    },
  });
  return outDir;
}

test('the worker entry builds with Vite', { timeout: 60_000 }, async () => {
  const outDir = await buildFixture('index.html');
  const assets = join(outDir, 'assets');
  const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
  const worker = files.find((f) => f.startsWith('worker'));
  const page = files.find((f) => f.startsWith('index'));
  expect(worker).toBeDefined();
  expect(page).toBeDefined();
  const sizes = Object.fromEntries(
    [worker!, page!].map((f) => [
      f.startsWith('worker') ? 'worker' : 'page',
      size(readFileSync(join(assets, f))),
    ]),
  );
  console.log('vite build:', sizes);
  // The page stays free of the GLSP server.
  const pageText = readFileSync(join(assets, page!), 'utf8');
  expect(pageText).not.toContain('GLSPServer');
  expect(readFileSync(join(assets, worker!), 'utf8')).toContain('istar.dispatcherPort');
});

test(
  'a page serving MCP builds with Vite, server-mcp in a lazy chunk',
  { timeout: 60_000 },
  async () => {
    const assets = join(await buildFixture('mcp.html'), 'assets');
    const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
    const texts = new Map(files.map((f) => [f, readFileSync(join(assets, f))]));
    const page = files.find((f) => f.startsWith('mcp'));
    expect(page).toBeDefined();
    // `@eclipse-glsp/server-mcp` (and the MCP SDK) load on demand, not with the page.
    const lazy = files.filter((f) => f !== page && texts.get(f)!.includes('mcp-init-port'));
    expect(lazy).toHaveLength(1);
    expect(texts.get(page!)!.includes('mcp-init-port')).toBe(false);
    console.log('vite build (mcp page):', {
      page: size(texts.get(page!)!),
      'server-mcp chunk': size(texts.get(lazy[0]!)!),
      total: size(Buffer.concat([...texts.values()])),
    });
  },
);
