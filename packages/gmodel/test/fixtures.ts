import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { ISTAR_2_0, parsePistar } from '@istar-ts/core';
import { KAOS, KAOS_OBSTACLES } from '@istar-ts/dsm3-kaos/metamodel';
import { NFR } from '@istar-ts/dsm3-nfr/metamodel';
import { RATIONAL_AGENTS } from '../../core/test/rationalAgents';

const FIXTURES_DIR = join(import.meta.dirname, '../../../fixtures');

/** The metamodel a fixture is opened with, as `@istar-ts/glsp`'s tests open it. */
function metamodelFor(name: string): AnyMetamodel {
  const metamodel =
    {
      'dsm3/kaos-welcome.txt': KAOS,
      'dsm3/kaos-las.txt': KAOS_OBSTACLES,
      'dsm3/nfr-welcome.txt': NFR,
      'extensions/rationalAgents.txt': RATIONAL_AGENTS,
    }[name] ?? ISTAR_2_0;
  return metamodel as unknown as AnyMetamodel;
}

export interface Fixture {
  readonly name: string;
  readonly model: AnyIstarModel;
}

/** Every file under fixtures/, parsed with its metamodel (and the file's own metamodel block). */
export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const name = relative(FIXTURES_DIR, path);
      const text = readFileSync(path, 'utf8');
      return {
        name,
        model: parsePistar(text, { metamodel: metamodelFor(name), fileMetamodel: true }),
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
