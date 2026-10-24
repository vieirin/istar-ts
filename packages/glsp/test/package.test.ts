import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const REACT = ['react', 'react-dom', '@istar-ts/react', '@xyflow/react'];

test('depends on no React package, in any dependency list', () => {
  for (const list of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const name of REACT) expect(Object.keys(pkg[list] ?? {})).not.toContain(name);
  }
});

test('no source file imports React; dialects only through their React-free entry points', () => {
  for (const file of readdirSync(join(root, 'src'))) {
    const text = readFileSync(join(root, 'src', file), 'utf8');
    const imports = [...text.matchAll(/from '([^']+)'/g)].map(([, from]) => from!);
    for (const from of imports) expect(REACT).not.toContain(from);
    for (const from of imports.filter((f) => f.startsWith('@istar-ts/dsm3-'))) {
      expect(from).toMatch(/\/metamodel$/);
    }
  }
});

test.each(['index', 'node', 'browser', 'serve'])(
  'the %s entry point loads reflect-metadata before anything else',
  (entry) => {
    const text = readFileSync(join(root, `src/${entry}.ts`), 'utf8');
    expect(text.split('\n').find((line) => line.startsWith('import'))).toBe(
      "import 'reflect-metadata';",
    );
  },
);

test('the page entry point imports no GLSP, Inversify or reflect-metadata', () => {
  const text = readFileSync(join(root, 'src/page.ts'), 'utf8');
  const imports = [...text.matchAll(/from '([^']+)'|import '([^']+)'/g)].map(([, a, b]) => a ?? b);
  expect(imports.filter((from) => !from!.startsWith('@istar-ts/'))).toEqual([]);
});

test('MCP is an optional peer, pinned exactly while upstream marks it experimental', () => {
  expect(pkg.peerDependencies['@eclipse-glsp/server-mcp']).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pkg.peerDependenciesMeta['@eclipse-glsp/server-mcp']).toEqual({ optional: true });
  expect(pkg.devDependencies['@eclipse-glsp/server-mcp']).toBe(
    pkg.peerDependencies['@eclipse-glsp/server-mcp'],
  );
  expect(Object.keys(pkg.dependencies)).not.toContain('@eclipse-glsp/server-mcp');
});
