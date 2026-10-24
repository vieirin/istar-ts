import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { parsePistar } from '@istar-ts/core';
import { RATIONAL_AGENTS } from '../../core/test/rationalAgents';
import type { IstarGlspContribution } from '../src';
import { ISTAR_GLSP } from '../src';
import { KAOS_GLSP, KAOS_OBSTACLES_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';

export const FIXTURES_DIR: string = join(import.meta.dirname, '../../../fixtures');

export interface Fixture {
  name: string;
  text: string;
  contribution: IstarGlspContribution;
}

const RATIONAL_AGENTS_GLSP: IstarGlspContribution = {
  diagramType: 'rationalAgents',
  metamodel: RATIONAL_AGENTS as unknown as AnyMetamodel,
};

/** The contribution a fixture is opened with: iStar 2.0 unless its folder says otherwise. */
function contributionFor(name: string): IstarGlspContribution {
  if (name === 'dsm3/kaos-welcome.txt') return KAOS_GLSP;
  if (name === 'dsm3/kaos-las.txt') return KAOS_OBSTACLES_GLSP;
  if (name === 'dsm3/nfr-welcome.txt') return NFR_GLSP;
  if (name === 'extensions/rationalAgents.txt') return RATIONAL_AGENTS_GLSP;
  return ISTAR_GLSP;
}

/** Every file under fixtures/, with the contribution that opens it. */
export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const name = relative(FIXTURES_DIR, path);
      return { name, text: readFileSync(path, 'utf8'), contribution: contributionFor(name) };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** A fixture's model, parsed as `IstarSourceModelStorage` parses it. */
export function parseFixture(f: Fixture): AnyIstarModel {
  return parsePistar(f.text, {
    metamodel: f.contribution.metamodel,
    fileMetamodel: f.contribution.fileMetamodel ?? true,
  });
}

export function fixture(name: string): Fixture {
  const found = loadFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
}
