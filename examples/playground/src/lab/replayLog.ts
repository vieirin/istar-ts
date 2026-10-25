/**
 * Deterministic replay of the protocol lab's log (#46, #42 items 4–5): a fresh store from the
 * log's recorded initial model, each accepted operation, `glspUndo` or `glspRedo` entry
 * re-dispatched in order (an operation with its recorded `result.createdIds` injected back as
 * explicit ids, so the replayed model's ids match the original's), so the replayed model matches
 * the live one, undos and redos included. "Skip this action" reruns the replay without one entry;
 * entries after it that now fail are kept in the preview, marked rejected, not dropped.
 *
 * Skipping an operation also skips the `glspUndo`/`glspRedo` entries paired with it
 * (`undoRedoPairs`): an undo that isn't preceded by the operation it undid would instead undo
 * some earlier, unrelated one. Requests and notifications stay unreplayed: they don't change the
 * model.
 *
 */
import {
  type ActionDispatcher,
  type ActionResult,
  createActionDispatcher,
  isOperation,
  type IstarAction,
} from '@istar-ts/actions';
import { type AnyIstarModel, createModelStore } from '@istar-ts/core';
import { injectCreatedIds } from './createdIds';
import type { LogEntry } from './log';

/** True for the entries replay acts on: accepted operations, `glspUndo` and `glspRedo`. Requests
 * and notifications don't change the model, so they have nothing to contribute. */
function isReplayable(entry: LogEntry): boolean {
  if (!entry.result.ok) return false;
  const action = entry.action as IstarAction<string, string>;
  return isOperation(action) || action.kind === 'glspUndo' || action.kind === 'glspRedo';
}

/**
 * For each `glspUndo`/`glspRedo` entry of `entries`, the id of the operation entry it pairs with
 * (the one it undoes, or re-applies), tracked the way the live store's undo/redo stacks would:
 * every operation pushes onto the undo stack and clears the redo stack; `glspUndo` pops the undo
 * stack onto the redo stack; `glspRedo` pops the redo stack back onto the undo stack. An undo or
 * redo with nothing to pop (e.g. undoing past the start) has no entry here.
 */
function undoRedoPairs(entries: readonly LogEntry[]): ReadonlyMap<number, number> {
  const pairs = new Map<number, number>();
  const undoStack: number[] = [];
  const redoStack: number[] = [];
  for (const entry of entries) {
    const action = entry.action as IstarAction<string, string>;
    if (isOperation(action)) {
      undoStack.push(entry.id);
      redoStack.length = 0;
    } else if (action.kind === 'glspUndo') {
      const id = undoStack.pop();
      if (id !== undefined) {
        redoStack.push(id);
        pairs.set(entry.id, id);
      }
    } else if (action.kind === 'glspRedo') {
      const id = redoStack.pop();
      if (id !== undefined) {
        undoStack.push(id);
        pairs.set(entry.id, id);
      }
    }
  }
  return pairs;
}

/** `skippedIds` plus every `glspUndo`/`glspRedo` entry paired (`undoRedoPairs`) with one of them. */
function withPairedSkips(
  entries: readonly LogEntry[],
  skippedIds: ReadonlySet<number>,
  pairs: ReadonlyMap<number, number>,
): ReadonlySet<number> {
  const expanded = new Set(skippedIds);
  for (const entry of entries) {
    const pairedId = pairs.get(entry.id);
    if (pairedId !== undefined && expanded.has(pairedId)) expanded.add(entry.id);
  }
  return expanded;
}

export interface ReplayStep {
  readonly entry: LogEntry;
  readonly skipped: boolean;
  /** Absent when `skipped`; an operation rejected on replay (e.g. a later step needed a skipped
   * step's created id) is kept here with `ok: false`, not dropped. */
  readonly result?: ActionResult<never>;
}

export interface ReplayOutcome {
  readonly model: AnyIstarModel;
  readonly steps: readonly ReplayStep[];
}

/**
 * Replays `entries`' accepted operations onto a fresh store from `initialModel`, in order,
 * skipping the entries whose `id` is in `skippedIds` (their createdIds are not replayed as ids
 * of anything, so later entries that used them are rejected, not silently dropped).
 */
export async function replayLog(
  initialModel: AnyIstarModel,
  entries: readonly LogEntry[],
  skippedIds: ReadonlySet<number> = new Set(),
): Promise<ReplayOutcome> {
  const replayable = replayableEntries(entries);
  const effectiveSkips = withPairedSkips(replayable, skippedIds, undoRedoPairs(replayable));
  const store = createModelStore(initialModel);
  const dispatcher: ActionDispatcher<string, string> = createActionDispatcher(store);
  const steps: ReplayStep[] = [];
  for (const entry of replayable) {
    if (effectiveSkips.has(entry.id)) {
      steps.push({ entry, skipped: true });
      continue;
    }
    const action = entry.action as IstarAction<string, string>;
    const dispatched = isOperation(action)
      ? injectCreatedIds(
          action,
          (entry.result as { createdIds: readonly string[] }).createdIds,
          store.getModel(),
        )
      : action;
    const result = await dispatcher.dispatch(dispatched);
    steps.push({ entry, skipped: false, result: result as ActionResult<never> });
  }
  return { model: store.getModel(), steps };
}

/** The entries replay acts on (`isReplayable`), in log order. */
export function replayableEntries(entries: readonly LogEntry[]): readonly LogEntry[] {
  return entries.filter(isReplayable);
}
