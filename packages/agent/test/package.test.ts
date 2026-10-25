/**
 * #232: `@istar-ts/agent`'s root entry point must stay GLSP- and React-free (a host that never
 * touches `/glsp` pays for neither); `@istar-ts/agent/glsp` is the only entry point allowed to
 * reach `@istar-ts/glsp`, and even it must never reach React.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const REACT = ['react', 'react-dom', '@istar-ts/react', '@xyflow/react'];
const GLSP = [
  '@istar-ts/glsp',
  '@istar-ts/glsp/browser',
  '@istar-ts/glsp/node',
  '@istar-ts/glsp/page',
];

/** `file`'s (a `src`-relative path, without `.ts`) `import ... from '...'` targets: relative
 * ones resolved to `src`-relative paths (so the traversal can follow them), package ones left
 * as is. */
function importsOf(file: string): { readonly to: string; readonly internal: boolean }[] {
  const text = readFileSync(join(root, 'src', `${file}.ts`), 'utf8');
  return [...text.matchAll(/from '([^']+)'/g)].map(([, from]) => {
    if (!from!.startsWith('.')) return { to: from!, internal: false };
    return { to: posix.join(dirname(file), from!), internal: true };
  });
}

/** Every package `entry`'s (`src`-relative, without `.ts`) import graph reaches, transitively. */
function externalImportsOf(entry: string): Set<string> {
  const external = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { to, internal } of importsOf(file)) {
      if (internal) queue.push(to);
      else external.add(to);
    }
  }
  return external;
}

describe('@istar-ts/agent package.json', () => {
  test('@istar-ts/glsp and the MCP SDK are peer dependencies, optional, not hard dependencies', () => {
    expect(Object.keys(pkg.dependencies)).not.toContain('@istar-ts/glsp');
    expect(Object.keys(pkg.dependencies)).not.toContain('@modelcontextprotocol/sdk');
    for (const name of ['@istar-ts/glsp', '@modelcontextprotocol/sdk']) {
      expect(pkg.peerDependencies[name]).toBeDefined();
      expect(pkg.peerDependenciesMeta[name]).toEqual({ optional: true });
    }
  });

  test("the root entry point's import graph never reaches @istar-ts/glsp or React", () => {
    const external = externalImportsOf('index');
    for (const from of external) {
      expect(GLSP).not.toContain(from);
      expect(REACT).not.toContain(from);
    }
    // Sanity check: the traversal actually found external imports to check.
    expect(external.size).toBeGreaterThan(0);
  });

  test("the glsp subpath's import graph reaches @istar-ts/glsp, never React", () => {
    const external = externalImportsOf('glsp');
    expect([...external].some((from) => GLSP.includes(from))).toBe(true);
    for (const from of external) expect(REACT).not.toContain(from);
  });
});
