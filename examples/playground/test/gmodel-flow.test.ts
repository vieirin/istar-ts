/**
 * One graph for both clients (#143, #165): the React canvas's nodes and edges are derived from
 * the GModel, the same schema `@istar-ts/glsp`'s server sends its clients. For every fixture,
 * React Flow's graph built from the server's `setModel` (as it arrives on the wire, types
 * overrides included) is the one `<IstarCanvas>` draws, every element's box is the server's,
 * and every element and link keeps its custom properties. Reuses `@istar-ts/glsp`'s fixture
 * loader and in-process server (the single source of truth for which contribution opens which
 * fixture), since this package depends on both clients and `@istar-ts/glsp` must not.
 *
 * Replaces the geometry-parity test (#95), which compared `modelToFlow`'s own walk with the
 * server's GModel and became trivially true once the canvas drew the GModel.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { GGraphSchema, GModelChildSchema } from '@istar-ts/gmodel';
import { isGNodeSchema, modelToGModelSchema } from '@istar-ts/gmodel';
import type { AnyIstarRegistry } from '@istar-ts/react';
import { gmodelToFlow, registryForMetamodel, registrySizes } from '@istar-ts/react';
import type { IstarGlspContribution } from '@istar-ts/glsp';
import { createIstarServerModules, memoryPistarFiles } from '@istar-ts/glsp';
import { loadFixtures, parseFixture } from '../../../packages/glsp/test/fixtures';
import { openOn, startServer } from '../../../packages/glsp/test/server';

const fixtures = loadFixtures();

/** A contribution's React registry, and the contribution sending the GModel at its sizes. */
function withRegistry(contribution: IstarGlspContribution) {
  const registry = registryForMetamodel(contribution.metamodel) as unknown as AnyIstarRegistry;
  return { registry, contribution: { ...contribution, sizes: registrySizes(registry) } };
}
const byContribution = new Map(
  [...new Set(fixtures.map((f) => f.contribution))].map((c) => [c, withRegistry(c)]),
);

/** Absolute boxes of the GModel's element nodes (anchors aside), by id. */
function gmodelBoxes(schema: GGraphSchema) {
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const walk = (children: readonly GModelChildSchema[], origin: { x: number; y: number }) => {
    for (const child of children) {
      if (!isGNodeSchema(child) || !child.args) continue;
      const at = { x: origin.x + child.position.x, y: origin.y + child.position.y };
      boxes.set(child.id, { ...at, ...child.size });
      walk(child.children, at);
    }
  };
  walk(schema.children, { x: 0, y: 0 });
  return boxes;
}

describe('the React canvas draws the GModel the GLSP server sends', () => {
  let glsp: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    const files = new Map(fixtures.map((f) => [f.name, f.text]));
    glsp = await startServer(
      files,
      createIstarServerModules({
        contributions: [...byContribution.values()].map(({ contribution }) => contribution),
        files: memoryPistarFiles(files),
      }),
    );
  });

  test.each(fixtures.map((f, i) => [f.name, f, i] as const))('%s', async (_, f, i) => {
    const { registry, contribution } = byContribution.get(f.contribution)!;
    const s = await openOn(glsp.server, glsp.sent, contribution, f.name, { clientId: `flow-${i}` });
    const wire = JSON.parse(JSON.stringify(s.root)) as GGraphSchema;
    glsp.server.disposeClientSession({ clientSessionId: s.clientId });

    // What `<IstarCanvas>` derives from the same model.
    const model = parseFixture(f);
    const metamodel = metamodelOf(model) as AnyMetamodel;
    const canvas = gmodelToFlow(
      modelToGModelSchema(model, { sizes: registrySizes(registry) }),
      metamodel,
      registry,
    );
    expect(gmodelToFlow(wire, metamodel, registry)).toEqual(canvas);

    // Every element's box is the server's.
    const drawn = new Map(
      canvas.nodes
        .filter((node) => node.type !== 'istarLinkAnchor')
        .map((node) => [
          node.id,
          { ...canvas.origins.get(node.id)!, width: node.width, height: node.height },
        ]),
    );
    expect(drawn).toEqual(gmodelBoxes(wire));

    // What the components draw keeps the model's kinds and custom properties.
    for (const node of canvas.nodes) {
      if (node.type === 'istarLinkAnchor') continue;
      const element = model.elements.get(node.id)!;
      expect(node.data.element.kind).toBe(element.kind);
      expect(node.data.element.customProperties).toEqual(element.customProperties);
    }
    for (const edge of canvas.edges) {
      const link = model.links.get(edge.id)!;
      expect(edge.data!.link.kind).toBe(link.kind);
      expect(edge.data!.link.customProperties).toEqual(link.customProperties);
    }
  });
});
