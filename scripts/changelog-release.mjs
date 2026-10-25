#!/usr/bin/env node
// Gathers changes/unreleased/*.md (except README.md), in name order, into a `## <version>` section
// at the top of CHANGELOG.md, then deletes the gathered fragment files. Run by the release PR:
//   pnpm changelog:release 0.15.0
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: pnpm changelog:release X.Y.Z');
  process.exit(1);
}
const dir = 'changes/unreleased';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort();
if (files.length === 0) {
  console.error(`no fragments in ${dir}/`);
  process.exit(1);
}
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (changelog.includes(`\n## ${version}\n`)) {
  console.error(`CHANGELOG.md already has a ## ${version} section`);
  process.exit(1);
}
const body = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n');
const at = changelog.search(/^## /m);
const section = `## ${version}\n\n${body}\n\n`;
const next =
  at === -1
    ? `${changelog.trimEnd()}\n\n${section}`
    : changelog.slice(0, at) + section + changelog.slice(at);
writeFileSync('CHANGELOG.md', next);
for (const f of files) rmSync(join(dir, f));
console.log(`## ${version}: gathered ${files.length} fragment(s) into CHANGELOG.md`);
