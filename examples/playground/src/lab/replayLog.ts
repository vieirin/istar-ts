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
  type IstarOperation,
} from '@istar-ts/actions';
import {
  type AnyIstarModel,
  type AnyMetamodel,
  createModelStore,
  metamodelOf,
} from '@istar-ts/core';
import type { LogEntry } from './log';

type Operation = IstarOperation<string, string>;

/** How many new element ids, then new link ids, `operation` creates, mirroring the dispatcher's
 * `createdIds` diff (`packages/actions/src/dispatcher.ts`) and `connect`/`addDependency`/`addLeg`
 * (`packages/core/src/operations.ts`). */
function countCreatedIds(
  operation: Operation,
  model: AnyIstarModel,
): { elements: number; links: number } {
  switch (operation.kind) {
    case 'createNode':
      return { elements: 1, links: 0 };
    case 'createEdge': {
      const metamodel = metamodelOf(model) as AnyMetamodel;
      const definition = metamodel.links.get(operation.elementTypeId);
      if (definition?.category === 'dependency') return { elements: 1, links: 2 };
      if (definition?.parts && !targetIsHub(operation, model, metamodel)) {
        // A new hub: hub (element) + leg + end (links).
        return { elements: 1, links: 2 };
      }
      return { elements: 0, links: 1 };
    }
    case 'istar.addLeg':
      return { elements: 0, links: 1 };
    case 'compound': {
      let elements = 0;
      let links = 0;
      for (const child of operation.operationList as readonly Operation[]) {
        const counts = countCreatedIds(child, model);
        elements += counts.elements;
        links += counts.links;
      }
      return { elements, links };
    }
    default:
      return { elements: 0, links: 0 };
  }
}

function targetIsHub(
  operation: Extract<Operation, { kind: 'createEdge' }>,
  model: AnyIstarModel,
  metamodel: AnyMetamodel,
): boolean {
  const targetKind = model.elements.get(operation.targetElementId)?.kind;
  return targetKind !== undefined && metamodel.elements.get(targetKind)?.role === 'hub';
}

/** `operation` with ids from `elementIds`/`linkIds` (consumed in model order) injected as the
 * explicit ids its creates take, so a dispatcher that applies it against the same model state
 * creates the same ids. */
function withCreatedIds(
  operation: Operation,
  elementIds: string[],
  linkIds: string[],
  model: AnyIstarModel,
): Operation {
  switch (operation.kind) {
    case 'createNode': {
      const id = elementIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'createEdge': {
      const metamodel = metamodelOf(model) as AnyMetamodel;
      const definition = metamodel.links.get(operation.elementTypeId);
      if (definition?.category === 'dependency') {
        const dependumId = elementIds.shift();
        const linkIds2 = [linkIds.shift(), linkIds.shift()] as const;
        if (dependumId === undefined || linkIds2[0] === undefined || linkIds2[1] === undefined) {
          return operation;
        }
        return {
          ...operation,
          args: {
            ...operation.args,
            dependum: { ...operation.args?.dependum, id: dependumId },
            linkIds: linkIds2 as readonly [string, string],
          },
        };
      }
      if (definition?.parts && !targetIsHub(operation, model, metamodel)) {
        const hubId = elementIds.shift();
        const legId = linkIds.shift();
        const endId = linkIds.shift();
        return hubId === undefined || legId === undefined || endId === undefined
          ? operation
          : { ...operation, args: { ...operation.args, id: hubId, legId, endId } };
      }
      const id = linkIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'istar.addLeg': {
      const id = linkIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'compound':
      return {
        ...operation,
        operationList: (operation.operationList as readonly Operation[]).map((child) =>
          withCreatedIds(child, elementIds, linkIds, model),
        ),
      };
    default:
      return operation;
  }
}

/** `operation`, with `createdIds` (an accepted result's) injected as explicit ids. */
export function injectCreatedIds(
  operation: Operation,
  createdIds: readonly string[],
  model: AnyIstarModel,
): Operation {
  const counts = countCreatedIds(operation, model);
  const elementIds = createdIds.slice(0, counts.elements);
  const linkIds = createdIds.slice(counts.elements, counts.elements + counts.links);
  return withCreatedIds(operation, [...elementIds], [...linkIds], model);
}

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
