/**
 * NFR shapes, from DSM3-goals' `language_nfr_shapes.js` (https://www.cin.ufpe.br/~jhcp/dsm3goals/,
 * read 2026-10-16; no licence stated, see docs/dsm3-goals.md). All three nodes are the same
 * cloud, 90×55, scaled to the element; Operationalization draws it bold, Claim dashed.
 */
import type { KindShape } from '@istar-ts/core';
import type { NfrElementKind } from './kinds';

/** DSM3's cloud (drawn with `resetOffset`, so its bounds are scaled to the element). */
export const NFR_CLOUD_PATH =
  'M 0 0 a 26.1831 26.1831 0 0 1 25 -3 a 18.8816 18.8816 0 0 1 27 -5 a 15.2684 15.2684 0 0 1 17.4999 3.25 a 19.182 19.182 0 0 1 24 -5 a 11.2361 11.2361 0 0 1 14.5 6.5 a 7.5085 7.5085 0 0 1 7 9 a 6.51159 6.51159 0 0 1 2.5 9.99998 a 7.67717 7.67717 0 0 1 -9 9.5 a 18.0487 18.0487 0 0 1 -17.25 3.625 a 41.1115 41.1115 0 0 1 -50.25 4.25 a 20.8059 20.8059 0 0 1 -22.25 0.25 a 28.5345 28.5345 0 0 1 -19.75 -6 a 12.0307 12.0307 0 0 1 -2.75 -21.75 a 6.06009 6.06009 0 0 1 3.74945 -5.62563 Z';

export const NFR_SHAPES: Readonly<Record<NfrElementKind, KindShape>> = {
  'nfr.NFR': { path: NFR_CLOUD_PATH, strokeWidth: 2 },
  'nfr.Operationalization': { path: NFR_CLOUD_PATH, strokeWidth: 5 },
  'nfr.Claim': { path: NFR_CLOUD_PATH, strokeWidth: 1, dash: '10,5' },
};

/** Link target markers (JointJS convention: (0,0) is the link end, +x towards the source). */
/** And-refinement: a bar across the line. */
export const NFR_AND_MARKER = 'm 10,-6 l 0,12';
/** Or-refinement: a filled triangle. */
export const NFR_OR_MARKER = 'm 12,-6 l -12,6 12,6 z';
