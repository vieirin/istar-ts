import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sources = readdirSync(join(root, 'src')).map((file) => ({
  file,
  text: readFileSync(join(root, 'src', file), 'utf8'),
}));

test('depends on @istar-ts/core and @istar-ts/actions only', () => {
  expect(Object.keys(pkg.dependencies).toSorted()).toEqual(['@istar-ts/actions', '@istar-ts/core']);
  expect(pkg.peerDependencies).toBeUndefined();
  for (const name of Object.keys(pkg.devDependencies ?? {})) {
    expect(name).not.toMatch(/^@eclipse-glsp\/|sprotty|inversify|react/);
  }
});

test('no source file imports GLSP, Sprotty, Inversify or React', () => {
  for (const { text } of sources) {
    const imports = [...text.matchAll(/from '([^']+)'|import '([^']+)'/g)].map(
      ([, a, b]) => a ?? b,
    );
    for (const from of imports) expect(from).toMatch(/^(@istar-ts\/(core|actions)$|\.\/)/);
  }
});

test('no source file names a dialect: every kind comes from the metamodel', () => {
  for (const { file, text } of sources) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect({ file, dialect: code.match(/\b(istar|kaos|nfr)\.[A-Z]\w*/)?.[0] }).toEqual({ file });
  }
});
