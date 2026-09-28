import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const FIXTURES_DIR: string = join(import.meta.dirname, '../../../fixtures');

export interface Fixture {
  name: string;
  text: string;
}

/** Every file under fixtures/, recursively. Names contain spaces and parentheses. */
export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { name: relative(FIXTURES_DIR, path), text: readFileSync(path, 'utf8') };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
