import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// #142: the canvas asks the dispatcher (`requestCheckEdge`) instead of calling `canLink`
// directly. Enforces the issue's grep check so no future edit brings it back.
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path);
  }
  return files;
}

describe('no canLink import in packages/react/src', () => {
  test('none of the source files import it', () => {
    const srcDir = join(import.meta.dirname, '../src');
    const offenders = sourceFiles(srcDir).filter((file) =>
      /\bcanLink\b/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    );
    expect(offenders).toEqual([]);
  });
});
