import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as headless from '../src/headless';
import * as root from '../src/index';

describe('@istar-ts/dsm3-kaos/metamodel', () => {
  it('exports the metamodel, kinds and property schemas, each identical to the root export', () => {
    const names = Object.keys(headless).toSorted();
    expect(names).toEqual(
      [
        'KAOS',
        'KAOS_DECLARATION',
        'KAOS_ELEMENT_KINDS',
        'KAOS_FILL',
        'KAOS_LINK_KINDS',
        'KAOS_OBSTACLES',
        'KAOS_OBSTACLES_PALETTE',
        'KAOS_OBSTACLE_ELEMENT_KINDS',
        'KAOS_OBSTACLE_LINK_KINDS',
        'KAOS_OBSTACLE_PROPERTY_SCHEMAS',
        'KAOS_OBSTACLE_REFINEMENT_HUB',
        'KAOS_PALETTE',
        'KAOS_PROPERTY_SCHEMAS',
        'KAOS_REFINEMENT_HUB',
        'behavioralGoalProperties',
        'conflictProperties',
        'domainPropertyProperties',
        'kaosObstacleAnalysis',
        'obstacleProperties',
        'refinementProperties',
        'resolutionProperties',
        'softgoalProperties',
      ].toSorted(),
    );
    for (const name of names) {
      expect((headless as Record<string, unknown>)[name]).toBe(
        (root as Record<string, unknown>)[name],
      );
    }
  });

  it('does not depend on @istar-ts/react, so it can be built for require()', () => {
    const own = ['headless', 'metamodel', 'obstacles', 'kinds', 'properties', 'palette'];
    for (const file of own) {
      const source = readFileSync(resolve(__dirname, `../src/${file}.ts`), 'utf8');
      expect(source, `${file}.ts`).not.toMatch(/from '@istar-ts\/react'/);
      expect(source, `${file}.ts`).not.toMatch(/from 'react/);
    }
  });
});
