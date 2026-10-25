/**
 * `@istar-ts/glsp/browser`: the GLSP server in a browser, over `postMessage`, with the transport
 * of upstream's `WorkerServerLauncher` (vscode-jsonrpc's `BrowserMessageReader`/`Writer`,
 * framework-notes §3), so a stock client's `GLSPWebWorkerProvider` connects unchanged.
 *
 * - `startIstarGlspWorker`, inside a Web Worker: the model lives in the worker, and the page
 *   reaches it through GLSP (on the worker itself) and as an istar-ts action client
 *   (`connectWorkerDispatcher` from `@istar-ts/glsp/page`, on a second `MessagePort`).
 * - `serveIstarGlsp`, in the page: a GLSP server on any `MessagePort`, usually over the page's
 *   own store and dispatcher (`shared`), which a React Flow canvas edits too. With `mcp`, also an
 *   MCP server in the page (`@eclipse-glsp/server-mcp`'s `WebMcpServerLauncher`), which an MCP
 *   client reaches through a `fetch` function: no Service Worker, no network.
 */
// Inversify reads decorator metadata through `Reflect`: load the polyfill before any class.
import 'reflect-metadata';

import type { PistarFile } from '@istar-ts/core';
import type { MessagePortLike } from '@istar-ts/actions';
import { connectDispatcher } from '@istar-ts/actions';
import type {
  GLSPServer,
  InitializeParameters,
  InitializeResult,
  MaybePromise,
} from '@eclipse-glsp/server/browser.js';
import {
  BaseJsonrpcGLSPClient,
  JsonRpcGLSPServerLauncher,
  LogLevel,
  RequestModelAction,
  createAppModule,
} from '@eclipse-glsp/server/browser.js';
import type { ContainerModule } from 'inversify';
import { Container, decorate, injectable } from 'inversify';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';
import type { IstarGlspContribution } from './contribution';
import { ISTAR_GLSP } from './contribution';
import type { PistarFiles } from './files';
import { memoryPistarFiles } from './files';
import type { IstarGlspHostOptions, IstarMcpBaseOptions } from './host';
import { createIstarServerModules, createIstarSharedModel } from './host';
import { istarMcpDispatcher, withMcpServer } from './mcp';
import { istarMcpDiagramModule } from './mcp-tools';
import type { IstarSharedModel } from './model-state';
import { isDispatcherPortMessage, isMcpBridgeMessage } from './page';

/**
 * What the GLSP connection needs of a port: a `MessagePort`, a `Worker` or a worker's `self`
 * (`BrowserMessageReader` sets `onmessage` and listens for `error`).
 */
export interface GlspPortLike {
  postMessage(data: unknown, transfer?: readonly unknown[]): void;
  onmessage: ((event: { readonly data: unknown }) => unknown) | null;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

/**
 * A GLSP launcher for one `postMessage` port: upstream's `WorkerServerLauncher` without its
 * global `postMessage` of a startup string, which a client's JSON-RPC reader logs as an invalid
 * message (so it also runs in a page, on any `MessagePort`). `start` resolves when the
 * connection closes or the launcher shuts down.
 */
@injectable()
export class IstarPortServerLauncher extends JsonRpcGLSPServerLauncher<{ port: GlspPortLike }> {
  protected run(options: { port: GlspPortLike }): MaybePromise<void> {
    const connection = createMessageConnection(
      // vscode-jsonrpc's reader and writer type their port as a DOM `MessagePort`.
      new BrowserMessageReader(options.port as never),
      new BrowserMessageWriter(options.port as never),
    );
    this.createServerInstance(connection);
    return new Promise((resolve) => {
      connection.onClose(() => resolve());
      this.toDispose.push({ dispose: () => resolve() });
    });
  }
}

/** The in-page MCP server's options. No authentication: only the page's own code can reach it. */
export type IstarBrowserMcpOptions = IstarMcpBaseOptions;

export interface IstarGlspBrowserOptions extends IstarGlspHostOptions {
  /** Default `LogLevel.warn`, to the console. */
  readonly logLevel?: LogLevel;
  /**
   * Also serve the diagrams over MCP, in the page (`@eclipse-glsp/server-mcp`, an optional peer
   * dependency, loaded on demand): see `IstarGlspMcp`. Off by default. `@experimental` upstream,
   * so the peer is pinned to one version.
   */
  readonly mcp?: boolean | IstarBrowserMcpOptions;
}

/**
 * A headless `serveIstarGlsp`: no GLSP client of the host's, so MCP is the point, over the
 * host's model (its session has no `sourceUri` to load a file from).
 */
export interface IstarGlspHeadlessOptions extends IstarGlspBrowserOptions {
  readonly shared: NonNullable<IstarGlspBrowserOptions['shared']>;
  readonly mcp: true | IstarBrowserMcpOptions;
}

/** A GLSP server on a port. */
export interface IstarGlspPortServer {
  /** Resolves when the connection closes or `close` is called. */
  readonly closed: Promise<void>;
  /** Closes the connection and disposes its sessions (and the MCP server, if any). */
  close(): void;
}

/**
 * The MCP server in the page. An MCP client connects with the SDK's Streamable HTTP transport and
 * this `fetch`, which hands each request to the launcher in the same realm:
 *
 * ```ts
 * new StreamableHTTPClientTransport(mcp.url, { fetch: mcp.fetch })
 * ```
 *
 * The server starts with the GLSP connection's `initialize` (`ready`); its tools act on that
 * connection's GLSP sessions (`session-info` lists them), through the same operation handlers
 * and dispatcher as the GLSP client, so the host's guards apply, and a rejected operation answers
 * its tool call with an error.
 */
export interface IstarGlspMcp {
  /** Resolves when the MCP server can take requests; rejects if it cannot start. */
  readonly ready: Promise<void>;
  /** The endpoint to give the client transport (never fetched over the network). */
  readonly url: URL;
  /** A Fetch API `fetch` for the MCP client transport: waits for `ready`, then `handleRequest`. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /**
   * The launcher's Fetch-shaped entry point (`AbstractMcpServerLauncher.handleRequest`), for a
   * host's own listener (a Service Worker, a worker bridge). Requests are handled one at a time,
   * as `BrowserMcpRequestContext` requires.
   */
  handleRequest(request: Request): Promise<Response>;
}

/** A GLSP server with an MCP server in the page. */
export interface IstarGlspMcpServer extends IstarGlspPortServer {
  readonly mcp: IstarGlspMcp;
  /** The GLSP session MCP tools act on, for a headless server: pass it as their `sessionId`. */
  readonly sessionId?: string;
}

/** The headless GLSP client's session, the one a headless server's MCP tools act on. */
export const ISTAR_MCP_SESSION_ID = 'istar-mcp';

/**
 * Serves the contributions' diagrams to a GLSP client on `port`. Call it once per client (one
 * `MessageChannel` each); with `shared`, they all edit the host's model, and so does the host's
 * own canvas.
 *
 * With `mcp`, the connection also gets an MCP server in the page, started with its first
 * `initialize` (see `IstarGlspMcp`). The server listens once `@eclipse-glsp/server-mcp` has
 * loaded; a `MessagePort` keeps the client's messages until then.
 *
 * Without a port (`serveIstarGlsp({ shared, mcp: true })`) it is headless: the server's own GLSP
 * client opens a session (`ISTAR_MCP_SESSION_ID`) on the shared diagram, and `mcp.ready` resolves
 * once that session has its model. That session has no viewer: `get-selection` answers a tool
 * error, `set-selection` and `set-view` have nothing to show.
 */
export function serveIstarGlsp(options: IstarGlspHeadlessOptions): IstarGlspMcpServer;
export function serveIstarGlsp(
  port: GlspPortLike,
  options: IstarGlspBrowserOptions & { readonly mcp: true | IstarBrowserMcpOptions },
): IstarGlspMcpServer;
export function serveIstarGlsp(
  port: GlspPortLike,
  options?: IstarGlspBrowserOptions,
): IstarGlspPortServer;
export function serveIstarGlsp(
  portOrOptions: GlspPortLike | IstarGlspHeadlessOptions,
  options: IstarGlspBrowserOptions = {},
): IstarGlspPortServer | IstarGlspMcpServer {
  if ('postMessage' in portOrOptions) return serveOnPort(portOrOptions, options);
  return serveHeadless(portOrOptions);
}

/** `serveIstarGlsp` on a port; MCP requests also wait for `gate`. */
function serveOnPort(
  port: GlspPortLike,
  options: IstarGlspBrowserOptions,
  gate?: Promise<unknown>,
): IstarGlspPortServer | IstarGlspMcpServer {
  const app = new Container();
  app.load(createAppModule({ logLevel: options.logLevel ?? LogLevel.warn }));
  const launcher = app.resolve(IstarPortServerLauncher);
  const start = (mcp?: McpModules): Promise<void> => {
    const { serverModule, modules } = createIstarServerModules({
      ...options,
      diagramModules: [...(options.diagramModules ?? []), ...(mcp ? [mcp.diagram] : [])],
      modules: [...(options.modules ?? []), ...(mcp ? [mcp.server] : [])],
    });
    launcher.configure(serverModule, ...modules);
    return Promise.resolve(launcher.start({ port }));
  };
  if (!options.mcp) {
    const done = start();
    return { closed: done, close: () => void launcher.shutdown() };
  }

  const config = options.mcp === true ? {} : options.mcp;
  const route = config.route ?? '/mcp';
  const loaded = mcpModules({ route, name: config.name ?? 'istar-glsp' });
  let closing = false;
  const done = loaded.then(
    (mcp) => (closing ? undefined : start(mcp)),
    () => undefined,
  );
  // Reported through `started` below, unless the import fails first.
  gate?.catch(() => undefined);
  const started = loaded.then(async (mcp) => {
    const [handler] = await Promise.all([mcp.started, gate]);
    return handler;
  });
  return {
    closed: done,
    close: () => {
      closing = true;
      void launcher.shutdown();
    },
    mcp: inPageMcp(new URL(route, 'http://localhost'), started),
  };
}

/**
 * `serveIstarGlsp` without a port: its own GLSP client, on a `MessageChannel`, opens the session
 * MCP tools act on.
 */
function serveHeadless(options: IstarGlspHeadlessOptions): IstarGlspMcpServer {
  const { port1, port2 } = new MessageChannel();
  const client = new BaseJsonrpcGLSPClient({
    id: ISTAR_MCP_SESSION_ID,
    connectionProvider: createMessageConnection(
      new BrowserMessageReader(port1),
      new BrowserMessageWriter(port1),
    ),
  });
  const diagramType =
    options.shared.diagramType ?? (options.contributions ?? [ISTAR_GLSP])[0]!.diagramType;
  const session = (async () => {
    await client.start();
    const model = new Promise<void>((resolve) => {
      const listener = client.onActionMessage((message) => {
        if (message.action.kind !== 'setModel') return;
        listener.dispose();
        resolve();
      });
    });
    await client.initializeServer({
      applicationId: ISTAR_MCP_SESSION_ID,
      protocolVersion: '1.0.0',
    });
    await client.initializeClientSession({
      clientSessionId: ISTAR_MCP_SESSION_ID,
      diagramType,
      // A session without a viewer: it only waits for its model.
      clientActionKinds: ['setModel'],
    });
    client.sendActionMessage({
      clientId: ISTAR_MCP_SESSION_ID,
      action: RequestModelAction.create(),
    });
    await model;
  })();
  const server = serveOnPort(
    port2 as unknown as GlspPortLike,
    options,
    session,
  ) as IstarGlspMcpServer;
  return {
    ...server,
    sessionId: ISTAR_MCP_SESSION_ID,
    close: () => {
      server.close();
      void client.stop();
      port1.close();
    },
  };
}

interface McpModules {
  readonly server: ContainerModule;
  readonly diagram: ContainerModule;
  /** Resolves when the launcher has started the MCP server, with its request handler. */
  readonly started: Promise<(request: Request) => Promise<Response>>;
}

/**
 * The MCP server module (server scope, `WebMcpServerLauncher`) and diagram module (every
 * session), from `@eclipse-glsp/server-mcp`, loaded only when asked for: as the Node launcher
 * wires them, with a launcher that reports when it has started.
 */
async function mcpModules(config: Required<IstarMcpBaseOptions>): Promise<McpModules> {
  const mcp = await import('@eclipse-glsp/server-mcp/browser.js');
  const z = await import('zod/v4');
  let resolveStarted!: (handler: (request: Request) => Promise<Response>) => void;
  const started = new Promise<(request: Request) => Promise<Response>>((resolve) => {
    resolveStarted = resolve;
  });
  class IstarWebMcpServerLauncher extends mcp.WebMcpServerLauncher {
    override async initializeServer(
      server: GLSPServer,
      params: InitializeParameters,
      result: InitializeResult,
    ): Promise<InitializeResult> {
      const initialized = await super.initializeServer(
        server,
        withMcpServer(params, config),
        result,
      );
      resolveStarted(this.getRequestHandler());
      return initialized;
    }
  }
  decorate(injectable(), IstarWebMcpServerLauncher);
  const dispatcher = istarMcpDispatcher(mcp);
  class IstarBrowserMcpServerModule extends mcp.BrowserMcpServerModule {
    protected override bindMcpServerLauncher(): typeof IstarWebMcpServerLauncher {
      return IstarWebMcpServerLauncher;
    }
    protected override bindMcpDiagramHandlerDispatcher(): typeof dispatcher {
      return dispatcher;
    }
  }
  return {
    server: new IstarBrowserMcpServerModule(),
    diagram: new (istarMcpDiagramModule(mcp, z))(),
    started,
  };
}

/**
 * The page's side of the MCP server: a same-realm `fetch` over the launcher's request handler,
 * which needs neither a Service Worker nor `McpWorkerBridge` (whose buffered fallback, on
 * browsers that cannot transfer a `ReadableStream`, would wait forever on the client's
 * standalone SSE stream). Requests are serialized as the bridge serializes them, up to the
 * handler's `Response`, not its body.
 */
function inPageMcp(
  url: URL,
  started: Promise<(request: Request) => Promise<Response>>,
): IstarGlspMcp {
  let queue: Promise<unknown> = Promise.resolve();
  const handleRequest = (request: Request): Promise<Response> => {
    const response = queue.then(async () => (await started)(request));
    queue = response.catch(() => undefined);
    return response;
  };
  const ready = started.then(() => undefined);
  // The host may never look at `ready`: a failed start still rejects every request.
  ready.catch(() => undefined);
  return {
    ready,
    url,
    fetch: (input, init) => handleRequest(new Request(input, init)),
    handleRequest,
  };
}

/** What `startIstarGlspWorker` needs of the worker's `self`. */
export type WorkerScopeLike = GlspPortLike;

export interface IstarGlspWorkerOptions extends Omit<IstarGlspBrowserOptions, 'contributions'> {
  /** The diagram. Default `ISTAR_GLSP`. */
  readonly contribution?: IstarGlspContribution;
  /** The model: piStar text or a parsed file. Ignored with `shared`; else `url`, else empty. */
  readonly model?: string | PistarFile;
  /** Where to fetch the model's piStar text from, when there is no `model`. */
  readonly url?: string;
  /**
   * The file name saves go to, unless `saveModel` names a `fileUri`. Default: `url`'s last
   * segment, else `model.txt`.
   */
  readonly sourceUri?: string;
  /** Where saves are written. Default: in memory (`memoryPistarFiles`). */
  readonly files?: PistarFiles;
  /** The worker's global scope. Default `self`. */
  readonly scope?: WorkerScopeLike;
  /**
   * Also serve the diagram over MCP, through server-mcp 2.8.0's `McpWorkerBridge` (loaded on
   * demand, like the in-page MCP): the page reaches it with `connectWorkerMcp` from
   * `@istar-ts/glsp/page`, over a `MessagePort` separate from `connectWorkerDispatcher`'s. Off
   * by default. `@experimental` upstream, so the peer is pinned to one version.
   */
  readonly mcp?: boolean | IstarBrowserMcpOptions;
}

/** A running GLSP worker. */
export interface IstarGlspWorker {
  /** The model every GLSP session and dispatcher port shows. */
  readonly shared: IstarSharedModel;
  /** Resolves when the GLSP connection closes. */
  readonly closed: Promise<void>;
}

/**
 * Runs the GLSP server in this Web Worker, for the page's client on the worker itself (as
 * `GLSPWebWorkerProvider` connects). The model lives here, in one store every session shares;
 * a page also edits it through `connectWorkerDispatcher` (`@istar-ts/glsp/page`), whose ports
 * this serves with `connectDispatcher` (each change's notification carries the model, for a
 * `createMirrorStore` in the page). Call it first thing in the worker: messages that arrive
 * while the model loads are kept until the server listens.
 */
export async function startIstarGlspWorker(
  options: IstarGlspWorkerOptions = {},
): Promise<IstarGlspWorker> {
  const scope = options.scope ?? (globalThis as unknown as { self: WorkerScopeLike }).self;
  const ports: unknown[] = [];
  let serve: ((port: unknown) => void) | undefined;
  const bridgeScope = options.mcp ? createMcpBridgeScope(scope) : undefined;
  const glsp = routePort(
    scope,
    (port) => {
      if (serve) serve(port);
      else ports.push(port);
    },
    bridgeScope?.dispatch,
  );

  const contribution = options.contribution ?? ISTAR_GLSP;
  const sourceUri = options.sourceUri ?? options.url?.split('/').pop() ?? 'model.txt';
  const files = options.files ?? memoryPistarFiles();
  const shared =
    options.shared ??
    createIstarSharedModel(contribution, {
      model: options.model ?? (options.url ? await (await fetch(options.url)).text() : undefined),
      sourceModelName: sourceUri,
      // The page's dispatcher ports are there to mirror the model (`createMirrorStore`): push it
      // with every change rather than have each mirror ask for it.
      sendModel: true,
      save: async (file, action) => {
        await files.write(action.fileUri ?? sourceUri, JSON.stringify(file, null, 2));
      },
    });

  serve = (port) => {
    connectDispatcher(port as MessagePortLike, shared.dispatcher);
  };
  for (const port of ports.splice(0)) serve(port);

  const mcp = bridgeScope
    ? await workerMcpModules(mcpConfig(options.mcp ?? false), bridgeScope.target)
    : undefined;

  const server = serveIstarGlsp(glsp, {
    ...options,
    mcp: false,
    contributions: [contribution],
    shared,
    files,
    diagramModules: [...(options.diagramModules ?? []), ...(mcp ? [mcp.diagram] : [])],
    modules: [...(options.modules ?? []), ...(mcp ? [mcp.server] : [])],
  });
  return { shared, closed: server.closed };
}

/** `options.mcp === true ? {} : options.mcp`'s defaults, as `serveOnPort` applies them. */
function mcpConfig(mcp: boolean | IstarBrowserMcpOptions): Required<IstarMcpBaseOptions> {
  const config = typeof mcp === 'object' ? mcp : {};
  return { route: config.route ?? '/mcp', name: config.name ?? 'istar-glsp' };
}

/**
 * The worker side of `McpWorkerBridge`'s wiring: a scope-shaped adapter the bridge can
 * `addEventListener('message', …)` on, fed by `routePort`'s `onMcp` (not the real worker scope
 * directly, since the bridge is loaded lazily — messages that arrive first are queued the same
 * way `startIstarGlspWorker`'s dispatcher ports are).
 */
function createMcpBridgeScope(scope: WorkerScopeLike): {
  readonly target: {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    postMessage(message: unknown, transfer?: readonly unknown[]): void;
  };
  dispatch(event: { readonly data: unknown }): void;
} {
  const queued: Array<{ readonly data: unknown }> = [];
  let listener: ((event: MessageEvent) => void) | undefined;
  return {
    target: {
      addEventListener: (_type, handler) => {
        listener = handler;
        for (const event of queued.splice(0)) handler(event as MessageEvent);
      },
      removeEventListener: (_type, handler) => {
        if (listener === handler) listener = undefined;
      },
      postMessage: (message, transfer) => scope.postMessage(message, transfer),
    },
    dispatch: (event) => {
      if (listener) listener(event as MessageEvent);
      else queued.push(event);
    },
  };
}

interface WorkerMcpModules {
  readonly server: ContainerModule;
  readonly diagram: ContainerModule;
}

/**
 * The MCP server module and diagram module for a worker's `startIstarGlspWorker({ mcp: true })`:
 * like `mcpModules`, but the launcher is activated behind `McpWorkerBridge` (`scope`, built by
 * `createMcpBridgeScope`) instead of exposing a direct `fetch` — the page is a different realm,
 * so it reaches the launcher over `postMessage` (`connectWorkerMcp`), not a function call.
 */
async function workerMcpModules(
  config: Required<IstarMcpBaseOptions>,
  scope: {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    postMessage(message: unknown, transfer?: readonly unknown[]): void;
  },
): Promise<WorkerMcpModules> {
  const mcp = await import('@eclipse-glsp/server-mcp/browser.js');
  const z = await import('zod/v4');
  const bridge = new mcp.McpWorkerBridge(scope);
  class IstarWebMcpServerLauncher extends mcp.WebMcpServerLauncher {
    override async initializeServer(
      server: GLSPServer,
      params: InitializeParameters,
      result: InitializeResult,
    ): Promise<InitializeResult> {
      return super.initializeServer(server, withMcpServer(params, config), result);
    }
  }
  decorate(injectable(), IstarWebMcpServerLauncher);
  const dispatcher = istarMcpDispatcher(mcp);
  class IstarWorkerMcpServerModule extends mcp.BrowserMcpServerModule {
    protected override bindMcpServerLauncher(): typeof IstarWebMcpServerLauncher {
      return IstarWebMcpServerLauncher;
    }
    protected override bindMcpDiagramHandlerDispatcher(): typeof dispatcher {
      return dispatcher;
    }
    protected override onMcpServerLauncherActivated(launcher: IstarWebMcpServerLauncher): void {
      bridge.bindLauncher(launcher);
    }
  }
  return {
    server: new IstarWorkerMcpServerModule(),
    diagram: new (istarMcpDiagramModule(mcp, z))(),
  };
}

/**
 * Splits the worker's messages: dispatcher ports go to `onPort`, `McpWorkerBridge` messages (if
 * `onMcp` is given) go to `onMcp`, everything else to the GLSP connection, through the port this
 * returns. GLSP messages that come before the connection listens are queued.
 */
function routePort(
  scope: WorkerScopeLike,
  onPort: (port: unknown) => void,
  onMcp?: (event: { readonly data: unknown }) => void,
): GlspPortLike {
  const queued: Array<{ readonly data: unknown }> = [];
  let listener: GlspPortLike['onmessage'] = null;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the one message handler, as GLSP's reader sets it
  scope.onmessage = (event) => {
    if (isDispatcherPortMessage(event.data)) onPort(event.data.port);
    else if (onMcp && isMcpBridgeMessage(event.data)) onMcp(event);
    else if (listener) listener(event);
    else queued.push(event);
  };
  return {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker scope or port, not a window
    postMessage: (data) => scope.postMessage(data),
    addEventListener: (type, handler) => scope.addEventListener(type, handler),
    get onmessage() {
      return listener;
    },
    set onmessage(handler) {
      listener = handler;
      // After the connection's reader, which sets this, has started listening.
      queueMicrotask(() => {
        for (const event of queued.splice(0)) listener?.(event);
      });
    },
  };
}
