import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const REACT = ['react', 'react-dom', '@istar-ts/react', '@xyflow/react'];

function importsOf(file: string): string[] {
  const text = readFileSync(join(root, 'src', `${file}.ts`), 'utf8');
  return [...text.matchAll(/from '([^']+)'/g)].map(([, from]) => from!);
}

describe('@istar-ts/dsm3-nfr package.json', () => {
  test('react is a peer dependency, optional, not a hard dependency', () => {
    expect(Object.keys(pkg.dependencies)).not.toContain('@istar-ts/react');
    for (const name of ['@istar-ts/react', 'react', 'react-dom']) {
      expect(pkg.peerDependencies[name]).toBeDefined();
      expect(pkg.peerDependenciesMeta[name]).toEqual({ optional: true });
    }
  });

  test("the metamodel entry point's import graph never reaches React", () => {
    const seen = new Set<string>();
    const queue = ['headless'];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const from of importsOf(file)) {
        expect(REACT).not.toContain(from);
        if (from.startsWith('./')) queue.push(from.slice(2));
      }
    }
    // Sanity check: the traversal actually walked past the entry point itself.
    expect(seen.size).toBeGreaterThan(1);
  });
});
