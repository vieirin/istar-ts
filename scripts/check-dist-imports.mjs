#!/usr/bin/env node
// Imports every published package's built ESM entry points (package.json "exports" → "import")
// under plain Node, so a dist that only resolves through a bundler (e.g. an extensionless deep
// import into a package without an exports map, #236) fails CI instead of a consumer's install.
// Run after `pnpm build`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Entries that need a DOM or a browser global at import time are listed here with a reason.
const SKIP = new Set([]);

let failures = 0;
for (const dir of readdirSync('packages')) {
  const pkgPath = join('packages', dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (subpath === './package.json') continue;
    const file = typeof target === 'object' ? (target.import?.default ?? target.import) : undefined;
    if (typeof file !== 'string' || !file.endsWith('.js')) continue;
    const id = `${pkg.name}${subpath === '.' ? '' : subpath.slice(1)}`;
    if (SKIP.has(id)) continue;
    try {
      await import(pathToFileURL(resolve('packages', dir, file)).href);
      console.log(`ok    ${id}`);
    } catch (error) {
      failures++;
      console.error(`FAIL  ${id}: ${error.message.split('\n')[0]}`);
    }
  }
}
if (failures > 0) process.exit(1);
