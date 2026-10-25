/**
 * Conditions (#132 scope item 2): Text (one tool, a parse check only), Actions with the
 * dispatcher's guards off, and Actions with the shield (the conflict task family's guard) on.
 * The actions conditions run over either backend (#126 D3's `ToolRegistry` abstraction): A, the
 * GLSP MCP tools (`@istar-ts/glsp`'s `serveIstarGlsp({ mcp: true })`), or B, the
 * `@istar-ts/actions` dispatcher directly.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionGuard } from '@istar-ts/actions';
import { createModelStore, parsePistar } from '@istar-ts/core';
import type { AnyIstarModel, AnyMetamodel, IstarModel, ModelStore } from '@istar-ts/core';
import { ISTAR_GLSP, paletteOf } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { createActionToolRegistry, createMcpToolRegistry, toolRefusal } from '../src';
import type { ToolRegistry } from '../src';

export type Backend = 'A' | 'B';
export type ConditionId = 'text' | 'actions-no-guard' | 'actions-shield';

export interface EvalCondition {
  readonly id: ConditionId;
  readonly description: string;
}

export const CONDITIONS: readonly EvalCondition[] = [
  { id: 'text', description: 'one replace-model(pistarJson) tool; no guard but a parse check' },
  { id: 'actions-no-guard', description: 'the actions dispatcher, guards disabled' },
  { id: 'actions-shield', description: 'the actions dispatcher, the conflict guard enabled' },
];

/**
 * The dialect rule the "conflict" task family's guard-rejected edit violates: no Task may be
 * created. Reuses `docs/action-protocol.md`'s worked-example guard verbatim, as a stand-in
 * shield for this evaluation (no modeller's own rules are hardcoded here, per `CLAUDE.md`).
 */
export const CONFLICT_GUARD: ActionGuard<string, string> = (operation) =>
  operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task'
    ? [{ elementId: '', severity: 'error', message: 'no tasks here', code: 'demo' }]
    : undefined;

export interface ConditionSetup {
  readonly tools: ToolRegistry;
  /** The model as the run has left it so far. */
  getModel(): AnyIstarModel;
  close?(): void | Promise<void>;
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setupText(model: AnyIstarModel, metamodel: AnyMetamodel): ConditionSetup {
  const box: { model: AnyIstarModel } = { model };
  const tools: ToolRegistry = {
    list: () => [
      {
        name: 'replace-model',
        description:
          'Replace the whole model with new piStar JSON. Refused if the JSON does not parse; nothing changes.',
        parameters: {
          type: 'object',
          properties: { pistarJson: { type: 'string' } },
          required: ['pistarJson'],
        },
      },
    ],
    async call(name, args) {
      if (name !== 'replace-model') return toolRefusal(`unknown tool "${name}"`, 'unknown-tool');
      const pistarJson =
        isFields(args) && typeof args.pistarJson === 'string' ? args.pistarJson : undefined;
      if (pistarJson === undefined) {
        return toolRefusal('"pistarJson" must be a string', 'invalid-arguments');
      }
      try {
        box.model = parsePistar(pistarJson, { metamodel }) as AnyIstarModel;
        return { ok: true, content: { applied: true } };
      } catch (error) {
        return toolRefusal(
          `invalid piStar JSON: ${error instanceof Error ? error.message : String(error)}`,
          'parse-error',
        );
      }
    },
  };
  return { tools, getModel: () => box.model };
}

function setupActionsB(
  model: AnyIstarModel,
  metamodel: AnyMetamodel,
  guards: readonly ActionGuard<string, string>[],
): ConditionSetup {
  const store = createModelStore(model as IstarModel) as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(store, { guards });
  return {
    tools: createActionToolRegistry(dispatcher, { metamodel }),
    getModel: () => store.getModel(),
  };
}

async function setupActionsA(
  model: AnyIstarModel,
  guards: readonly ActionGuard<string, string>[],
): Promise<ConditionSetup> {
  const store = createModelStore(model as IstarModel) as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(store, { guards, palette: paletteOf(ISTAR_GLSP) });
  const server = serveIstarGlsp({ shared: { store, dispatcher }, mcp: true });
  const client = new Client({ name: 'eval-agent', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
  );
  const tools = await createMcpToolRegistry(client, {
    boundArgs: { sessionId: server.sessionId! },
    exclude: ['save-model'],
  });
  return {
    tools,
    getModel: () => store.getModel(),
    close: async () => {
      await client.close();
      server.close();
    },
  };
}

/** A fresh setup for `condition` over `backend`, from `model`: no state shared with any other run. */
export function setupCondition(
  condition: ConditionId,
  backend: Backend,
  model: AnyIstarModel,
  metamodel: AnyMetamodel,
): ConditionSetup | Promise<ConditionSetup> {
  if (condition === 'text') return setupText(model, metamodel);
  const guards = condition === 'actions-shield' ? [CONFLICT_GUARD] : [];
  return backend === 'A' ? setupActionsA(model, guards) : setupActionsB(model, metamodel, guards);
}
