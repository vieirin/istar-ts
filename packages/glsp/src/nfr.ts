/**
 * `@istar-ts/glsp/nfr`: the NFR Framework, as DSM3-goals defines it, from `@istar-ts/dsm3-nfr`'s
 * React-free entry point. A separate entry so the package root never needs `@istar-ts/dsm3-nfr`.
 */
import type { AnyMetamodel, AnyPaletteDescription } from '@istar-ts/core';
import { NFR, NFR_PALETTE } from '@istar-ts/dsm3-nfr/metamodel';
import { contributionFor } from './contribution';
import type { IstarGlspContribution } from './contribution';

/** NFR softgoal interdependency graphs. */
export const NFR_GLSP: IstarGlspContribution = contributionFor(NFR as unknown as AnyMetamodel, {
  diagramType: 'nfr',
  palette: NFR_PALETTE as unknown as AnyPaletteDescription,
});
