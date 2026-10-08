import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const FIXTURES_DIR: string = join(import.meta.dirname, '../../../fixtures');

export interface Fixture {
  name: string;
  text: string;
}

/**
 * Every file under fixtures/, recursively, except `fixtures/extensions/` (models of extended
 * metamodels, which iStar 2.0 can't read). Names contain spaces and parentheses.
 */
export function loadFixtures(): Fixture[] {
  return loadAll().filter((f) => !f.name.startsWith('extensions/'));
}

/** Models under fixtures/extensions/, which need their extension to load. */
export function loadExtensionFixtures(): Fixture[] {
  return loadAll().filter((f) => f.name.startsWith('extensions/'));
}

function loadAll(): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { name: relative(FIXTURES_DIR, path), text: readFileSync(path, 'utf8') };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
