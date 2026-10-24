/**
 * The protocol lab's action log: one row per dispatch, across every client. `tagClient` appends
 * to it; the Action Log tab reads it. Parts 2–4 (#46–#48, replay/export/guards) build on
 * `LogEntry` and need `result.createdIds`, so the shape stays exactly the dispatcher's
 * `ActionResult`.
 *
 * Replay (#46) needs a model to replay from: the log also tracks the snapshot the live model
 * was in before its first still-recorded entry (`getInitialModel`). `attachStore` keeps it
 * current by watching the store it's given: it captures the model right away, and a `load`
 * (a fixture switch, an opened file, a replay applied to the canvas) both resets it to the newly
 * loaded model and clears the log, since old entries don't replay onto an unrelated model.
 */
import {
  type AnyIstarModel,
  type AnyMetamodel,
  type ModelStore,
  parsePistar,
  type PistarFile,
  toPistarObject,
} from '@istar-ts/core';
import type { ActionResult, IstarAction, IstarResponseAction } from '@istar-ts/actions';

export interface LogEntry {
  readonly id: number;
  /** Who dispatched the action: "UI" (canvas + inspector, see tagClient.ts), "Worker", "Script". */
  readonly client: string;
  readonly action: IstarAction<string, string>;
  readonly result: ActionResult<IstarResponseAction>;
  readonly startedAt: number;
  readonly durationMs: number;
}

export type LogAction =
  | { readonly type: 'append'; readonly entry: Omit<LogEntry, 'id'> }
  | {
      readonly type: 'clear';
    };

/** Pure reducer over the log's entries; `createLogStore` is this plus a subscribable store. */
export function logReducer(entries: readonly LogEntry[], action: LogAction): readonly LogEntry[] {
  switch (action.type) {
    case 'append':
      return [...entries, { ...action.entry, id: entries.length }];
    case 'clear':
      return [];
  }
}

export interface LogStore {
  getEntries(): readonly LogEntry[];
  subscribe(listener: () => void): () => void;
  append(entry: Omit<LogEntry, 'id'>): void;
  clear(): void;
  /** The model replay starts from: the live model before the log's current entries. */
  getInitialModel(): AnyIstarModel | undefined;
  setInitialModel(model: AnyIstarModel): void;
  /** Keeps `getInitialModel` current with `store`'s loads; see the file comment. Returns an unsubscribe function. */
  attachStore(store: ModelStore<string, string>): () => void;
}

/** A log store for `useSyncExternalStore`: `getEntries` is stable until the next `append`/`clear`. */
export function createLogStore(): LogStore {
  let entries: readonly LogEntry[] = [];
  let initialModel: AnyIstarModel | undefined;
  const listeners = new Set<() => void>();
  const dispatch = (action: LogAction): void => {
    entries = logReducer(entries, action);
    for (const listener of listeners) listener();
  };
  return {
    getEntries: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    append: (entry) => dispatch({ type: 'append', entry }),
    clear: () => dispatch({ type: 'clear' }),
    getInitialModel: () => initialModel,
    setInitialModel: (model) => {
      initialModel = model;
    },
    attachStore(store) {
      initialModel = store.getModel();
      return store.subscribe((event) => {
        if (event.source !== 'load') return;
        initialModel = event.model;
        dispatch({ type: 'clear' });
      });
    },
  };
}

/** The log as JSON: the initial model (a piStar save file) plus its entries. Import replays it. */
export interface LogExport {
  readonly initialModel: PistarFile;
  readonly entries: readonly LogEntry[];
}

export function exportLog(log: LogStore): LogExport {
  const initialModel = log.getInitialModel();
  if (!initialModel) throw new Error('the log has no initial model to export');
  return { initialModel: toPistarObject(initialModel), entries: log.getEntries() };
}

/** Parses an exported log's initial model under `metamodel` (default: its own file metamodel block, else iStar 2.0). */
export function parseLogExport(
  json: unknown,
  metamodel?: AnyMetamodel,
): { readonly initialModel: AnyIstarModel; readonly entries: readonly LogEntry[] } {
  const parsed = json as LogExport;
  const initialModel = metamodel
    ? parsePistar(parsed.initialModel, { metamodel, fileMetamodel: true })
    : parsePistar(parsed.initialModel, { fileMetamodel: true });
  return { initialModel, entries: parsed.entries };
}
