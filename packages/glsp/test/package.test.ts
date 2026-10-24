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

test('the entry point loads reflect-metadata before anything else', () => {
  const index = readFileSync(join(root, 'src/index.ts'), 'utf8');
  expect(index.split('\n').find((line) => line.startsWith('import'))).toBe(
    "import 'reflect-metadata';",
  );
});
