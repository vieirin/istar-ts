/**
 * `@istar-ts/glsp/browser`: the GLSP server in a browser, over `postMessage`, with the transport
 * of upstream's `WorkerServerLauncher` (vscode-jsonrpc's `BrowserMessageReader`/`Writer`,
 * framework-notes §3), so a stock client's `GLSPWebWorkerProvider` connects unchanged.
 *
 * - `startIstarGlspWorker`, inside a Web Worker: the model lives in the worker, and the page
 *   reaches it through GLSP (on the worker itself) and as an istar-ts action client
 *   (`connectWorkerDispatcher` from `@istar-ts/glsp/page`, on a second `MessagePort`).
 * - `serveIstarGlsp`, in the page: a GLSP server on any `MessagePort`, usually over the page's
 *   own store and dispatcher (`shared`), which a React Flow canvas edits too.
 */
// Inversify reads decorator metadata through `Reflect`: load the polyfill before any class.
import 'reflect-metadata';

import type { PistarFile } from '@istar-ts/core';
import type { MessagePortLike } from '@istar-ts/actions';
import { connectDispatcher } from '@istar-ts/actions';
import type { MaybePromise } from '@eclipse-glsp/server/browser.js';
import {
  JsonRpcGLSPServerLauncher,
  LogLevel,
  createAppModule,
} from '@eclipse-glsp/server/browser.js';
import { Container, injectable } from 'inversify';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';
import type { IstarGlspContribution } from './contribution';
import { ISTAR_GLSP } from './contribution';
import type { PistarFiles } from './files';
import { memoryPistarFiles } from './files';
import type { IstarGlspHostOptions } from './host';
import { createIstarServerModules, createIstarSharedModel } from './host';
import type { IstarSharedModel } from './model-state';
import { isDispatcherPortMessage } from './page';

/**
 * What the GLSP connection needs of a port: a `MessagePort`, a `Worker` or a worker's `self`
 * (`BrowserMessageReader` sets `onmessage` and listens for `error`).
 */
export interface GlspPortLike {
  postMessage(data: unknown): void;
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

export interface IstarGlspBrowserOptions extends IstarGlspHostOptions {
  /** Default `LogLevel.warn`, to the console. */
  readonly logLevel?: LogLevel;
}

/** A GLSP server on a port. */
export interface IstarGlspPortServer {
  /** Resolves when the connection closes or `close` is called. */
  readonly closed: Promise<void>;
  /** Closes the connection and disposes its sessions. */
  close(): void;
}

/**
 * Serves the contributions' diagrams to one GLSP client on `port`. Call it once per client
 * (one `MessageChannel` each); with `shared`, they all edit the host's model, and so does the
 * host's own canvas.
 */
export function serveIstarGlsp(
  port: GlspPortLike,
  options: IstarGlspBrowserOptions = {},
): IstarGlspPortServer {
  const app = new Container();
  app.load(createAppModule({ logLevel: options.logLevel ?? LogLevel.warn }));
  const launcher = app.resolve(IstarPortServerLauncher);
  const { serverModule, modules } = createIstarServerModules(options);
  launcher.configure(serverModule, ...modules);
  const done = Promise.resolve(launcher.start({ port }));
  return {
    closed: done,
    close: () => void launcher.shutdown(),
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
 * this serves with `connectDispatcher`. Call it first thing in the worker: messages that arrive
 * while the model loads are kept until the server listens.
 */
export async function startIstarGlspWorker(
  options: IstarGlspWorkerOptions = {},
): Promise<IstarGlspWorker> {
  const scope = options.scope ?? (globalThis as unknown as { self: WorkerScopeLike }).self;
  const ports: unknown[] = [];
  let serve: ((port: unknown) => void) | undefined;
  const glsp = routePort(scope, (port) => {
    if (serve) serve(port);
    else ports.push(port);
  });

  const contribution = options.contribution ?? ISTAR_GLSP;
  const sourceUri = options.sourceUri ?? options.url?.split('/').pop() ?? 'model.txt';
  const files = options.files ?? memoryPistarFiles();
  const shared =
    options.shared ??
    createIstarSharedModel(contribution, {
      model: options.model ?? (options.url ? await (await fetch(options.url)).text() : undefined),
      sourceModelName: sourceUri,
      save: async (file, action) => {
        await files.write(action.fileUri ?? sourceUri, JSON.stringify(file, null, 2));
      },
    });

  serve = (port) => {
    connectDispatcher(port as MessagePortLike, shared.dispatcher);
  };
  for (const port of ports.splice(0)) serve(port);

  const server = serveIstarGlsp(glsp, {
    ...options,
    contributions: [contribution],
    shared,
    files,
  });
  return { shared, closed: server.closed };
}

/**
 * Splits the worker's messages: dispatcher ports go to `onPort`, everything else to the GLSP
 * connection, through the port this returns. GLSP messages that come before the connection
 * listens are queued.
 */
function routePort(scope: WorkerScopeLike, onPort: (port: unknown) => void): GlspPortLike {
  const queued: Array<{ readonly data: unknown }> = [];
  let listener: GlspPortLike['onmessage'] = null;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the one message handler, as GLSP's reader sets it
  scope.onmessage = (event) => {
    if (isDispatcherPortMessage(event.data)) onPort(event.data.port);
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
