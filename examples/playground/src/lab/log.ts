/**
 * The protocol lab's action log: one row per dispatch, across every client. `tagClient` appends
 * to it; the Action Log tab reads it. Parts 2–4 (#46–#48, replay/export/guards) build on
 * `LogEntry` and need `result.createdIds`, so the shape stays exactly the dispatcher's
 * `ActionResult`.
 */
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
}

/** A log store for `useSyncExternalStore`: `getEntries` is stable until the next `append`/`clear`. */
export function createLogStore(): LogStore {
  let entries: readonly LogEntry[] = [];
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
  };
}
