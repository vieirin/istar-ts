/**
 * `@istar-ts/glsp/page`: what a page imports to reach the model of a GLSP worker
 * (`startIstarGlspWorker`) as an istar-ts action client. No GLSP, Inversify or
 * `reflect-metadata` here, so the page's bundle stays small.
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
