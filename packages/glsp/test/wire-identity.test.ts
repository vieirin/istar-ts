/**
 * The GModel the server sends, as serialized on the wire (`setModel` on open, `updateModel` after
 * a move), for every fixture, pinned by a hash of its canonical JSON. The snapshot was recorded
 * with the GLSP-builder `modelToGModel` before the GModel moved to `@istar-ts/gmodel` (#164), so a
 * refactor of the mapping must leave it unchanged.
 *
 * The one intended change since: nodes and edges carry `args` (`kind`, `customProperties`,
 * `display`, `extra`; #164's constraints) and actors carry `position` (#194). `withoutAddedArgs`
 * takes exactly those off before hashing, and `@istar-ts/gmodel`'s tests check them, so the hash
 * still covers everything else.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ContainerModule } from 'inversify';
import type { GModelElementSchema, GModelRootSchema } from '@eclipse-glsp/server';
import { ChangeBoundsOperation, ServerModule } from '@eclipse-glsp/server';
import { PistarFiles, configureIstarDiagram, memoryPistarFiles, modelToGModelSchema } from '../src';
import type { IstarGlspContribution } from '../src';
import { loadFixtures } from './fixtures';
import { next, openOn, startServer } from './server';

const fixtures = loadFixtures();
const contributions = [...new Set(fixtures.map((f) => f.contribution))];

/** Keys sorted, so the hash doesn't depend on the order the builder set fields in. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

/** Keys the GModel gained in #164, which the pre-refactor snapshot can't hold. */
const ADDED_ARGS = ['kind', 'customProperties', 'display', 'extra', 'position'];

function withoutAddedArgs(element: GModelElementSchema): GModelElementSchema {
  const { args, children, ...rest } = element as GModelElementSchema & {
    args?: Record<string, unknown>;
  };
  const kept = Object.fromEntries(
    Object.entries(args ?? {}).filter(([key]) => !ADDED_ARGS.includes(key)),
  );
  return {
    ...rest,
    ...(Object.keys(kept).length > 0 ? { args: kept } : {}),
    ...(children ? { children: children.map(withoutAddedArgs) } : {}),
  } as GModelElementSchema;
}

function hash(root: GModelRootSchema): string {
  const wire = JSON.parse(JSON.stringify(root)) as GModelRootSchema;
  const json = JSON.stringify(canonical(withoutAddedArgs(wire)));
  return createHash('sha256').update(json).digest('hex');
}

function newRoot(action: unknown): GModelRootSchema {
  return (action as { newRoot: GModelRootSchema }).newRoot;
}

async function server() {
  const files = new Map(fixtures.map((f) => [f.name, f.text]));
  return startServer(files, {
    serverModule: contributions.reduce(
      (module: ServerModule, contribution: IstarGlspContribution) =>
        configureIstarDiagram(module, contribution),
      new ServerModule(),
    ),
    modules: [
      new ContainerModule((bind) => {
        bind(PistarFiles).toConstantValue(memoryPistarFiles(files));
      }),
    ],
  });
}

describe('the GModel on the wire', () => {
  test('is unchanged for every fixture, on open and after a move', async () => {
    const { server: glsp, sent } = await server();
    const hashes: Record<string, { setModel: string; updateModel?: string }> = {};
    for (const [i, f] of fixtures.entries()) {
      const s = await openOn(glsp, sent, f.contribution, f.name, { clientId: `wire-${i}` });
      const entry: { setModel: string; updateModel?: string } = { setModel: hash(s.root) };
      // The wire is `@istar-ts/gmodel`'s schema itself, plus the root's revision.
      const schema = modelToGModelSchema(s.state.model, {
        ...(f.contribution.types ? { types: f.contribution.types } : {}),
        ...(f.contribution.sizes ? { sizes: f.contribution.sizes } : {}),
      });
      expect(JSON.parse(JSON.stringify(s.root))).toStrictEqual({
        ...schema,
        revision: s.root.revision,
      });
      // Move the first top-level node of a kind by (10, 10).
      const node = (s.root.children ?? []).find(
        (c) => c.type.startsWith('node:') && c.type !== 'node:link-anchor',
      ) as (GModelElementSchema & { position: { x: number; y: number } }) | undefined;
      const size = (node as { size?: { width: number; height: number } } | undefined)?.size;
      if (node && size) {
        const from = sent.length;
        await s.send(
          ChangeBoundsOperation.create([
            {
              elementId: node.id,
              newPosition: { x: node.position.x + 10, y: node.position.y + 10 },
              newSize: size,
            },
          ]),
        );
        entry.updateModel = hash(
          newRoot((await next(sent, 'updateModel', from, s.clientId)).action),
        );
      }
      hashes[f.name] = entry;
      glsp.disposeClientSession({ clientSessionId: s.clientId });
    }
    expect(hashes).toMatchSnapshot();
  }, 120_000);
});
