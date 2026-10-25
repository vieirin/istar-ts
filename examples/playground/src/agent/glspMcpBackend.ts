/**
 * Backend A (#126 §9's default) for the drawer: `@istar-ts/glsp`'s headless `serveIstarGlsp`
 * over the canvas's own store, reached by an MCP SDK client (`@istar-ts/glsp`'s README, "MCP"
 * section). Loaded only once the drawer opens (#131 item 1: lazy, so `/react.html`'s first load
 * never pays for GLSP, server-mcp or the MCP SDK).
 *
 * Auto mode uses one live session, opened on first open and kept for the drawer's lifetime, over
 * the host's "Agent"-tagged dispatcher (#131 item 6): every applied tool call is an ordinary
 * GLSP operation on that dispatcher, so it lands in the action log like any other client's edit.
 *
 * Propose mode needs a `ChangeSetTarget` with a scratch GLSP session (`@istar-ts/agent`'s README
 * flags this as unbuilt, #130's gap): `openScratch` starts a second headless server over a
 * scratch copy of the live model (`parsePistar(toPistar(model))`, the same metamodel, guards and
 * schemas), and `apply` dispatches the operations the scratch session actually ran (recorded by
 * wrapping its dispatcher, not re-derived from the MCP calls' arguments) to the live dispatcher
 * as one `compound`. The scratch server is disposed once the run finishes (`runAgent` calls
 * `ScratchSession.close` itself) or the review is applied/discarded.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createActionDispatcher, isOperation } from '@istar-ts/actions';
import type { ActionDispatcher, ActionGuard, IstarOperation } from '@istar-ts/actions';
import { createModelStore, metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type {
  AnyMetamodel,
  AnyPaletteDescription,
  ModelStore,
  PropertySchema,
} from '@istar-ts/core';
import type { IstarGlspContribution } from '@istar-ts/glsp';
import { contributionFor, paletteOf } from '@istar-ts/glsp';
import type { IstarGlspMcpServer } from '@istar-ts/glsp/browser';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { createMcpToolRegistry } from '@istar-ts/agent';
import type {
  ChangeSetEntry,
  ChangeSetTarget,
  ScratchSession,
  ToolRegistry,
  ToolResult,
} from '@istar-ts/agent';

export interface GlspMcpBackendOptions {
  readonly store: ModelStore<string, string>;
  /** The "Agent"-tagged dispatcher every applied edit goes through. */
  readonly dispatcher: ActionDispatcher<string, string>;
  readonly guards?: readonly ActionGuard<string, string>[];
  readonly schemas?: readonly PropertySchema[];
  /** The active model's own metamodel (`App.tsx`'s `active.metamodel`), whatever its dialect. */
  readonly metamodel: AnyMetamodel;
  /** The active extension's own palette, if it has one (`App.tsx`'s `active.palette`); default:
   * a palette derived from `metamodel`'s kinds (`contributionFor`'s own fallback). */
  readonly palette?: AnyPaletteDescription;
}

interface McpConnection {
  readonly server: IstarGlspMcpServer;
  readonly client: Client;
  readonly registry: ToolRegistry;
}

async function connectMcp(
  store: ModelStore<string, string>,
  dispatcher: ActionDispatcher<string, string>,
  contribution: IstarGlspContribution,
): Promise<McpConnection> {
  const server = serveIstarGlsp({
    shared: { store: store as never, dispatcher: dispatcher as never },
    mcp: true,
    contributions: [contribution],
  });
  const client = new Client({ name: 'istar-ts-playground-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
  );
  const registry = await createMcpToolRegistry(client, {
    boundArgs: { sessionId: server.sessionId! },
    // `save-model` hands the save to the host; the demo's own Save button already covers it.
    exclude: ['save-model'],
  });
  return { server, client, registry };
}

/** A model identical to `model`, but a different object, for a dry run to edit freely. */
function copyOf(store: ModelStore<string, string>): ModelStore<string, string> {
  const live = store.getModel();
  const scratch = parsePistar(toPistar(live), {
    metamodel: metamodelOf(live) as AnyMetamodel,
    fileMetamodel: true,
  });
  return createModelStore(scratch as never) as unknown as ModelStore<string, string>;
}

/**
 * Propose mode over backend A: a scratch session per run, with its dispatched operations
 * recorded (keyed by the exact `ToolResult` object a call returns, so applying a reviewed,
 * possibly reordered-or-dropped subset of `entries` needs no further bookkeeping) so `apply` can
 * replay the kept ones on the live dispatcher as one `compound`.
 *
 * `getOptions` is read fresh on every `openScratch`/`apply` (not once at session-open time), so
 * toggling the lab's guards switch after the drawer is already open still reaches the next run.
 */
function createGlspChangeSet(
  getOptions: () => GlspMcpBackendOptions,
  contribution: IstarGlspContribution,
): ChangeSetTarget {
  const opsByResult = new WeakMap<ToolResult, readonly IstarOperation<string, string>[]>();

  return {
    async openScratch(): Promise<ScratchSession> {
      const options = getOptions();
      const scratchStore = copyOf(options.store);
      let bucket: IstarOperation<string, string>[] | null = null;
      const baseDispatcher = createActionDispatcher(scratchStore, {
        ...(options.guards ? { guards: options.guards } : {}),
        ...(options.schemas ? { schemas: options.schemas } : {}),
        palette: paletteOf(contribution),
      });
      // `StoreActionDispatcher`-shaped (`isDirty`/`dispose` pass through), as `serveIstarGlsp`'s
      // shared model requires (`App.tsx`'s/`BothApp.tsx`'s own tagged dispatchers do the same).
      const recordingDispatcher = {
        async dispatch(action: Parameters<ActionDispatcher<string, string>['dispatch']>[0]) {
          const result = await baseDispatcher.dispatch(action);
          if (bucket && result.ok && isOperation(action)) bucket.push(action);
          return result;
        },
        subscribe: (listener: Parameters<ActionDispatcher<string, string>['subscribe']>[0]) =>
          baseDispatcher.subscribe(listener),
        isDirty: () => baseDispatcher.isDirty(),
        dispose: () => baseDispatcher.dispose(),
      } as unknown as ActionDispatcher<string, string>;
      const { server, client, registry } = await connectMcp(
        scratchStore,
        recordingDispatcher,
        contribution,
      );
      const readOnlyNames = new Set(
        registry
          .list()
          .filter((s) => s.readOnly)
          .map((s) => s.name),
      );
      const wrapped: ToolRegistry = {
        list: () => registry.list(),
        prepare: registry.prepare?.bind(registry),
        async call(name, args, callOptions) {
          const myBucket: IstarOperation<string, string>[] = [];
          bucket = myBucket;
          try {
            const result = await registry.call(name, args, callOptions);
            if (!readOnlyNames.has(name)) opsByResult.set(result, myBucket);
            return result;
          } finally {
            bucket = null;
          }
        },
      };
      return {
        registry: wrapped,
        close: () => {
          void client.close();
          server.close();
          baseDispatcher.dispose();
        },
      };
    },
    async apply(entries: readonly ChangeSetEntry[]): Promise<ToolResult> {
      const operationList = entries.flatMap((entry) =>
        entry.result.ok ? (opsByResult.get(entry.result) ?? []) : [],
      );
      if (operationList.length === 0) {
        return { ok: true, content: { createdIds: [] }, createdIds: [] };
      }
      const result = await getOptions().dispatcher.dispatch({ kind: 'compound', operationList });
      if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
      return {
        ok: true,
        content: { createdIds: result.createdIds },
        createdIds: result.createdIds,
      };
    },
  };
}

export interface GlspMcpSession {
  /** Auto mode's tools, over the live model, through the drawer's "Agent"-tagged dispatcher. */
  readonly liveRegistry: ToolRegistry;
  /** Propose mode's target: a fresh scratch session per run. */
  readonly changeSet: ChangeSetTarget;
  /** Closes the live session. Propose mode's scratch sessions close themselves per run. */
  close(): void;
}

/**
 * Opens the drawer's backend A session: the live MCP server (Auto mode) and the Propose-mode
 * change set, both over the live store/dispatcher. Call once per drawer open; `getOptions` is
 * re-read on every Propose-mode run, so guards/schemas toggled later still apply (the live
 * session's store/dispatcher/metamodel are read once, at open time, and never change).
 */
export async function openGlspMcpSession(
  getOptions: () => GlspMcpBackendOptions,
): Promise<GlspMcpSession> {
  const initial = getOptions();
  const contribution = contributionFor(initial.metamodel, { palette: initial.palette });
  const live = await connectMcp(initial.store, initial.dispatcher, contribution);
  return {
    liveRegistry: live.registry,
    changeSet: createGlspChangeSet(getOptions, contribution),
    close: () => {
      void live.client.close();
      live.server.close();
    },
  };
}
