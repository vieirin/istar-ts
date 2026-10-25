/**
 * A mirror store: a read-only `ModelStore` in this process whose model follows a dispatcher that
 * lives elsewhere (a worker, a server, the other end of a `createRemoteDispatcher` port), so a
 * canvas and an inspector written against `ModelStore` can render it. Edits never touch the
 * mirror: they are dispatched to the remote, and come back as the remote's `sourceModelChanged`.
 *
 * How the model travels: an initial `requestModel`, then one update per `sourceModelChanged`.
 * A notification that carries the new model (`newRoot`, a dispatcher created with `sendModel`)
 * is applied as it arrives; one without it is answered with a `requestModel`, in order. Either
 * way the update is a whole piStar file, re-parsed (2 ms for the largest fixture, 237 ids), and
 * then shared with the previous model: an element, link or diagram equal to the one it replaces
 * keeps the old object, so whatever is memoised on identity only redoes what changed.
 */
import {
  FILE_METAMODEL_KEY,
  ModelOperationError,
  canLink,
  createEmptyModel,
  inheritMetamodel,
  inheritSourceLayout,
  metamodelOf,
  parsePistar,
} from '@istar-ts/core';
import type {
  AnyIstarModel,
  AnyMetamodel,
  ElementKind,
  LinkKind,
  Metamodel,
  ModelChange,
  ModelChangeEvent,
  ModelListener,
  ModelStore,
  ParsePistarOptions,
  PistarFile,
} from '@istar-ts/core';
import type { ActionDispatcher, ActionResult } from './dispatcher';

export interface MirrorStoreOptions<EK extends string = ElementKind, LK extends string = LinkKind> {
  /**
   * The metamodel the remote's files are read with (`parsePistar`'s `metamodel`), and of the
   * empty model shown until the first one arrives. Default iStar 2.0.
   */
  readonly metamodel?: Metamodel<EK, LK>;
  /** `parsePistar`'s `fileMetamodel`: apply the file's own `"metamodel"` block. Default false. */
  readonly fileMetamodel?: boolean;
  /**
   * How many undo steps the remote keeps, for `canUndo` estimate (see `MirrorStore`). Only used
   * when the dispatcher doesn't send exact values. Default 100, a `ModelStore`'s default.
   */
  readonly historyLimit?: number;
  /** Hears a failed update (a transport fault, a file that doesn't parse). Default: ignored. */
  readonly onError?: (error: unknown) => void;
}

/**
 * A `ModelStore` whose model is the remote's. Reading (`getModel`, `subscribe`, `canLink`) works
 * as on any store; every mutation (`addElement` … `replace`, `load`, `transaction`,
 * `clearHistory`) throws a `ModelOperationError`: dispatch the edit to the remote instead.
 *
 * Undo is the remote's, one stack for all its clients: `undo`/`redo` dispatch `glspUndo` /
 * `glspRedo` to it. `canUndo`/`canRedo` are exact when the dispatcher sends them with each
 * change (a dispatcher created with `sendModel`), or an estimate counted from the notifications
 * heard since the mirror connected (the remote doesn't publish its stack's depth when not sending
 * them): edits made before then are not counted.
 */
export interface MirrorStore<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends ModelStore<EK, LK> {
  /** Resolves once the remote's model is shown; rejects if the first `requestModel` fails. */
  readonly ready: Promise<void>;
  /**
   * The remote, wrapped so that `dispatch` resolves only once the mirror shows what the action
   * did: give this to `IstarProvider` as `dispatcher`. (With a `sendModel` remote, the remote
   * itself already has that order, since a change's notification arrives before its result.)
   */
  readonly dispatcher: ActionDispatcher<EK, LK>;
  /** Resolves once every change heard so far is shown. */
  synced(): Promise<void>;
  /** Stops following the remote (the remote itself stays open). */
  dispose(): void;
}

type Source = ModelChangeEvent['source'];

/** Deep equality of JSON values (what parsed models are made of). */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * `next`, with every element, link and the diagram that equals `previous`'s kept as
 * `previous`'s object; `previous` itself when nothing differs (in content, order or metamodel).
 */
function share(previous: AnyIstarModel, next: AnyIstarModel): AnyIstarModel {
  let same =
    previous.elements.size === next.elements.size &&
    previous.links.size === next.links.size &&
    metamodelOf(previous) === metamodelOf(next);
  const shareMap = <T>(
    from: ReadonlyMap<string, T>,
    to: ReadonlyMap<string, T>,
  ): Map<string, T> => {
    const order = from.keys();
    const out = new Map<string, T>();
    for (const [id, value] of to) {
      const old = from.get(id);
      const keep = old !== undefined && equal(old, value);
      if (!keep || order.next().value !== id) same = false;
      out.set(id, keep ? old : value);
    }
    return out;
  };
  const elements = shareMap(previous.elements, next.elements);
  const links = shareMap(previous.links, next.links);
  const diagram = equal(previous.diagram, next.diagram) ? previous.diagram : next.diagram;
  const { elements: _e, links: _l, diagram: _d, ...rest } = next;
  const { elements: _pe, links: _pl, diagram: _pd, ...previousRest } = previous;
  if (same && equal(rest, previousRest)) return previous;
  const shared: AnyIstarModel = {
    ...rest,
    elements,
    links,
    ...(diagram === undefined ? {} : { diagram }),
  };
  return inheritMetamodel(next, inheritSourceLayout(next, shared));
}

function readOnly(): never {
  throw new ModelOperationError(
    'a mirror store is read-only: dispatch the edit through its remote dispatcher',
  );
}

const parseWith = parsePistar as (
  file: PistarFile,
  options: ParsePistarOptions<string, string>,
) => AnyIstarModel;

/**
 * A mirror of `remote`'s model (see `MirrorStore`). Shows an empty model until `ready`.
 *
 * Order: changes are shown in the order the remote sends them, whoever made them, and a
 * `dispatch` through `mirror.dispatcher` resolves after its change is shown, so code that
 * selects a created id or rolls back a rejected one sees the model it expects. A rejected
 * action sends no notification: the mirror stays as it was.
 */
export function createMirrorStore<EK extends string = ElementKind, LK extends string = LinkKind>(
  remote: ActionDispatcher<EK, LK>,
  options: MirrorStoreOptions<EK, LK> = {},
): MirrorStore<EK, LK> {
  const r = remote as unknown as ActionDispatcher<string, string>;
  const metamodel = options.metamodel as unknown as AnyMetamodel | undefined;
  const limit = options.historyLimit ?? 100;
  const onError = options.onError ?? (() => {});
  const listeners = new Set<ModelListener<string, string>>();
  let model: AnyIstarModel = metamodel
    ? createEmptyModel(undefined, { metamodel })
    : (createEmptyModel() as AnyIstarModel);
  /** The last file's `"metamodel"` block, as JSON; `undefined` before the first file. */
  let block: string | undefined;
  let undoDepth = 0;
  let redoDepth = 0;
  /** How many pushed models (`newRoot`) were applied: a response asked for before one is stale. */
  let pushed = 0;
  let requests = 0;
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;

  const parse = (file: PistarFile): AnyIstarModel => {
    const nextBlock = JSON.stringify((file as Record<string, unknown>)[FILE_METAMODEL_KEY] ?? null);
    if (nextBlock === block) {
      // The same file metamodel: read with the current model's metamodel, so `metamodelOf` keeps
      // its identity (a registry memoised on it isn't rebuilt on every change).
      return inheritMetamodel(model, parseWith(file, { metamodel: metamodelOf(model) }));
    }
    const parsed = parseWith(file, {
      ...(metamodel ? { metamodel } : {}),
      ...(options.fileMetamodel ? { fileMetamodel: true } : {}),
    });
    block = nextBlock;
    return parsed;
  };

  const apply = (file: PistarFile, source: Source, changes: readonly ModelChange[]): void => {
    const previous = model;
    const next = share(previous, parse(file));
    if (next === previous) return;
    model = next;
    const event: ModelChangeEvent<string, string> = { model, previous, changes, source };
    for (const listener of listeners) listener(event);
  };

  /** Counts the remote's undo stack from what it reports (see `MirrorStore`). */
  const track = (
    source: Source,
    exact?: { readonly canUndo: boolean; readonly canRedo: boolean },
  ): void => {
    if (exact) {
      undoDepth = exact.canUndo ? 1 : 0;
      redoDepth = exact.canRedo ? 1 : 0;
    } else if (source === 'edit') {
      undoDepth = Math.min(undoDepth + 1, limit);
      redoDepth = 0;
    } else if (source === 'undo') {
      undoDepth = Math.max(undoDepth - 1, 0);
      redoDepth++;
    } else if (source === 'redo') {
      undoDepth = Math.min(undoDepth + 1, limit);
      redoDepth = Math.max(redoDepth - 1, 0);
    } else {
      undoDepth = 0;
      redoDepth = 0;
    }
  };

  /**
   * Asks for the model now (so the remote answers in order) and shows it once every earlier
   * update is shown. Dropped if a pushed model arrived meanwhile: that one is at least as new.
   */
  const refresh = (source: Source, changes: readonly ModelChange[]): Promise<void> => {
    const seen = pushed;
    const sent = r
      .dispatch({ kind: 'requestModel', requestId: `mirror-${++requests}` })
      .then((result: ActionResult<{ readonly newRoot: PistarFile }>) => ({ result }))
      .catch((error: unknown) => ({ error }));
    const step = tail.then(async () => {
      const answer = await sent;
      if (disposed || pushed !== seen) return;
      if ('error' in answer) throw answer.error;
      const { result } = answer;
      if (!result.ok) {
        throw new Error(result.diagnostics[0]?.message ?? 'requestModel was rejected');
      }
      if (!result.response) throw new Error('requestModel was answered without a model');
      apply(result.response.newRoot, source, changes);
    });
    tail = step.catch(onError);
    return step;
  };

  const unsubscribe = r.subscribe((action) => {
    if (disposed || action.kind !== 'sourceModelChanged') return;
    track(
      action.source,
      action.canUndo !== undefined && action.canRedo !== undefined
        ? { canUndo: action.canUndo, canRedo: action.canRedo }
        : undefined,
    );
    if (action.newRoot) {
      pushed++;
      try {
        apply(action.newRoot, action.source, action.changes);
      } catch (error) {
        onError(error);
      }
    } else {
      void refresh(action.source, action.changes).catch(() => {});
    }
  });

  const ready = refresh('load', []);
  // `ready` rejects for whoever awaits it; unawaited, the failure only reaches `onError`.
  ready.catch(() => {});

  const send = (kind: 'glspUndo' | 'glspRedo'): void => {
    void r.dispatch({ kind }).catch(onError);
  };

  const dispatcher: ActionDispatcher<string, string> = {
    async dispatch(action, options) {
      const result = await r.dispatch(action, options);
      await tail;
      return result;
    },
    subscribe: (listener) => r.subscribe(listener),
  };

  const store: MirrorStore<string, string> = {
    ready,
    dispatcher,
    synced: () => tail,
    dispose() {
      disposed = true;
      unsubscribe();
    },

    getModel: () => model,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canLink: (source, target, kind) => canLink(model, source, target, kind),

    addElement: readOnly,
    updateElement: readOnly,
    moveElement: readOnly,
    nestElement: readOnly,
    removeElement: readOnly,
    removeElements: readOnly,
    setCollapsed: readOnly,
    connect: readOnly,
    addDependency: readOnly,
    addLeg: readOnly,
    removeLeg: readOnly,
    updateLink: readOnly,
    disconnect: readOnly,
    updateDiagram: readOnly,
    replace: readOnly,
    load: readOnly,
    transaction: readOnly,
    clearHistory: readOnly,

    undo() {
      if (undoDepth === 0) return false;
      send('glspUndo');
      return true;
    },
    redo() {
      if (redoDepth === 0) return false;
      send('glspRedo');
      return true;
    },
    canUndo: () => undoDepth > 0,
    canRedo: () => redoDepth > 0,
  };
  return store as unknown as MirrorStore<EK, LK>;
}
