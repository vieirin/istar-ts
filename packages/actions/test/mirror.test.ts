import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  ISTAR_2_0,
  ModelOperationError,
  createModelStore,
  defineMetamodel,
  detectFramework,
  metamodelOf,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import type { AnyIstarModel, ModelChangeEvent, ModelStore, PistarFile } from '@istar-ts/core';
import type {
  ActionDispatcher,
  ActionDispatcherOptions,
  ActionPostGuard,
  IstarAction,
  MirrorStore,
} from '../src';
import {
  connectDispatcher,
  createActionDispatcher,
  createMirrorStore,
  createRemoteDispatcher,
} from '../src';

const fixture = (path: string): string =>
  readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), 'utf8');

const SMART_HOME = fixture('pistar/smartHome.txt');

/** A small KAOS-like root, enough to exercise `metamodelFor` resolving a root by `tool`. */
const KAOS = defineMetamodel({
  name: 'kaos',
  prefix: 'kaos',
  elements: [{ kind: 'kaos.Goal', category: 'node' }],
  links: [{ kind: 'kaos.Refinement', rules: { sources: ['node'], targets: ['node'] } }],
  file: { tool: 'dsm3-goals' },
});

/** Resolves a file's root by `tool` among `[ISTAR_2_0, KAOS]`, iStar 2.0 when undetected. */
const metamodelFor = (file: PistarFile) => detectFramework(file, [ISTAR_2_0, KAOS]) ?? ISTAR_2_0;

/** A server over `model`, and a client of it on a real `MessageChannel`. */
function serve(
  model: AnyIstarModel | undefined,
  sendModel: boolean,
  options: Omit<ActionDispatcherOptions<string, string>, 'sendModel'> = {},
) {
  const store = model
    ? createModelStore(model)
    : createModelStore(undefined, { metamodel: ISTAR_2_0 });
  const server = createActionDispatcher(store, { ...options, sendModel });
  const connect = (): ActionDispatcher => {
    const { port1, port2 } = new MessageChannel();
    connectDispatcher(port1, server);
    return createRemoteDispatcher(port2);
  };
  return { store, server, connect };
}

/** Resolves on the mirror's next change event. */
function nextChange(mirror: ModelStore): Promise<ModelChangeEvent> {
  return new Promise((resolve) => {
    const off = mirror.subscribe((event) => {
      off();
      resolve(event);
    });
  });
}

// `toPistar` stamps a fresh `saveDate` (`new Date()`) on a model with none of its own (every
// model here, since none is parsed from a file); the frozen test clock (see
// `test-support/freeze-date.ts`) keeps two calls for the same content equal.
const text = (model: AnyIstarModel): string => toPistar(model);

/** Each port's last answer comes after every notification sent before it: a barrier. */
const barrier = (mirror: MirrorStore) =>
  mirror.dispatcher.dispatch({ kind: 'requestModel', requestId: 'barrier' });

/** True when `seen` is `states` with some skipped or repeated, never reordered. */
function inOrder(seen: readonly string[], states: readonly string[]): boolean {
  let at = 0;
  for (const state of seen) {
    const index = states.indexOf(state, at);
    if (index < 0) return false;
    at = index;
  }
  return true;
}

describe.each([
  { mode: 'pushed models (sendModel)', sendModel: true },
  { mode: 're-requested models', sendModel: false },
])('createMirrorStore, $mode', ({ sendModel }) => {
  test('shows the remote model once ready, and follows its changes', async () => {
    const { store, connect } = serve(parsePistar(SMART_HOME), sendModel);
    const mirror = createMirrorStore(connect());
    expect(mirror.getModel().elements.size).toBe(0);
    await mirror.ready;
    expect(text(mirror.getModel())).toBe(text(store.getModel()));

    const [actor] = [...store.getModel().elements.values()].filter((e) => e.kind === 'istar.Actor');
    const result = await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actor!.id,
      location: { x: actor!.x + 20, y: actor!.y + 20 },
      args: { id: 'new-goal', name: 'Mirrored' },
    });
    expect(result).toEqual({ ok: true, createdIds: ['new-goal'] });
    // Already there when the dispatch resolves.
    expect(mirror.getModel().elements.get('new-goal')).toMatchObject({
      name: 'Mirrored',
      parent: actor!.id,
    });
    expect(text(mirror.getModel())).toBe(text(store.getModel()));
  });

  test('a mirror follows istar.replaceModel', async () => {
    const { store, connect } = serve(parsePistar(SMART_HOME), sendModel);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const replacement = JSON.parse(text(store.getModel()));
    replacement.actors = [...replacement.actors].reverse();

    const result = await mirror.dispatcher.dispatch({
      kind: 'istar.replaceModel',
      model: replacement,
    });
    expect(result).toEqual({ ok: true, createdIds: [] });
    await mirror.synced();
    expect(text(mirror.getModel())).toBe(text(store.getModel()));
    expect(JSON.parse(text(store.getModel())).actors.map((a: { id: string }) => a.id)).toEqual(
      replacement.actors.map((a: { id: string }) => a.id),
    );
  });

  test('origin round-trips through the mirror dispatcher', async () => {
    const { connect } = serve(parsePistar(SMART_HOME), sendModel);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const [actor] = [...mirror.getModel().elements.values()].filter(
      (e) => e.kind === 'istar.Actor',
    );
    const received: IstarAction[] = [];
    mirror.dispatcher.subscribe((action) => received.push(action));
    await mirror.dispatcher.dispatch(
      { kind: 'createNode', elementTypeId: 'istar.Goal', containerId: actor!.id },
      { origin: 'inspector' },
    );
    const changed = received.find(
      (a): a is Extract<IstarAction, { kind: 'sourceModelChanged' }> =>
        a.kind === 'sourceModelChanged',
    );
    expect(changed?.origin).toBe('inspector');
  });

  test.runIf(sendModel)('the plain remote resolves after the mirror shows the change', async () => {
    const { connect } = serve(undefined, sendModel);
    const remote = connect();
    const mirror = createMirrorStore(remote);
    await mirror.ready;
    const result = await remote.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Actor',
      args: { id: 'plain' },
    });
    expect(result.ok).toBe(true);
    expect(mirror.getModel().elements.has('plain')).toBe(true);
  });

  test('keeps unchanged elements, links and the metamodel as the same objects', async () => {
    const { store, connect } = serve(parsePistar(SMART_HOME), sendModel);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const before = mirror.getModel();
    const [moved, other] = [...before.elements.values()].filter((e) => !e.parent);
    await mirror.dispatcher.dispatch({
      kind: 'changeBounds',
      newBounds: [{ elementId: moved!.id, newPosition: { x: moved!.x + 5, y: moved!.y } }],
    });
    const after = mirror.getModel();
    expect(after).not.toBe(before);
    expect(after.elements.get(moved!.id)?.x).toBe(moved!.x + 5);
    expect(after.elements.get(other!.id)).toBe(other);
    expect(after.links.values().next().value).toBe(before.links.values().next().value);
    expect(metamodelOf(after)).toBe(metamodelOf(before));
    expect(text(after)).toBe(text(store.getModel()));
  });

  test('a file metamodel is applied once and keeps its identity', async () => {
    const file = fixture('extensions/fileMetamodel.txt');
    const { connect } = serve(parsePistar(file, { fileMetamodel: true }), sendModel);
    const mirror = createMirrorStore(connect(), { fileMetamodel: true });
    await mirror.ready;
    const metamodel = metamodelOf(mirror.getModel());
    const [element] = mirror.getModel().elements.values();
    await mirror.dispatcher.dispatch({
      kind: 'applyLabelEdit',
      labelId: element!.id,
      text: 'Renamed',
    });
    expect(mirror.getModel().elements.get(element!.id)?.name).toBe('Renamed');
    expect(metamodelOf(mirror.getModel())).toBe(metamodel);
    expect(toPistar(mirror.getModel())).toBe(
      toPistar(parsePistar(toPistar(mirror.getModel()), { fileMetamodel: true })),
    );
  });

  test('two remote clients interleaving edits: both mirrors show every change in order', async () => {
    const { store, connect } = serve(undefined, sendModel);
    const a = createMirrorStore(connect());
    const b = createMirrorStore(connect());
    await Promise.all([a.ready, b.ready]);

    const serverStates: string[] = [];
    store.subscribe((event) => serverStates.push(text(event.model)));
    const states = (mirror: MirrorStore): string[] => {
      const seen: string[] = [];
      mirror.subscribe((event) => seen.push(text(event.model)));
      return seen;
    };
    const seenA = states(a);
    const seenB = states(b);

    const create = async (mirror: MirrorStore, id: string, x: number) => {
      const result = await mirror.dispatcher.dispatch({
        kind: 'createNode',
        elementTypeId: 'istar.Actor',
        location: { x, y: 0 },
        args: { id },
      });
      // A client's own edit is in its mirror by the time its dispatch resolves.
      expect(result.ok).toBe(true);
      expect(mirror.getModel().elements.has(id)).toBe(true);
    };
    const move = (mirror: MirrorStore, id: string, x: number) =>
      mirror.dispatcher.dispatch({
        kind: 'changeBounds',
        newBounds: [{ elementId: id, newPosition: { x, y: 0 } }],
      });

    await Promise.all([create(a, 'a1', 0), create(b, 'b1', 100), create(a, 'a2', 200)]);
    await Promise.all([
      move(a, 'b1', 1),
      move(b, 'a1', 2),
      move(a, 'a1', 3),
      move(b, 'b1', 4),
      a.dispatcher.dispatch({ kind: 'glspUndo' }),
      b.dispatcher.dispatch({ kind: 'glspUndo' }),
      b.dispatcher.dispatch({ kind: 'glspRedo' }),
    ]);
    // Each port's last answer comes after every notification sent before it: a barrier.
    await Promise.all([barrier(a), barrier(b)]);

    const final = text(store.getModel());
    expect(text(a.getModel())).toBe(final);
    expect(text(b.getModel())).toBe(final);
    for (const seen of [seenA, seenB]) {
      // Pushed: every state the server went through, in its order. Re-requested: some states
      // may be skipped or repeated, but never out of order.
      expect(sendModel ? seen : inOrder(seen, serverStates)).toEqual(
        sendModel ? serverStates : true,
      );
    }
  });

  test('a rejected action leaves the mirror as it was, and sends no change', async () => {
    const { connect } = serve(parsePistar(SMART_HOME), sendModel);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const before = mirror.getModel();
    const events: ModelChangeEvent[] = [];
    mirror.subscribe((event) => events.push(event));
    const result = await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.NoSuchKind' as 'istar.Goal',
    });
    expect(result.ok).toBe(false);
    await mirror.synced();
    expect(mirror.getModel()).toBe(before);
    expect(events).toEqual([]);
  });

  test('a postGuard rejection reaches a remote client as typed diagnostics, and the mirror sees no change', async () => {
    const rejectRenamed: ActionPostGuard<string, string> = (operation, modelAfter) => {
      if (operation.kind !== 'istar.updateDiagram') return;
      if (modelAfter.diagram?.name === 'forbidden') {
        return [{ elementId: '', severity: 'error', message: 'that name is reserved' }];
      }
    };
    const { connect } = serve(parsePistar(SMART_HOME), sendModel, { postGuards: [rejectRenamed] });
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const before = mirror.getModel();
    const events: ModelChangeEvent[] = [];
    mirror.subscribe((event) => events.push(event));

    const result = await mirror.dispatcher.dispatch({
      kind: 'istar.updateDiagram',
      diagram: { name: 'forbidden' },
    });
    expect(result).toEqual({
      ok: false,
      diagnostics: [{ elementId: '', severity: 'error', message: 'that name is reserved' }],
    });
    await mirror.synced();
    expect(mirror.getModel()).toBe(before);
    expect(events).toEqual([]);
  });
});

describe('createMirrorStore', () => {
  test('refuses direct mutation, model untouched', async () => {
    const { connect } = serve(parsePistar(SMART_HOME), true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const before = mirror.getModel();
    const [element] = before.elements.values();
    const id = element!.id;
    const attempts: Array<() => unknown> = [
      () => mirror.addElement({ kind: 'istar.Goal', x: 0, y: 0 }),
      () => mirror.updateElement(id, { name: 'x' }),
      () => mirror.moveElement(id, 1, 1),
      () => mirror.nestElement(id, null),
      () => mirror.removeElement(id),
      () => mirror.removeElements([id]),
      () => mirror.setCollapsed(id, true),
      () => mirror.connect({ kind: 'istar.AndRefinementLink', source: id, target: id }),
      () => mirror.updateDiagram({ name: 'x' }),
      () => mirror.replace(before),
      () => mirror.load(before),
      () => mirror.transaction(() => 1),
      () => mirror.clearHistory(),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(ModelOperationError);
    expect(mirror.getModel()).toBe(before);
  });

  test('undo and redo are the remote stack', async () => {
    const { store, connect } = serve(parsePistar(SMART_HOME), true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const original = text(mirror.getModel());
    expect(mirror.canUndo()).toBe(false);
    expect(mirror.undo()).toBe(false);

    await mirror.dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    expect(mirror.canUndo()).toBe(true);
    const edited = text(mirror.getModel());

    const undone = nextChange(mirror);
    expect(mirror.undo()).toBe(true);
    expect((await undone).source).toBe('undo');
    expect(text(mirror.getModel())).toBe(original);
    expect(text(store.getModel())).toBe(original);
    expect(mirror.canUndo()).toBe(false);
    expect(mirror.canRedo()).toBe(true);

    const redone = nextChange(mirror);
    expect(mirror.redo()).toBe(true);
    expect((await redone).source).toBe('redo');
    expect(text(mirror.getModel())).toBe(edited);
  });

  test('change events carry the remote source and changes', async () => {
    const { connect } = serve(undefined, true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    const change = nextChange(mirror);
    await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Actor',
      args: { id: 'x' },
    });
    expect(await change).toMatchObject({
      source: 'edit',
      changes: [{ type: 'addElement', id: 'x' }],
    });
  });

  test('a failed first requestModel rejects ready', async () => {
    const errors: unknown[] = [];
    const broken: ActionDispatcher = {
      dispatch: () => Promise.reject(new Error('transport down')),
      subscribe: () => () => {},
    };
    const mirror = createMirrorStore(broken, { onError: (error) => errors.push(error) });
    await expect(mirror.ready).rejects.toThrow('transport down');
    await mirror.synced();
    expect(errors).toHaveLength(1);
  });

  test('stops following after dispose', async () => {
    const { connect } = serve(undefined, true);
    const remote = connect();
    const mirror = createMirrorStore(remote);
    await mirror.ready;
    mirror.dispose();
    await remote.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
    expect(mirror.getModel().elements.size).toBe(0);
  });

  test('with sendModel: canUndo/canRedo are exact, matching the remote store', async () => {
    const { store, connect } = serve(undefined, true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;

    expect(mirror.canUndo()).toBe(false);
    expect(store.canUndo()).toBe(false);
    expect(mirror.canRedo()).toBe(false);
    expect(store.canRedo()).toBe(false);

    // Create an element
    await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Actor',
      args: { id: 'test1' },
    });
    expect(mirror.canUndo()).toBe(store.canUndo());
    expect(mirror.canRedo()).toBe(store.canRedo());
    expect(mirror.canUndo()).toBe(true);

    // Undo
    await mirror.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(mirror.canUndo()).toBe(store.canUndo());
    expect(mirror.canRedo()).toBe(store.canRedo());
    expect(mirror.canUndo()).toBe(false);
    expect(mirror.canRedo()).toBe(true);

    // Redo
    await mirror.dispatcher.dispatch({ kind: 'glspRedo' });
    expect(mirror.canUndo()).toBe(store.canUndo());
    expect(mirror.canRedo()).toBe(store.canRedo());
    expect(mirror.canUndo()).toBe(true);
    expect(mirror.canRedo()).toBe(false);
  });

  test('without sendModel: canUndo/canRedo use the estimate', async () => {
    const { connect } = serve(undefined, false);
    const mirror = createMirrorStore(connect());
    await mirror.ready;

    expect(mirror.canUndo()).toBe(false);
    expect(mirror.canRedo()).toBe(false);

    // Create an element
    await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Actor',
      args: { id: 'test1' },
    });
    expect(mirror.canUndo()).toBe(true);
    expect(mirror.canRedo()).toBe(false);

    // Undo
    await mirror.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(mirror.canUndo()).toBe(false);
    expect(mirror.canRedo()).toBe(true);

    // Redo
    await mirror.dispatcher.dispatch({ kind: 'glspRedo' });
    expect(mirror.canUndo()).toBe(true);
    expect(mirror.canRedo()).toBe(false);
  });

  test('initial is shown until the remote answers, then replaced if it differs', async () => {
    const remoteModel = parsePistar(SMART_HOME);
    const { connect } = serve(remoteModel, true);
    const initial = parsePistar(SMART_HOME);
    const mirror = createMirrorStore(connect(), { initial });
    expect(mirror.getModel()).toBe(initial);
    await mirror.ready;
    expect(text(mirror.getModel())).toBe(text(remoteModel));
  });

  test('initial accepts a piStar file, parsed the same way as a pushed one', async () => {
    const { connect } = serve(parsePistar(SMART_HOME), true);
    const file = JSON.parse(SMART_HOME) as PistarFile;
    const mirror = createMirrorStore(connect(), { initial: file });
    expect(mirror.getModel().elements.size).toBeGreaterThan(0);
    await mirror.ready;
    expect(text(mirror.getModel())).toBe(text(parsePistar(SMART_HOME)));
  });

  test('initial equal to the remote is kept (no replace event)', async () => {
    const remoteModel = parsePistar(SMART_HOME);
    const { connect } = serve(remoteModel, true);
    const initial = parsePistar(SMART_HOME);
    const mirror = createMirrorStore(connect(), { initial });
    const events: ModelChangeEvent[] = [];
    mirror.subscribe((event) => events.push(event));
    await mirror.ready;
    expect(mirror.getModel()).toBe(initial);
    expect(events).toEqual([]);
  });

  test('metamodelFor resolves the root per file: an iStar mirror follows a KAOS replace', async () => {
    const { store, connect } = serve(parsePistar(SMART_HOME), true);
    const mirror = createMirrorStore(connect(), { metamodelFor });
    await mirror.ready;
    expect(metamodelOf(mirror.getModel())).toBe(ISTAR_2_0);

    const kaosFile: PistarFile = {
      actors: [],
      orphans: [{ id: 'g1', type: 'kaos.Goal', text: 'Goal', x: 0, y: 0 }],
      tool: 'dsm3-goals',
    };
    const changed = new Promise<void>((resolve) => {
      const off = mirror.subscribe(() => {
        off();
        resolve();
      });
    });
    store.replace(parsePistar(kaosFile, { metamodel: KAOS }));
    await changed;
    await mirror.synced();

    expect(metamodelOf(mirror.getModel())).toBe(KAOS);
    expect(mirror.getModel().elements.get('g1')?.kind).toBe('kaos.Goal');
  });

  test('metamodelFor default (unset) keeps the fixed metamodel, like before', async () => {
    const { connect } = serve(parsePistar(SMART_HOME), true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;
    expect(metamodelOf(mirror.getModel())).toBe(ISTAR_2_0);
  });

  test('canUndo is false when undoing past history', async () => {
    const { store, connect } = serve(undefined, true);
    const mirror = createMirrorStore(connect());
    await mirror.ready;

    // Fill the history
    await mirror.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Actor',
      args: { id: 'test1' },
    });
    expect(mirror.canUndo()).toBe(true);

    // Undo
    await mirror.dispatcher.dispatch({ kind: 'glspUndo' });
    expect(mirror.canUndo()).toBe(false);
    expect(store.canUndo()).toBe(false);
    expect(mirror.canUndo()).toBe(store.canUndo());
  });
});
