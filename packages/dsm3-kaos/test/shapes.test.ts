import { pathBounds } from '@istar-ts/react';
import { describe, expect, it } from 'vitest';
import { KAOS_ELEMENT_KINDS, KAOS_SHAPES } from '../src';

describe('KAOS_SHAPES', () => {
  it('has a shape for every KAOS node kind, on DSM3’s 130×36 drawing', () => {
    for (const kind of KAOS_ELEMENT_KINDS) {
      const shape = KAOS_SHAPES[kind];
      expect(shape.viewBox).toBe('-1 -1 132 38');
      expect(pathBounds(shape.path)).toEqual({ x: 0, y: 0, width: 130, height: 36 });
    }
  });

  it('fills every node grey, as DSM3 does', () => {
    for (const kind of KAOS_ELEMENT_KINDS) expect(KAOS_SHAPES[kind].fill).toBe('rgb(205,205,205)');
  });

  it('dashes the Softgoal as DSM3 does, and only the Softgoal', () => {
    expect(KAOS_SHAPES['kaos.Softgoal'].dash).toBe('8,4');
    const dashed = KAOS_ELEMENT_KINDS.filter((kind) => KAOS_SHAPES[kind].dash);
    expect(dashed).toEqual(['kaos.Softgoal']);
  });

  it('draws the Environment Agent as the Agent hexagon plus a stick figure', () => {
    const agent = KAOS_SHAPES['kaos.Agent'].path;
    const environment = KAOS_SHAPES['kaos.EnvironmentAgent'].path;
    expect(environment.startsWith(agent)).toBe(true);
    expect(environment.length).toBeGreaterThan(agent.length);
  });
});
