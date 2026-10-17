import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as headless from '../src/headless';
import * as root from '../src/index';

describe('@istar-ts/dsm3-nfr/metamodel', () => {
  it('exports the metamodel, kinds and labels, each identical to the root export', () => {
    const names = Object.keys(headless).toSorted();
    expect(names).toEqual(
      [
        'NFR',
        'NFR_CONTRIBUTION_LABELS',
        'NFR_DECLARATION',
        'NFR_ELEMENT_KINDS',
        'NFR_FILL',
        'NFR_LINK_KINDS',
        'notNfrToOperationalization',
      ].toSorted(),
    );
    for (const name of names) {
      expect((headless as Record<string, unknown>)[name]).toBe(
        (root as Record<string, unknown>)[name],
      );
    }
  });

  it('does not depend on @istar-ts/react, so it can be built for require()', () => {
    const own = ['headless', 'metamodel', 'kinds'];
    for (const file of own) {
      const source = readFileSync(resolve(__dirname, `../src/${file}.ts`), 'utf8');
      expect(source, `${file}.ts`).not.toMatch(/from '@istar-ts\/react'/);
      expect(source, `${file}.ts`).not.toMatch(/from 'react/);
    }
  });
});
