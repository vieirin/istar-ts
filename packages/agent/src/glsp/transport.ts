/**
 * A `GlspMcpSession` across a `MessagePort`-like channel (#248): `serveGlspMcpSession` opens one
 * where the model lives (a Web Worker with the host's store and dispatcher), and
 * `connectGlspMcpSession` is the same session on the other end (the page, with a mirror store),
 * for `runAgent` and the review there.
 *
 * Framed as JSON-RPC 2.0, as `@istar-ts/actions`' dispatcher transport is (`connectDispatcher`),
 * on a port of its own: a request per call (the live registry's, the Propose change set's
 * `openScratch`/`apply`, a scratch registry's), answered with its result. Everything that crosses
 * is plain JSON: a scratch step's `ToolResult` carries its `stepId` and an `undo`/`redo`'s its
 * `undoDescription`, so the change set finds them by value. `step` stays synchronous on the
 * client: every scratch call is answered with the run's steps as they stand after it (a later
 * `undo` drops an earlier one, a `redo` brings it back, #163), and `step` reads that copy.
 */
import type { MessagePortLike } from '@istar-ts/actions';
import type { ChangeSetEntry, ScratchSession } from '../change-set';
import { errorToToolResult } from '../tools';
import type { JsonValue, ToolCallOptions, ToolRegistry, ToolResult, ToolSpec } from '../tools';
import { openGlspMcpSession } from './backend';
import type { GlspChangeSet, GlspMcpBackendOptions, GlspMcpSession, ProposedStep } from './backend';

const JSONRPC_VERSION = '2.0';

/** A run's steps after a scratch call, by `stepId`; `null` for one a later `undo` dropped. */
type StepSnapshot = Readonly<Record<string, ProposedStep | null>>;

/** What each method takes and answers. */
interface Methods {
  open: { params: null; result: { readonly tools: readonly ToolSpec[] } };
  'live.call': { params: { readonly name: string; readonly args: JsonValue }; result: ToolResult };
  'scratch.open': {
    params: null;
    result: { readonly scratch: number; readonly tools: readonly ToolSpec[] };
  };
  'scratch.call': {
    params: { readonly scratch: number; readonly name: string; readonly args: JsonValue };
    result: { readonly result: ToolResult; readonly steps: StepSnapshot };
  };
  'scratch.close': { params: { readonly scratch: number }; result: null };
  apply: { params: { readonly entries: readonly ChangeSetEntry[] }; result: ToolResult };
  close: { params: null; result: null };
}

type Method = keyof Methods;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

/** `entry`'s step on `changeSet`, by its `stepId` alone. */
function stepById(changeSet: GlspChangeSet, stepId: string): ProposedStep | undefined {
  const result: ToolResult = { ok: true, content: null, stepId };
  return changeSet.step({ toolCallId: '', name: '', args: null, result });
}

/**
 * Serves a `GlspMcpSession`, opened now with `openGlspMcpSession(getOptions)`, on `port`, for a
 * `connectGlspMcpSession` on its other end. `getOptions` is read as `openGlspMcpSession` reads it
 * (once for the live session, again on every Propose run). Returns a disposer that closes the
 * session (and any scratch session still open) and detaches the port's `onmessage`; the
 * client's own `close` does the same, but leaves the port attached.
 */
export function serveGlspMcpSession<
  E extends { readonly data: unknown } = { readonly data: unknown },
>(port: MessagePortLike<E>, getOptions: () => GlspMcpBackendOptions): () => void {
  const opening = openGlspMcpSession(getOptions);
  // Reported to the client's `open`, not here.
  opening.catch(() => undefined);
  const scratches = new Map<number, { session: ScratchSession; steps: Set<string> }>();
  const calls = new Map<number | string, AbortController>();
  let nextScratch = 0;
  let closed = false;

  const closeScratch = (scratch: number): void => {
    scratches.get(scratch)?.session.close?.();
    scratches.delete(scratch);
  };
  const closeAll = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const scratch of scratches.keys()) closeScratch(scratch);
    for (const controller of calls.values()) controller.abort();
    const session = await opening.catch(() => undefined);
    session?.close();
  };

  const handle = async (
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (method === 'close') {
      await closeAll();
      return null;
    }
    if (closed) throw new Error('the session is closed');
    const session = await opening;
    switch (method as Method) {
      case 'open':
        return { tools: session.liveRegistry.list() } satisfies Methods['open']['result'];
      case 'live.call':
        return session.liveRegistry.call(params.name as string, params.args as JsonValue, {
          signal,
        });
      case 'scratch.open': {
        const scratch = await session.changeSet.openScratch();
        const id = nextScratch++;
        scratches.set(id, { session: scratch, steps: new Set() });
        return {
          scratch: id,
          tools: scratch.registry.list(),
        } satisfies Methods['scratch.open']['result'];
      }
      case 'scratch.call': {
        const scratch = scratches.get(params.scratch as number);
        if (!scratch) throw new Error('no such scratch session');
        const result = await scratch.session.registry.call(
          params.name as string,
          params.args as JsonValue,
          { signal },
        );
        if (result.ok && result.stepId) scratch.steps.add(result.stepId);
        const steps: Record<string, ProposedStep | null> = {};
        for (const stepId of scratch.steps) {
          steps[stepId] = stepById(session.changeSet, stepId) ?? null;
        }
        return { result, steps } satisfies Methods['scratch.call']['result'];
      }
      case 'scratch.close':
        closeScratch(params.scratch as number);
        return null;
      case 'apply':
        return session.changeSet.apply(params.entries as readonly ChangeSetEntry[]);
      default:
        throw Object.assign(new Error(`unknown method "${method}"`), { code: -32601 });
    }
  };

  port.onmessage = (ev: E) => {
    const message = ev.data;
    if (!isRecord(message) || message.jsonrpc !== JSONRPC_VERSION) return;
    const { id, method, params } = message;
    if (method === 'cancel') {
      if (isRecord(params) && isId(params.id)) calls.get(params.id)?.abort();
      return;
    }
    if (!isId(id)) return;
    if (typeof method !== 'string') {
      port.postMessage({
        jsonrpc: JSONRPC_VERSION,
        id,
        error: { code: -32600, message: 'invalid request' },
      });
      return;
    }
    const controller = new AbortController();
    calls.set(id, controller);
    handle(method, isRecord(params) ? params : {}, controller.signal).then(
      (result) => {
        calls.delete(id);
        port.postMessage({ jsonrpc: JSONRPC_VERSION, id, result });
      },
      (error: unknown) => {
        calls.delete(id);
        const code = isRecord(error) && typeof error.code === 'number' ? error.code : -32603;
        const text = error instanceof Error ? error.message : 'internal error';
        port.postMessage({ jsonrpc: JSONRPC_VERSION, id, error: { code, message: text } });
      },
    );
  };

  return () => {
    void closeAll();
    port.onmessage = null;
  };
}

/**
 * The `GlspMcpSession` a `serveGlspMcpSession` serves on `port`'s other end; resolves once the
 * served session is open (rejects if it fails to open). Its registries' `list` answers from the
 * tools listed when the session (or scratch session) opened, as an MCP registry's does; a call's
 * `signal` cancels it on the serving end. A fault of the transport itself becomes a refusal for a
 * tool call, and rejects `openScratch` and `apply`. `close` closes the served session too.
 */
export async function connectGlspMcpSession<
  E extends { readonly data: unknown } = { readonly data: unknown },
>(port: MessagePortLike<E>): Promise<GlspMcpSession> {
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  let closed = false;

  port.onmessage = (ev: E) => {
    const message = ev.data;
    if (!isRecord(message) || message.jsonrpc !== JSONRPC_VERSION) return;
    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
    if (!waiting) return;
    pending.delete(message.id as number);
    const { error } = message;
    if (isRecord(error)) {
      waiting.reject(new Error(String(error.message)));
    } else {
      waiting.resolve(message.result);
    }
  };

  const request = <M extends Method>(
    method: M,
    params: Methods[M]['params'],
    signal?: AbortSignal,
  ): Promise<Methods[M]['result']> => {
    if (closed) return Promise.reject(new Error('the session is closed'));
    const id = nextId++;
    const cancel = (): void => {
      port.postMessage({ jsonrpc: JSONRPC_VERSION, method: 'cancel', params: { id } });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const answered = new Promise<Methods[M]['result']>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      port.postMessage({ jsonrpc: JSONRPC_VERSION, id, method, params });
    });
    return signal ? answered.finally(() => signal.removeEventListener('abort', cancel)) : answered;
  };

  const call = async (
    run: (signal: AbortSignal | undefined) => Promise<ToolResult>,
    options: ToolCallOptions | undefined,
  ): Promise<ToolResult> => {
    try {
      return await run(options?.signal);
    } catch (error) {
      return errorToToolResult(error);
    }
  };

  const { tools } = await request('open', null);
  const liveRegistry: ToolRegistry = {
    list: () => tools,
    call: (name, args, options) =>
      call((signal) => request('live.call', { name, args }, signal), options),
  };

  // The current run's steps, as the serving end last reported them.
  let steps: StepSnapshot = {};
  const changeSet: GlspChangeSet = {
    async openScratch(): Promise<ScratchSession> {
      const opened = await request('scratch.open', null);
      steps = {};
      const registry: ToolRegistry = {
        list: () => opened.tools,
        call: (name, args, options) =>
          call(async (signal) => {
            const answer = await request(
              'scratch.call',
              { scratch: opened.scratch, name, args },
              signal,
            );
            steps = answer.steps;
            return answer.result;
          }, options),
      };
      return {
        registry,
        close: () => {
          request('scratch.close', { scratch: opened.scratch }).catch(() => undefined);
        },
      };
    },
    apply: (entries) => request('apply', { entries }),
    step: (entry) => {
      const stepId = entry.result.ok ? entry.result.stepId : undefined;
      return (stepId === undefined ? undefined : steps[stepId]) ?? undefined;
    },
    describeUndo: (result) => (result.ok ? result.undoDescription : undefined),
  };

  return {
    liveRegistry,
    changeSet,
    close: () => {
      if (closed) return;
      request('close', null).catch(() => undefined);
      closed = true;
      for (const waiting of pending.values()) waiting.reject(new Error('the session is closed'));
      pending.clear();
    },
  };
}
