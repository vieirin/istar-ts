/**
 * How `mountGlspClient` reaches a GLSP server: one `ConnectionProvider` per transport, over the
 * same `vscode-jsonrpc` framing the hosts in `@istar-ts/glsp` speak (framework-notes §3).
 */
import type { ConnectionProvider } from '@eclipse-glsp/client';
import { GLSPWebSocketProvider } from '@eclipse-glsp/client';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/browser';

/**
 * What a `postMessage` connection needs of its port: a `MessagePort` (the in-page default) or a
 * `Worker` (`?server=worker`). `BrowserMessageReader`/`Writer` only ever call these; the DOM's
 * own `MessagePort`/`Worker` types satisfy this directly, no cast needed.
 */
export interface GlspPortLike {
  postMessage(data: unknown): void;
  onmessage: ((event: MessageEvent) => unknown) | null;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

/** A `postMessage` port: the page's own `MessageChannel` end, or a `Worker`. */
export function portConnectionProvider(port: GlspPortLike): ConnectionProvider {
  return () =>
    createMessageConnection(
      new BrowserMessageReader(port as never),
      new BrowserMessageWriter(port as never),
    );
}

/** A Node launcher's WebSocket (`@istar-ts/glsp/node`'s `startIstarGlspServer`). */
export function websocketConnectionProvider(url: string): ConnectionProvider {
  return () => new GLSPWebSocketProvider(url).listen({});
}
