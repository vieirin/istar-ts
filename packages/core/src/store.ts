/**
 * An event-emitting store around an immutable `IstarModel`, with undo/redo.
 *
 * Every mutation produces a new model snapshot; history is a stack of snapshots, which is cheap
 * because unchanged elements and links are shared between snapshots. This replaces piStar's
 * `undoManager.js`, which stacked hand-written undo closures.
 *
 * `subscribe` + `getModel` match React's `useSyncExternalStore` contract.
 */
import type { LinkCheck } from './constraints';
import { canLink } from './constraints';
import type { ElementKind, LinkKind } from './metamodel';
import type { Metamodel } from './metamodels';
import type { AnyIstarModel, Diagram, IstarElement, IstarModel } from './model';
import { createEmptyModel } from './model';
import type {
  ConnectOptions,
  ElementPatch,
  IdGenerator,
  LinkPatch,
  NewDependency,
  NewElement,
  NewLink,
} from './operations';
import * as ops from './operations';

/** What happened, for listeners that want more than the new snapshot. */
export type ModelChange =
  | { type: 'addElement'; id: string }
  | { type: 'updateElement'; id: string; patch: ElementPatch }
  | { type: 'moveElement'; id: string; x: number; y: number }
  | { type: 'nestElement'; id: string; parent: string | null }
  | { type: 'removeElements'; ids: readonly string[] }
  | { type: 'connect'; id: string }
  | { type: 'addDependency'; dependumId: string; linkIds: readonly [string, string] }
  | { type: 'updateLink'; id: string; patch: LinkPatch }
  | { type: 'disconnect'; id: string }
  | { type: 'updateDiagram'; patch: Partial<Diagram> }
  | { type: 'replace' };

export interface ModelChangeEvent<EK extends string = ElementKind, LK extends string = LinkKind> {
  readonly model: IstarModel<EK, LK>;
  readonly previous: IstarModel<EK, LK>;
  /** `undo`/`redo`/`load` carry no changes; a transaction carries all of its changes. */
  readonly changes: readonly ModelChange[];
  readonly source: 'edit' | 'undo' | 'redo' | 'load';
}

export type ModelListener<EK extends string = ElementKind, LK extends string = LinkKind> = (
  event: ModelChangeEvent<EK, LK>,
) => void;

export interface ModelStoreOptions<EK extends string = ElementKind, LK extends string = LinkKind> {
  /**
   * Metamodel for the default empty model, when no initial model is given. A given initial
   * model keeps its own (`model.metamodel`).
   */
  readonly metamodel?: Metamodel<EK, LK>;
  readonly createId?: IdGenerator;
  /** Maximum number of undo steps kept. Default 100. */
  readonly historyLimit?: number;
}

export interface ModelStore<EK extends string = ElementKind, LK extends string = LinkKind> {
  getModel(): IstarModel<EK, LK>;
  /** Returns an unsubscribe function. */
  subscribe(listener: ModelListener<EK, LK>): () => void;

  canLink(
    source: string | IstarElement<EK>,
    target: string | IstarElement<EK>,
    kind: LK,
  ): LinkCheck;

  addElement(input: NewElement<EK>): IstarElement<EK>;
  updateElement(id: string, patch: ElementPatch): void;
  moveElement(id: string, x: number, y: number): void;
  nestElement(id: string, parent: string | null): void;
  removeElement(id: string): void;
  removeElements(ids: Iterable<string>): void;
  setCollapsed(actorId: string, collapsed: boolean): void;

  connect(
    input: NewLink<LK>,
    options?: Omit<ConnectOptions, 'createId'>,
  ): ops.ConnectResult<EK, LK>;
  addDependency(
    input: NewDependency<EK, LK>,
    options?: Omit<ConnectOptions, 'createId' | 'tryReversed'>,
  ): ops.AddDependencyResult<EK, LK>;
  updateLink(id: string, patch: LinkPatch): void;
  disconnect(id: string): void;
  updateDiagram(patch: Partial<Diagram>): void;

  /** Replaces the model as one undoable edit. */
  replace(model: IstarModel<EK, LK>): void;
  /** Replaces the model and clears history (like opening a file in piStar). */
  load(model: IstarModel<EK, LK>): void;

  /**
   * Groups several edits into one undo step and one change event. Nested calls join the
   * outermost transaction. If `fn` throws, the model is rolled back.
   */
  transaction<T>(fn: () => T): T;

  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  clearHistory(): void;
}

export function createModelStore(initial?: IstarModel, options?: ModelStoreOptions): ModelStore;
export function createModelStore<EK extends string, LK extends string>(
  initial: IstarModel<EK, LK> | undefined,
  options?: ModelStoreOptions<EK, LK>,
): ModelStore<EK, LK>;
export function createModelStore(
  initial?: AnyIstarModel,
  options: ModelStoreOptions<string, string> = {},
): ModelStore<string, string> {
  initial ??= options.metamodel
    ? createEmptyModel(undefined, { metamodel: options.metamodel })
    : (createEmptyModel() as AnyIstarModel);
  const limit = options.historyLimit ?? 100;
  const ctx = { createId: options.createId ?? ops.defaultIdGenerator };
  const listeners = new Set<ModelListener<string, string>>();
  let model = initial;
  let past: AnyIstarModel[] = [];
  let future: AnyIstarModel[] = [];
  let tx: { start: AnyIstarModel; changes: ModelChange[]; depth: number } | undefined;

  const emit = (event: ModelChangeEvent<string, string>): void => {
    for (const listener of listeners) listener(event);
  };

  const commit = (next: AnyIstarModel, change: ModelChange): void => {
    if (next === model) return;
    if (tx) {
      model = next;
      tx.changes.push(change);
      return;
    }
    const previous = model;
    past.push(previous);
    if (past.length > limit) past = past.slice(past.length - limit);
    future = [];
    model = next;
    emit({ model, previous, changes: [change], source: 'edit' });
  };

  const store: ModelStore<string, string> = {
    getModel: () => model,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    canLink: (source, target, kind) => canLink(model, source, target, kind),

    addElement(input) {
      const result = ops.addElement(model, input, ctx);
      commit(result.model, { type: 'addElement', id: result.element.id });
      return result.element;
    },
    updateElement(id, patch) {
      commit(ops.updateElement(model, id, patch), { type: 'updateElement', id, patch });
    },
    moveElement(id, x, y) {
      commit(ops.moveElement(model, id, x, y), { type: 'moveElement', id, x, y });
    },
    nestElement(id, parent) {
      commit(ops.nestElement(model, id, parent), { type: 'nestElement', id, parent });
    },
    removeElement(id) {
      commit(ops.removeElement(model, id), { type: 'removeElements', ids: [id] });
    },
    removeElements(ids) {
      const list = [...ids];
      commit(ops.removeElements(model, list), { type: 'removeElements', ids: list });
    },
    setCollapsed(actorId, collapsed) {
      const patch = { display: { collapsed: collapsed ? true : undefined } };
      commit(ops.updateElement(model, actorId, patch), {
        type: 'updateElement',
        id: actorId,
        patch,
      });
    },

    connect(input, connectOptions) {
      const result = ops.connect(model, input, { ...connectOptions, ...ctx });
      if (result.ok) commit(result.model, { type: 'connect', id: result.link.id });
      return result;
    },
    addDependency(input, dependencyOptions) {
      const result = ops.addDependency(model, input, { ...dependencyOptions, ...ctx });
      if (result.ok) {
        commit(result.model, {
          type: 'addDependency',
          dependumId: result.dependum.id,
          linkIds: [result.links[0].id, result.links[1].id],
        });
      }
      return result;
    },
    updateLink(id, patch) {
      commit(ops.updateLink(model, id, patch), { type: 'updateLink', id, patch });
    },
    disconnect(id) {
      commit(ops.disconnect(model, id), { type: 'disconnect', id });
    },
    updateDiagram(patch) {
      commit(ops.updateDiagram(model, patch), { type: 'updateDiagram', patch });
    },

    replace(next) {
      commit(next, { type: 'replace' });
    },
    load(next) {
      if (tx) throw new ops.ModelOperationError('cannot load inside a transaction');
      const previous = model;
      model = next;
      past = [];
      future = [];
      emit({ model, previous, changes: [], source: 'load' });
    },

    transaction<T>(fn: () => T): T {
      if (tx) {
        tx.depth++;
        try {
          return fn();
        } finally {
          tx.depth--;
        }
      }
      tx = { start: model, changes: [], depth: 1 };
      let result: T;
      try {
        result = fn();
      } catch (error) {
        model = tx.start;
        tx = undefined;
        throw error;
      }
      const { start, changes } = tx;
      tx = undefined;
      if (model !== start) {
        past.push(start);
        if (past.length > limit) past = past.slice(past.length - limit);
        future = [];
        emit({ model, previous: start, changes, source: 'edit' });
      }
      return result;
    },

    undo() {
      const previous = past.pop();
      if (!previous || tx) return false;
      future.push(model);
      const current = model;
      model = previous;
      emit({ model, previous: current, changes: [], source: 'undo' });
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next || tx) return false;
      past.push(model);
      const current = model;
      model = next;
      emit({ model, previous: current, changes: [], source: 'redo' });
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clearHistory() {
      past = [];
      future = [];
    },
  };
  return store;
}
