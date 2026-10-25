/**
 * `@istar-ts/glsp/page`: what a page imports to reach the model of a GLSP worker
 * (`startIstarGlspWorker`) as an istar-ts action client (`connectWorkerDispatcher`) or, with
 * `mcp: true`, as an MCP client (`connectWorkerMcp`). No GLSP, Inversify or `reflect-metadata`
 * here, so the page's bundle stays small.
 */
import type { ActionDispatcher, MessagePortLike } from '@istar-ts/actions';
import { createRemoteDispatcher } from '@istar-ts/actions';

/**
 * The message a page posts to a GLSP worker to hand it a `MessagePort` (`port`, transferred) on
 * which the worker serves its dispatcher (`connectDispatcher`). The worker's GLSP connection is
 * on the worker itself, so this one message kind is the only thing they share.
 */
export const ISTAR_DISPATCHER_PORT = 'istar.dispatcherPort';

/** `ISTAR_DISPATCHER_PORT`'s message. */
export interface DispatcherPortMessage {
  readonly kind: typeof ISTAR_DISPATCHER_PORT;
  /** A `MessagePort`. */
  readonly port: unknown;
}

/** True for a `DispatcherPortMessage`. */
export function isDispatcherPortMessage(data: unknown): data is DispatcherPortMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === ISTAR_DISPATCHER_PORT &&
    'port' in data
  );
}

/** What `connectWorkerDispatcher` needs of a `Worker`: posting with a transfer list. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: unknown[]): void;
}

/**
 * An `ActionDispatcher` on a GLSP worker's model: opens a `MessageChannel`, hands the worker one
 * end and returns `createRemoteDispatcher` on the other. Edits sent through it and through the
 * worker's GLSP sessions are one model and one undo stack; `subscribe` hears every change.
 */
export function connectWorkerDispatcher(
  worker: WorkerLike,
): ActionDispatcher<string, string> & { close(): void } {
  const channel = new MessageChannel();
  const message: DispatcherPortMessage = { kind: ISTAR_DISPATCHER_PORT, port: channel.port2 };
  worker.postMessage(message, [channel.port2]);
  const dispatcher = createRemoteDispatcher<string, string>(channel.port1 as MessagePortLike);
  return {
    dispatch: (action) => dispatcher.dispatch(action),
    subscribe: (listener) => dispatcher.subscribe(listener),
    close: () => channel.port1.close(),
  };
}

/**
 * server-mcp 2.8.0's `McpWorkerBridge` wire messages (`src/browser/server/mcp-worker-bridge.ts`),
 * reproduced structurally here (not imported: the bridge lives in the optional peer dependency,
 * and `/page` never loads it) so `connectWorkerMcp` can speak the same protocol.
 */
const MCP_REQUEST = 'mcp-request';
const MCP_RESPONSE = 'mcp-response';
const MCP_INIT_PORT = 'mcp-init-port';

interface McpRequestMessage {
  readonly type: typeof MCP_REQUEST;
  readonly id: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

interface McpResponseMessage {
  readonly type: typeof MCP_RESPONSE;
  readonly id: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: ReadableStream<Uint8Array> | ArrayBuffer | null;
}

interface McpInitPortMessage {
  readonly type: typeof MCP_INIT_PORT;
}

/** True for a message the worker's `McpWorkerBridge` sends or expects: `startIstarGlspWorker`'s
 * GLSP connection (`routePort`) must not forward these to the JSON-RPC reader. */
export function isMcpBridgeMessage(
  data: unknown,
): data is McpRequestMessage | McpResponseMessage | McpInitPortMessage {
  const type = (data as { type?: unknown } | null)?.type;
  return type === MCP_REQUEST || type === MCP_RESPONSE || type === MCP_INIT_PORT;
}

/** An MCP server reached through a GLSP worker's `McpWorkerBridge`. */
export interface WorkerMcp {
  /** The endpoint to give the client transport (never fetched over the network). */
  readonly url: URL;
  /** A Fetch API `fetch` for the MCP client transport (`StreamableHTTPClientTransport`'s
   * `fetch` option): serializes each request over the worker port, as `McpWorkerBridge` expects. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Closes the `MessagePort` the worker was handed. */
  close(): void;
}

/**
 * An MCP server on a `startIstarGlspWorker({ mcp: true })` worker: opens a `MessageChannel`,
 * hands the worker one end with `mcp-init-port` (server-mcp 2.8.0's `McpWorkerBridge` protocol),
 * and returns a `fetch` that serializes each request as an `McpRequestMessage` and turns the
 * `McpResponseMessage` back into a `Response`.
 *
 * The SDK client's standalone GET SSE stream never ends; `McpWorkerBridge`'s dispatch queue is
 * serial, so that GET would block every later request on a browser that cannot transfer a
 * `ReadableStream` (Firefox, Safari — docs/agent/verification.md §5's D1 caveat). This `fetch`
 * answers every GET with `405` directly, without a round trip to the worker: the MCP SDK client
 * treats `405` on the standalone stream as "no server-initiated stream offered" and carries on
 * with request/response calls only, on every browser alike.
 */
export function connectWorkerMcp(
  worker: WorkerLike,
  options: { readonly route?: string } = {},
): WorkerMcp {
  const url = new URL(options.route ?? '/mcp', 'http://localhost');
  const channel = new MessageChannel();
  const port = channel.port1;
  const pending = new Map<string, (message: McpResponseMessage) => void>();
  let nextId = 0;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the one reply handler, as the dispatcher port does
  port.onmessage = (event) => {
    const data = event.data as McpResponseMessage;
    const resolve = pending.get(data.id);
    if (resolve) {
      pending.delete(data.id);
      resolve(data);
    }
  };
  const initPort: McpInitPortMessage = { type: MCP_INIT_PORT };
  worker.postMessage(initPort, [channel.port2]);

  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    if (request.method === 'GET') {
      return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
    }
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const body = request.body ? await request.text() : undefined;
    const id = String(nextId++);
    const reply = new Promise<McpResponseMessage>((resolve) => pending.set(id, resolve));
    const message: McpRequestMessage = {
      type: MCP_REQUEST,
      id,
      url: request.url,
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
    };
    port.postMessage(message);
    const response = await reply;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    url,
    fetch: fetchImpl,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}
