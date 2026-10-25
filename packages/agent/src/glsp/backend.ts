/**
 * Backend A (#126 §9's default): `@istar-ts/glsp`'s headless `serveIstarGlsp`
 * over the host's own store, reached by an MCP SDK client (`@istar-ts/glsp`'s README, "MCP"
 * section). `@istar-ts/glsp` is this subpath's own optional peer, not the package root's
 * (`../../package.json`): importing `@istar-ts/agent` never pulls in GLSP, only
 * `@istar-ts/agent/glsp` does (#232).
 *
 * Auto mode uses one live session, opened on first open and kept for the host's session's
 * lifetime, over the host's own dispatcher (#131 item 6): every applied tool call is an ordinary
 * GLSP operation on that dispatcher, so it lands in the action log like any other client's edit.
 *
 * Propose mode needs a `ChangeSetTarget` with a scratch GLSP session (`@istar-ts/agent`'s README
 * flagged this as unbuilt, #130's gap): `openScratch` starts a second headless server over a
 * scratch copy of the live model (`parsePistar(toPistar(model))`, the same metamodel, guards and
 * schemas), and `apply` dispatches the operations the scratch session actually ran (recorded by
 * wrapping its dispatcher, not re-derived from the MCP calls' arguments, each with the ids it
 * created pinned as explicit ids so a later step naming one finds it on the live model too, #155)
 * to the live dispatcher as one `compound`. The scratch server is disposed once the run finishes
 * (`runAgent` calls `ScratchSession.close` itself) or the review is applied/discarded.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createActionDispatcher, injectCreatedIds, isOperation } from '@istar-ts/actions';
import type {
  ActionDispatcher,
  ActionGuard,
  ActionPostGuard,
  HostContextProvider,
  HostTool,
  IstarOperation,
} from '@istar-ts/actions';
import { createModelStore, metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type {
  AnyIstarModel,
  AnyMetamodel,
  AnyPaletteDescription,
  ModelStore,
  PropertySchema,
} from '@istar-ts/core';
import type { IstarGlspContribution } from '@istar-ts/glsp';
import { contributionFor, paletteOf } from '@istar-ts/glsp';
import type { IstarGlspMcpServer } from '@istar-ts/glsp/browser';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { createMcpToolRegistry } from '../mcp';
import type { ChangeSetEntry, ChangeSetTarget, ScratchSession } from '../change-set';
import type { ToolRegistry, ToolResult } from '../tools';
import { describeOperation } from './describe-operation';

export interface GlspMcpBackendOptions {
  readonly store: ModelStore<string, string>;
  /** The dispatcher every applied edit goes through. */
  readonly dispatcher: ActionDispatcher<string, string>;
  readonly guards?: readonly ActionGuard<string, string>[];
  /** Run after each operation on the scratch dispatcher, inside its transaction (#203): a
   * refusal surfaces at preview time, on the scratch session, rather than only at `apply`. */
  readonly postGuards?: readonly ActionPostGuard<string, string>[];
  readonly schemas?: readonly PropertySchema[];
  /** The active model's own metamodel, whatever its dialect. */
  readonly metamodel: AnyMetamodel;
  /** The active extension's own palette, if it has one; default: a palette derived from
   * `metamodel`'s kinds (`contributionFor`'s own fallback). */
  readonly palette?: AnyPaletteDescription;
  /** A host's own tools, served next to the istar tools on both the scratch and live MCP
   * servers (#175). Read-only ones (`readOnlyHint`) are not review steps in Propose mode (#156). */
  readonly hostTools?: readonly HostTool[];
  /** A host's own context providers, served as MCP resources (or read-only tools, per
   * server-mcp's `dataMode`) on both servers (#175), so a host can use `openGlspMcpSession` as
   * its only MCP server. `runAgent`'s own `context` option splices the same providers into the
   * system prompt; the two are independent. The built-in metamodel context provider (#240) is
   * prepended automatically, unless `metamodelContext` is false. */
  readonly context?: readonly HostContextProvider[];
  /**
   * Opts out of the built-in metamodel context provider every MCP session carries by default
   * (#240, `@istar-ts/glsp`'s `contextWithMetamodel`). Default true.
   */
  readonly metamodelContext?: boolean;
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
  host: {
    readonly hostTools?: readonly HostTool[];
    readonly context?: readonly HostContextProvider[];
    readonly metamodelContext?: boolean;
  } = {},
): Promise<McpConnection> {
  const server = serveIstarGlsp({
    shared: { store: store as never, dispatcher: dispatcher as never },
    mcp: { hostTools: host.hostTools, context: host.context, metamodelContext: host.metamodelContext },
    contributions: [contribution],
  });
  const client = new Client({ name: 'istar-ts-agent-glsp', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(server.mcp.url, { fetch: server.mcp.fetch }),
  );
  const registry = await createMcpToolRegistry(client, {
    boundArgs: { sessionId: server.sessionId! },
    // `save-model` hands the save to the host; a host wires its own save path.
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

/** What a successful mutating call did on the scratch session: a step of the change set (#156). */
export interface ProposedStep {
  /** As the scratch session ran them, with the ids they created pinned (#155). */
  readonly operations: readonly IstarOperation<string, string>[];
  /** `operations` in plain words, one line each. */
  readonly description: readonly string[];
  /** The ids the scratch run created, which `apply` reproduces on the live model. */
  readonly createdIds: readonly string[];
}

/** One operation the scratch session actually dispatched, the unit `glspUndo`/`glspRedo` act on
 * (#163). Since #223 a mutating tool call dispatches exactly one: its operations (e.g.
 * `create-nodes`' node + label) as one `compound`. */
interface OpRecord {
  readonly operation: IstarOperation<string, string>;
  readonly description: readonly string[];
  readonly createdIds: readonly string[];
}

/**
 * `operation` in plain words. A compound's children are described one at a time, each against
 * the model just before and after it (replayed on a copy of `before`; their created ids are
 * pinned), so a node a call created and then labelled reads "create Task 'Task'", "rename Task
 * 'Task' to 'A'", as when they were separate steps.
 */
async function describeRecorded(
  operation: IstarOperation<string, string>,
  before: AnyIstarModel,
  after: AnyIstarModel,
): Promise<readonly string[]> {
  if (operation.kind !== 'compound') return describeOperation(operation, [before, after]);
  const replay = createModelStore(before as never) as unknown as ModelStore<string, string>;
  const dispatcher = createActionDispatcher(replay);
  const lines: string[] = [];
  for (const child of operation.operationList) {
    const previous = replay.getModel();
    await dispatcher.dispatch(child);
    lines.push(...describeOperation(child, [previous, replay.getModel(), after]));
  }
  dispatcher.dispose();
  return lines;
}

function stepFromRecords(records: readonly OpRecord[]): ProposedStep {
  return {
    operations: records.map((r) => r.operation),
    description: records.flatMap((r) => r.description),
    createdIds: records.flatMap((r) => r.createdIds),
  };
}

export interface GlspChangeSet extends ChangeSetTarget {
  /**
   * `entry`'s step, or `undefined` for a call that isn't one: a read-only call, a refused one,
   * one that changed nothing (e.g. `set-view`), or one every record of which a later `undo` (in
   * the same run) has popped off the scratch session's undo stack (#163). Only steps go into
   * `apply`'s compound.
   */
  step(entry: ChangeSetEntry): ProposedStep | undefined;
  /** For a successful `undo`/`redo` call, what it undid/redid, in plain words (#163); `undefined`
   * for every other call. The review's context section shows this instead of the tool's name. */
  describeUndo(result: ToolResult): string | undefined;
}

/**
 * Propose mode over backend A: a scratch session per run, with its dispatched operations
 * recorded (keyed by the exact `ToolResult` object a call returns, so applying a reviewed,
 * possibly reordered-or-dropped subset of `entries` needs no further bookkeeping) so `apply` can
 * replay the kept ones on the live dispatcher as one `compound`. Each is recorded with the ids it
 * created injected as explicit ids (`injectCreatedIds`, as the lab's replay does): the live store
 * would otherwise mint fresh ones, and a later step naming a scratch id would be rejected (#155).
 *
 * `getOptions` is read fresh on every `openScratch`/`apply` (not once at session-open time), so
 * toggling a host's guards switch after the session is already open still reaches the next run.
 */
export function createGlspChangeSet(
  getOptions: () => GlspMcpBackendOptions,
  contribution: IstarGlspContribution,
): GlspChangeSet {
  // Each tool call's own records, fixed at call time; a record stops counting once a later
  // `undo` (anywhere in the same run) pops it off `doneStack` below (#163).
  const recordsByResult = new WeakMap<ToolResult, readonly OpRecord[]>();
  const undoDescriptions = new WeakMap<ToolResult, string>();
  // The scratch session's own undo/redo stacks, mirrored record-for-record: one per dispatched
  // operation, which is one per mutating tool call (#223 groups a call's operations into one
  // dispatch and one undo step on the scratch session's store).
  let doneStack: OpRecord[] = [];
  let redoStack: OpRecord[] = [];

  const activeStep = (result: ToolResult): ProposedStep | undefined => {
    const records = recordsByResult.get(result);
    if (!records) return undefined;
    const active = records.filter((r) => doneStack.includes(r));
    return active.length === 0 ? undefined : stepFromRecords(active);
  };

  return {
    async openScratch(): Promise<ScratchSession> {
      const options = getOptions();
      const scratchStore = copyOf(options.store);
      doneStack = [];
      redoStack = [];
      let bucket: OpRecord[] | null = null;
      let undoNotes: string[] | null = null;
      const baseDispatcher = createActionDispatcher(scratchStore, {
        ...(options.guards ? { guards: options.guards } : {}),
        ...(options.postGuards ? { postGuards: options.postGuards } : {}),
        ...(options.schemas ? { schemas: options.schemas } : {}),
        palette: paletteOf(contribution),
      });
      // `StoreActionDispatcher`-shaped (`isDirty`/`dispose` pass through), as `serveIstarGlsp`'s
      // shared model requires.
      const recordingDispatcher = {
        async dispatch(action: Parameters<ActionDispatcher<string, string>['dispatch']>[0]) {
          const before = scratchStore.getModel();
          const result = await baseDispatcher.dispatch(action);
          if (!result.ok) return result;
          if (action.kind === 'glspUndo') {
            const record = doneStack.pop();
            if (record) {
              redoStack.push(record);
              undoNotes?.push(`agent undid: ${record.description.join('; ')}`);
            }
          } else if (action.kind === 'glspRedo') {
            const record = redoStack.pop();
            if (record) {
              doneStack.push(record);
              undoNotes?.push(`agent redid: ${record.description.join('; ')}`);
            }
          } else if (isOperation(action)) {
            const pinned = injectCreatedIds(action, result.createdIds, before);
            const record: OpRecord = {
              operation: pinned,
              description: await describeRecorded(pinned, before, scratchStore.getModel()),
              createdIds: result.createdIds,
            };
            // A new step, as a store's `dispatch` does: nothing left to redo (#163).
            redoStack.length = 0;
            doneStack.push(record);
            bucket?.push(record);
          }
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
        {
          hostTools: options.hostTools,
          context: options.context,
          metamodelContext: options.metamodelContext,
        },
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
          const myBucket: OpRecord[] = [];
          const myUndoNotes: string[] = [];
          bucket = myBucket;
          undoNotes = myUndoNotes;
          try {
            const result = await registry.call(name, args, callOptions);
            if (!result.ok) return result;
            if (myUndoNotes.length > 0) {
              // `undo`/`redo` are not review steps themselves (#163): the context section shows
              // what they did instead.
              undoDescriptions.set(result, myUndoNotes.join('; '));
              return result;
            }
            if (readOnlyNames.has(name) || myBucket.length === 0) return result;
            const step = stepFromRecords(myBucket);
            // The review shows them (`resultText`); the model never reads `createdIds`.
            const proposed: ToolResult = { ...result, createdIds: step.createdIds };
            recordsByResult.set(proposed, myBucket);
            return proposed;
          } finally {
            bucket = null;
            undoNotes = null;
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
      const operationList = entries.flatMap((entry) => activeStep(entry.result)?.operations ?? []);
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
    step: (entry) => activeStep(entry.result),
    describeUndo: (result) => undoDescriptions.get(result),
  };
}

export interface GlspMcpSession {
  /** Auto mode's tools, over the live model, through the host's own dispatcher. */
  readonly liveRegistry: ToolRegistry;
  /** Propose mode's target: a fresh scratch session per run. */
  readonly changeSet: GlspChangeSet;
  /** Closes the live session. Propose mode's scratch sessions close themselves per run. */
  close(): void;
}

/**
 * Opens backend A's session: the live MCP server (Auto mode) and the Propose-mode change set,
 * both over the live store/dispatcher. Call once per host session; `getOptions` is re-read on
 * every Propose-mode run, so guards/postGuards/schemas toggled later still apply (the live
 * session's store/dispatcher/metamodel/hostTools/context are read once, at open time, and never
 * change).
 */
export async function openGlspMcpSession(
  getOptions: () => GlspMcpBackendOptions,
): Promise<GlspMcpSession> {
  const initial = getOptions();
  const contribution = contributionFor(initial.metamodel, { palette: initial.palette });
  const live = await connectMcp(initial.store, initial.dispatcher, contribution, {
    hostTools: initial.hostTools,
    context: initial.context,
    metamodelContext: initial.metamodelContext,
  });
  return {
    liveRegistry: live.registry,
    changeSet: createGlspChangeSet(getOptions, contribution),
    close: () => {
      void live.client.close();
      live.server.close();
    },
  };
}
