/**
 * Deterministic replay of the protocol lab's log (#46, #42 items 4–5): a fresh store from the
 * log's recorded initial model, each accepted operation entry re-dispatched in order with its
 * recorded `result.createdIds` injected back as explicit ids, so the replayed model's ids match
 * the original's. "Skip this action" reruns the replay without one entry; entries after it that
 * now fail are kept in the preview, marked rejected, not dropped.
 *
 * Only operation entries are replayed (`isOperation`): requests, undo/redo and notifications
 * don't change the model, so replaying them has nothing to contribute.
 *
 * Gap (out of scope: no `packages/actions` change): `createEdge` of an n-ary kind, when its
 * target isn't already one of the kind's hubs, creates a new hub, leg and end
 * (`packages/core/src/operations.ts`'s `connectHub`); only the hub's id is settable
 * (`CreateEdgeArgs.id`), so a model that creates a brand-new n-ary hub this way won't replay
 * with byte-identical leg/end ids. `istar.addLeg` and dependency `createEdge` (which carry their
 * own `args.id` / `dependum.id` / `args.linkIds`) are unaffected.
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
        // A new hub: hub (element) + leg + end (links) — see the file comment's gap.
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
        linkIds.shift();
        linkIds.shift();
        return hubId === undefined
          ? operation
          : { ...operation, args: { ...operation.args, id: hubId } };
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
  const store = createModelStore(initialModel);
  const dispatcher: ActionDispatcher<string, string> = createActionDispatcher(store);
  const steps: ReplayStep[] = [];
  for (const entry of entries) {
    if (!entry.result.ok || !isOperation(entry.action as IstarAction<string, string>)) continue;
    if (skippedIds.has(entry.id)) {
      steps.push({ entry, skipped: true });
      continue;
    }
    const operation = injectCreatedIds(
      entry.action as Operation,
      entry.result.createdIds,
      store.getModel(),
    );
    const result = await dispatcher.dispatch(operation);
    steps.push({ entry, skipped: false, result: result as ActionResult<never> });
  }
  return { model: store.getModel(), steps };
}

/** The entries replay acts on: accepted operations, in log order. Other entries (requests,
 * undo/redo, notifications) have no row in the replay preview. */
export function replayableEntries(entries: readonly LogEntry[]): readonly LogEntry[] {
  return entries.filter((e) => e.result.ok && isOperation(e.action as IstarAction<string, string>));
}
