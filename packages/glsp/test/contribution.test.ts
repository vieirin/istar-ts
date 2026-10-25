/**
 * `contributionFor` (#151): builds an `IstarGlspContribution` from any metamodel at runtime,
 * with no per-dialect code. `ISTAR_GLSP`, `KAOS_GLSP`, `KAOS_OBSTACLES_GLSP` and `NFR_GLSP` are
 * just calls to it with their own palette and schemas; this checks their outputs are unchanged,
 * and that a synthetic `extendMetamodel` dialect with none of its own gets a usable fallback.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AnyMetamodel } from '@istar-ts/core';
import { ISTAR_2_0, extendMetamodel } from '@istar-ts/core';
import {
  ISTAR_GLSP,
  contributionFor,
  createIstarSharedModel,
  gmodelTypeHints,
  gmodelTypes,
  paletteOf,
} from '../src';
import type { IstarGlspContribution } from '../src';
import { serveIstarGlsp } from '../src/browser';
import { KAOS_GLSP, KAOS_OBSTACLES_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).toReversed()) await fn();
});

// A dialect built the way a host's own `extendMetamodel` result would be: a new element kind and
// a new link kind with a declarative rule, neither of which `@istar-ts/glsp` knows by name.
const SYNTHETIC = extendMetamodel(ISTAR_2_0 as unknown as AnyMetamodel, {
  name: 'synthetic',
  elements: [{ kind: 'synthetic.Widget', category: 'node' }],
  links: [
    {
      kind: 'synthetic.WidgetLink',
      category: 'node',
      rules: { sources: ['synthetic.Widget'], targets: ['synthetic.Widget'] },
    },
  ],
});

describe.each([
  ['istar', ISTAR_GLSP],
  ['kaos', KAOS_GLSP],
  ['kaos-obstacles', KAOS_OBSTACLES_GLSP],
  ['nfr', NFR_GLSP],
])('contributionFor reproduces %s unchanged', (_, before: IstarGlspContribution) => {
  test('same diagram type, metamodel, palette and schemas', () => {
    const rebuilt = contributionFor(before.metamodel, {
      diagramType: before.diagramType,
      ...(before.palette ? { palette: before.palette } : {}),
      ...(before.schemas ? { schemas: before.schemas } : {}),
    });
    expect(rebuilt).toEqual(before);
  });
});

describe('a synthetic extendMetamodel dialect', () => {
  const contribution = contributionFor(SYNTHETIC);

  test('the GModel types include the new kinds', () => {
    const types = gmodelTypes(contribution.metamodel, contribution.types);
    expect(types.all).toContain('node:synthetic.Widget');
    expect(types.all).toContain('edge:synthetic.WidgetLink');
  });

  test('the type hints include the new kinds, with the new link rule', () => {
    const types = gmodelTypes(contribution.metamodel, contribution.types);
    const hints = gmodelTypeHints(contribution.metamodel, types);
    expect(hints.shapeTypeHints.map((h) => h.elementTypeId)).toContain('node:synthetic.Widget');
    const edge = hints.edgeTypeHints.find((h) => h.elementTypeId === 'edge:synthetic.WidgetLink')!;
    expect(edge.sourceElementTypeIds).toEqual(['node:synthetic.Widget']);
    expect(edge.targetElementTypeIds).toEqual(['node:synthetic.Widget']);
  });

  test('the fallback palette offers both new kinds', () => {
    const palette = paletteOf(contribution);
    expect(palette.elements['synthetic.Widget']).toMatchObject({ label: 'Widget' });
    expect(palette.links['synthetic.WidgetLink']).toMatchObject([{ label: 'WidgetLink' }]);
  });

  test('the MCP element-types reply includes both new kinds', async () => {
    const shared = createIstarSharedModel(contribution);
    const server = serveIstarGlsp({ shared, mcp: true, contributions: [contribution] });
    cleanup.push(() => server.close());
    const client = new Client({ name: 'istar-glsp-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
    );
    cleanup.push(() => client.close());
    const types = await client.callTool({
      name: 'element-types',
      arguments: { sessionId: server.sessionId! },
    });
    const content = types.structuredContent as {
      nodeTypes: Array<{ id: string }>;
      edgeTypes: Array<{ id: string }>;
    };
    expect(content.nodeTypes.map((t) => t.id)).toContain('node:synthetic.Widget');
    expect(content.edgeTypes.map((t) => t.id)).toContain('edge:synthetic.WidgetLink');
  });
});
