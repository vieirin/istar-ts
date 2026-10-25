/**
 * `@istar-ts/glsp/kaos`: KAOS, as DSM3-goals defines it, from `@istar-ts/dsm3-kaos`'s React-free
 * entry point. A separate entry so the package root never needs `@istar-ts/dsm3-kaos`.
 */
import type { AnyMetamodel, AnyPaletteDescription } from '@istar-ts/core';
import {
  KAOS,
  KAOS_OBSTACLES,
  KAOS_OBSTACLES_PALETTE,
  KAOS_OBSTACLE_PROPERTY_SCHEMAS,
  KAOS_PALETTE,
  KAOS_PROPERTY_SCHEMAS,
} from '@istar-ts/dsm3-kaos/metamodel';
import { contributionFor } from './contribution';
import type { IstarGlspContribution } from './contribution';

/** KAOS goal models. */
export const KAOS_GLSP: IstarGlspContribution = contributionFor(KAOS as unknown as AnyMetamodel, {
  diagramType: 'kaos',
  palette: KAOS_PALETTE as unknown as AnyPaletteDescription,
  schemas: KAOS_PROPERTY_SCHEMAS,
});

/** KAOS with obstacle analysis (obstacles, obstructions and resolutions). */
export const KAOS_OBSTACLES_GLSP: IstarGlspContribution = contributionFor(
  KAOS_OBSTACLES as unknown as AnyMetamodel,
  {
    diagramType: 'kaos-obstacles',
    palette: KAOS_OBSTACLES_PALETTE as unknown as AnyPaletteDescription,
    schemas: [...KAOS_PROPERTY_SCHEMAS, ...KAOS_OBSTACLE_PROPERTY_SCHEMAS],
  },
);
