/**
 * Geometry parity between the two clients (#95, #144 stage 2): React Flow's `modelToFlow` and
 * `@eclipse-glsp/server`'s `modelToGModel` draw an actor's boundary with the same core function
 * (`actorBounds`), so for every fixture every actor's box must be identical. Reuses
 * `@istar-ts/glsp`'s fixture loader (the single source of truth for which contribution opens
 * which fixture) since this package depends on both clients and `@istar-ts/glsp` must not.
 */
import { describe, expect, test } from 'vitest';
import { metamodelOf } from '@istar-ts/core';
import type { AnyMetamodel } from '@istar-ts/core';
import { modelToFlow } from '@istar-ts/react';
import { modelToGModel } from '@istar-ts/glsp';
import { loadFixtures, parseFixture } from '../../../packages/glsp/test/fixtures';

/** The subset of GLSP's `GNode` this test reads, without a direct `@eclipse-glsp/server` dependency. */
interface PositionedSizedNode {
  readonly position: { readonly x: number; readonly y: number };
  readonly size: { readonly width: number; readonly height: number };
}

const fixtures = loadFixtures();

describe('an actor draws the same box in both clients', () => {
  test.each(fixtures.map((f) => [f.name, f] as const))('%s', (_, f) => {
    const model = parseFixture(f);
    const metamodel = metamodelOf(model) as AnyMetamodel;
    const actors = [...model.elements.values()].filter(
      (e) => metamodel.elements.get(e.kind)?.category === 'actor',
    );
    if (actors.length === 0) return;

    const flow = modelToFlow(model);
    const graph = modelToGModel(model, f.contribution.types ? { types: f.contribution.types } : {});

    for (const actor of actors) {
      const reactNode = flow.nodes.find((n) => n.id === actor.id);
      const glspNode = graph.children.find((c) => c.id === actor.id) as
        | PositionedSizedNode
        | undefined;
      expect(reactNode, `react node for ${actor.id}`).toBeDefined();
      expect(glspNode, `glsp node for ${actor.id}`).toBeDefined();
      const reactBox = {
        x: reactNode!.position.x,
        y: reactNode!.position.y,
        width: reactNode!.width,
        height: reactNode!.height,
      };
      const glspBox = {
        x: glspNode!.position.x,
        y: glspNode!.position.y,
        width: glspNode!.size.width,
        height: glspNode!.size.height,
      };
      expect(reactBox, `${f.name}: actor ${actor.id}`).toEqual(glspBox);
    }
  });
});
