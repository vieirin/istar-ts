// Pins the React Flow graph of an iStar 2.0 model, so the DSM3 work (hubs, link anchors, root
// registries) provably leaves iStar layouts unchanged. Written before that work began.
import { parsePistar } from '@istar-ts/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { defaultRegistry, modelToFlow } from '../src';

const labSamples = readFileSync(
  join(
    import.meta.dirname,
    '../../../fixtures/goal-controller/dissertationExamples/labSamples.txt',
  ),
  'utf8',
);

test('modelToFlow(labSamples) is unchanged', () => {
  const { nodes, edges, origins } = modelToFlow(parsePistar(labSamples), defaultRegistry);
  expect({ nodes, edges, origins: [...origins] }).toMatchSnapshot();
});
