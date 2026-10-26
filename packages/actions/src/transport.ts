/**
 * A transport for `ActionDispatcher` over a `MessagePort`-like object, framed as JSON-RPC 2.0:
 * a dispatch is a request (`method = action.kind`, `params = action`), answered with the
 * `ActionResult` as `result`; `dispatcher.subscribe` events go server to client as notifications
 * (no `id`). A rejection (`ActionResult` with `ok: false`) is a normal result, not a JSON-RPC
 * error — only a transport or protocol fault (a malformed frame, an unhandled exception) is.
 *
 * `connectDispatcher` serves a dispatcher on one end; `createRemoteDispatcher` is the
 * `ActionDispatcher` implementation for the other end. No `vscode-jsonrpc`.
 */
import type { ElementKind, LinkKind } from '@istar-ts/core';
import type {
  ActionDispatcher,
  ActionListener,
  ActionResult,
  DispatchOptions,
  StoreActionDispatcher,
} from './dispatcher';
import type { IstarAction } from './actions';

const JSONRPC_VERSION = '2.0';

/** An id a JSON-RPC request carries and its response answers back. */
export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
  /** The dispatch's `origin` (`DispatchOptions.origin`), carried to the server's `dispatch`. */
  readonly origin?: string;
}

/** A subscriber event, sent with no `id`: it expects no response. */
export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcError {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

/** The envelope `connectDispatcher`/`createRemoteDispatcher` exchange over the port. */
export type ActionMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError;

/**
 * Structurally what a DOM `MessagePort`, a worker's `self`, or any two-way `postMessage` channel
 * gives us: enough to send and receive `ActionMessage`s, nothing DOM-specific. Generic over the
 * event type `onmessage` is handed (`MessageEvent` for a real port, inferred at the call site),
 * so a real `MessagePort` or `Worker` fits without a cast: `strictFunctionTypes` checks a
 * property-typed handler's parameter invariantly, so pinning it to a narrower `{ data: unknown }`
 * here would reject `MessagePort`'s own, wider `onmessage` type.
 */
export interface MessagePortLike<
  E extends { readonly data: unknown } = { readonly data: unknown },
> {
  postMessage(data: unknown): void;
  onmessage: ((ev: E) => unknown) | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

function errorMessage(id: JsonRpcId, code: number, message: string): JsonRpcError {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

/**
 * Serves `dispatcher` on `port`: every well-formed request is answered with the
 * `ActionResult` as `result`; `dispatcher.subscribe` events are pushed as notifications.
 * A malformed request answers `-32600` (invalid request) or `-32601` (no usable `method`); an
 * exception `dispatch` itself doesn't catch answers `-32603` (internal error). Returns a
 * disposer that stops forwarding subscriber events and detaches the port's `onmessage`.
 */
export function connectDispatcher<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
  E extends { readonly data: unknown } = { readonly data: unknown },
>(port: MessagePortLike<E>, dispatcher: ActionDispatcher<EK, LK>): () => void {
  const unsubscribe = dispatcher.subscribe((action) => {
    port.postMessage({ jsonrpc: JSONRPC_VERSION, method: action.kind, params: action });
  });

  port.onmessage = (ev: E) => {
    const message = ev.data;
    if (!isRecord(message) || message.jsonrpc !== JSONRPC_VERSION) return;
    const { id, method, params, origin } = message;
    const hasId = isJsonRpcId(id);
    const dispatchOptions: DispatchOptions | undefined =
      typeof origin === 'string' ? { origin } : undefined;

    if (typeof method !== 'string' || method.length === 0) {
      if (hasId) port.postMessage(errorMessage(id, -32601, 'method not found'));
      return;
    }
    if (!isRecord(params) || params.kind !== method) {
      if (hasId) port.postMessage(errorMessage(id, -32600, 'invalid request'));
      return;
    }

    const action = params as unknown as IstarAction<EK, LK>;
    if (!hasId) {
      // A notification from the client: dispatch it, no response expected.
      void dispatcher.dispatch(action, dispatchOptions);
      return;
    }
    dispatcher.dispatch(action, dispatchOptions).then(
      (result: ActionResult<unknown>) => {
        port.postMessage({ jsonrpc: JSONRPC_VERSION, id, result });
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : 'internal error';
        port.postMessage(errorMessage(id, -32603, text));
      },
    );
  };

  return () => {
    unsubscribe();
    port.onmessage = null;
  };
}

/**
 * The `ActionDispatcher` for the other end of a `connectDispatcher` port: `dispatch` sends a
 * request and resolves with the `ActionResult` it is answered with (a JSON-RPC `error` rejects
 * the promise instead — a transport fault, not an `ActionResult`); `subscribe` hears the
 * notifications the server pushes.
 */
export function createRemoteDispatcher<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
  E extends { readonly data: unknown } = { readonly data: unknown },
>(port: MessagePortLike<E>): ActionDispatcher<EK, LK> {
  let nextId = 0;
  const pending = new Map<
    JsonRpcId,
    { resolve: (result: ActionResult<unknown>) => void; reject: (error: Error) => void }
  >();
  const listeners = new Set<ActionListener<EK, LK>>();

  port.onmessage = (ev: E) => {
    const message = ev.data;
    if (!isRecord(message) || message.jsonrpc !== JSONRPC_VERSION) return;
    const { id, method, params, result, error } = message;

    if (isJsonRpcId(id)) {
      const waiting = pending.get(id);
      if (!waiting) return;
      pending.delete(id);
      if (isRecord(error)) {
        waiting.reject(new Error(`JSON-RPC error ${String(error.code)}: ${String(error.message)}`));
      } else {
        waiting.resolve(result as ActionResult<unknown>);
      }
      return;
    }

    if (typeof method === 'string' && isRecord(params)) {
      const action = params as unknown as IstarAction<EK, LK>;
      for (const listener of listeners) listener(action);
    }
  };

  return {
    dispatch(action, dispatchOptions) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (result: ActionResult<unknown>) => void, reject });
        port.postMessage({
          jsonrpc: JSONRPC_VERSION,
          id,
          method: action.kind,
          params: action,
          ...(dispatchOptions?.origin === undefined ? {} : { origin: dispatchOptions.origin }),
        });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * `dispatcher` as a `StoreActionDispatcher`, for a consumer that asks for its dirty state (a GLSP
 * session over a host's dispatcher, `@istar-ts/glsp`'s `IstarSharedModel`). A dispatcher that has
 * `isDirty` is returned as is (with a no-op `dispose` if it has none); one that doesn't (a
 * `createRemoteDispatcher`, a mirror's) is wrapped, its dirty state tracked from the
 * `setDirtyState` notifications it relays from then on: clean until the first one, since a remote
 * dispatcher doesn't publish the state it had before. `dispose` stops tracking and never disposes
 * the dispatcher itself, which stays its owner's (#249).
 */
export function withDirtyState<EK extends string = ElementKind, LK extends string = LinkKind>(
  dispatcher: ActionDispatcher<EK, LK> & { isDirty?(): boolean; dispose?(): void },
): StoreActionDispatcher<EK, LK> {
  const own = dispatcher.isDirty;
  if (typeof own === 'function') {
    if (typeof dispatcher.dispose === 'function')
      return dispatcher as StoreActionDispatcher<EK, LK>;
    return {
      dispatch: (action, options) => dispatcher.dispatch(action, options),
      subscribe: (listener) => dispatcher.subscribe(listener),
      isDirty: () => own.call(dispatcher),
      dispose: () => undefined,
    };
  }
  let dirty = false;
  const unsubscribe = dispatcher.subscribe((action) => {
    if (action.kind === 'setDirtyState') dirty = action.isDirty;
  });
  return {
    dispatch: (action, options) => dispatcher.dispatch(action, options),
    subscribe: (listener) => dispatcher.subscribe(listener),
    isDirty: () => dirty,
    dispose: () => {
      unsubscribe();
    },
  };
}
