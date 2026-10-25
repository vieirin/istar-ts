/**
 * Host extensions (#175): what a host application gives an agent beyond the model's metamodel —
 * context the model should read (free-text help, notation, pooled values) and extra tools
 * (lookups, external validators, edits of its own). Opaque data plus handler functions: nothing
 * here, nor in the packages that serve them, knows any host's domain.
 *
 * Defined once, a tool or provider works on every backend: `@istar-ts/glsp`'s MCP launchers
 * (`mcp: { hostTools, context }`) register them as session-scoped server-mcp handlers next to
 * the istar tools, `@istar-ts/agent`'s action backend (`createActionToolRegistry`'s and
 * `createActionChangeSet`'s `hostTools`) lists the tools next to the action tools, and
 * `runAgent`'s `context` splices the providers into the system prompt. A tool reaches the model
 * only through the `dispatcher` it is handed, so the host's guards and schemas apply and the
 * session keeps one undo stack.
 */
import type { AnyIstarModel, GoalDiagnostic } from '@istar-ts/core';
import { isRequestAction } from './actions';
import type { ActionDispatcher, ActionResult } from './dispatcher';

/** A host's knowledge for the model: a system-prompt section and/or an MCP resource. */
export interface HostContextProvider {
  /**
   * `^[a-zA-Z0-9_-]{1,64}$`: the MCP resource's name (and its tool's, when the server lists
   * resources as tools), and the section's heading unless `title` is set.
   */
  readonly name: string;
  readonly title?: string;
  /** What the resource holds, for an MCP client's catalog. Default: the title. */
  readonly description?: string;
  /** The text: fixed, or computed from the model each time it is read. */
  readonly text: string | ((model: AnyIstarModel) => string | Promise<string>);
  /** Also a section of `runAgent`'s system prompt. Default true. */
  readonly prompt?: boolean;
  /** Also an MCP resource of every diagram session. Default true. */
  readonly resource?: boolean;
}

/** What a host tool's handler is given. */
export interface HostToolContext {
  /** The model as it is now: the live one, or a Propose-mode run's scratch copy. */
  getModel(): AnyIstarModel;
  /**
   * The session's dispatcher, the only way a tool edits the model. A read-only tool's refuses
   * everything but requests (`requestModel`, `requestMarkers`, ...), with a `read-only-tool`
   * diagnostic.
   */
  readonly dispatcher: ActionDispatcher<string, string>;
  readonly signal?: AbortSignal;
}

/**
 * What a host tool answers, in `ActionResult`'s shape: `content` (any JSON value) for the model
 * to read, or a refusal with typed diagnostics it can repair against. A refused dispatch's
 * `ActionResult` is one already: `if (!result.ok) return result;`.
 */
export type HostToolResult =
  | { readonly ok: true; readonly content: unknown }
  | { readonly ok: false; readonly diagnostics: readonly GoalDiagnostic[] };

/** A tool of the host's own, served next to the istar tools. */
export interface HostTool {
  /** `^[a-zA-Z0-9_-]{1,64}$`, distinct from every other tool's. */
  readonly name: string;
  readonly title?: string;
  /** What the model reads about the tool. */
  readonly description: string;
  /**
   * JSON Schema of the arguments: an object schema (`{ type: 'object', properties, required }`).
   * Over MCP the server validates calls against it (it needs `zod` 4.2 or later, for
   * `z.fromJSONSchema`), with the session's `sessionId` added.
   */
  readonly inputSchema: { readonly [key: string]: unknown };
  /**
   * True for a tool that only reads (MCP's `readOnlyHint`): Propose mode runs it straight away
   * and never makes it a review step, and its `dispatcher` takes requests only.
   */
  readonly readOnly?: boolean;
  handler(
    args: { readonly [key: string]: unknown },
    context: HostToolContext,
  ): HostToolResult | Promise<HostToolResult>;
}

/** `dispatcher`, refusing anything but requests: what a read-only host tool is handed. */
export function readOnlyDispatcher(
  dispatcher: ActionDispatcher<string, string>,
  tool: string,
): ActionDispatcher<string, string> {
  return {
    dispatch: (action) =>
      isRequestAction(action)
        ? dispatcher.dispatch(action)
        : Promise.resolve({
            ok: false,
            diagnostics: [
              {
                elementId: '',
                severity: 'error',
                code: 'read-only-tool',
                message: `"${tool}" is read-only: it cannot dispatch ${action.kind}`,
              },
            ],
          } as ActionResult<never>),
    subscribe: (listener) => dispatcher.subscribe(listener),
  };
}

/** The context a call of `tool` gets: `dispatcher` as is, or read-only for a read-only tool. */
export function hostToolContext(
  tool: HostTool,
  dispatcher: ActionDispatcher<string, string>,
  getModel: () => AnyIstarModel,
  signal?: AbortSignal,
): HostToolContext {
  return {
    getModel,
    dispatcher: tool.readOnly ? readOnlyDispatcher(dispatcher, tool.name) : dispatcher,
    ...(signal ? { signal } : {}),
  };
}

/** A provider's text for `model`. */
export function contextText(provider: HostContextProvider, model: AnyIstarModel): Promise<string> {
  const { text } = provider;
  return Promise.resolve(typeof text === 'string' ? text : text(model));
}
