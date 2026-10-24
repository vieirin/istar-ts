import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname, '../../../fixtures');

export interface Fixture {
  name: string;
  text: string;
}

/**
 * The iStar 2.0 models under fixtures/ (piStar's and goal-controller's), as core's tests load
 * them: `extensions/` and `dsm3/` need metamodels this package doesn't depend on.
 */
export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { name: relative(FIXTURES_DIR, path), text: readFileSync(path, 'utf8') };
    })
    .filter((f) => !f.name.startsWith('extensions/') && !f.name.startsWith('dsm3/'))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
