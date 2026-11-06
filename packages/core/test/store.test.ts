import { describe, expect, test, vi } from 'vitest';
import type { ModelChangeEvent } from '../src';
import {
  childrenOf,
  createModelStore,
  getSourceLayout,
  metamodelOf,
  parsePistar,
  toPistar,
  validateModel,
} from '../src';

function seqIds() {
  let n = 0;
  return () => `id${++n}`;
}

function setup() {
  const store = createModelStore(undefined, { createId: seqIds() });
  const actor = store.addElement({ kind: 'istar.Actor', x: 100, y: 100 });
  const goal = store.addElement({ kind: 'istar.Goal', x: 150, y: 150, parent: actor.id });
  const task = store.addElement({ kind: 'istar.Task', x: 150, y: 250, parent: actor.id });
  return { store, actor, goal, task };
}

// Upstream qunit module "Elements".
describe('Elements', () => {
  test('is empty', () => {
    const store = createModelStore();
    expect(store.getModel().elements.size).toBe(0);
    store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    expect(store.getModel().elements.size).toBe(1);
  });

  test.each(['istar.Actor', 'istar.Role', 'istar.Agent'] as const)('add %s', (kind) => {
    const store = createModelStore();
    const el = store.addElement({ kind, x: 0, y: 0 });
    expect([...store.getModel().elements.values()][0]).toEqual(el);
    expect(el.kind).toBe(kind);
    expect(el.name).toBe(kind.slice(6));
  });

  test.each(['istar.Goal', 'istar.Quality', 'istar.Task', 'istar.Resource'] as const)(
    'add %s inside an actor',
    (kind) => {
      const { store, actor } = setup();
      const el = store.addElement({ kind, x: 0, y: 0, parent: actor.id });
      expect(el).toMatchObject({ kind, parent: actor.id });
    },
  );

  test('rejects nesting actors and unknown parents', () => {
    const { store, actor, goal } = setup();
    expect(() => store.addElement({ kind: 'istar.Role', x: 0, y: 0, parent: actor.id })).toThrow(
      /cannot be nested/,
    );
    expect(() => store.addElement({ kind: 'istar.Goal', x: 0, y: 0, parent: goal.id })).toThrow(
      /not an actor/,
    );
    expect(() => store.addElement({ kind: 'istar.Goal', x: 0, y: 0, id: goal.id })).toThrow(
      /already in use/,
    );
  });
});

describe('editing', () => {
  test('moving an actor moves its children', () => {
    const { store, actor, goal, task } = setup();
    // Both children (150, 150) and (150, 250) already fit inside the default-size Actor box at
    // the actor's own position (100, 100), so `setup()`'s `addElement` calls left it untouched.
    expect(store.getModel().elements.get(actor.id)).toMatchObject({ x: 100, y: 100 });

    store.moveElement(actor.id, 110, 90);
    const m = store.getModel();
    const dx = 10;
    const dy = -10;
    expect(m.elements.get(actor.id)).toMatchObject({ x: 110, y: 90 });
    expect(m.elements.get(goal.id)).toMatchObject({ x: 150 + dx, y: 150 + dy });
    expect(m.elements.get(task.id)).toMatchObject({ x: 150 + dx, y: 250 + dy });

    // Moving a child alone (not the actor) past the actor's own corner anchors the actor there
    // and grows the box to enclose the moved child.
    store.moveElement(goal.id, 0, 0);
    expect(store.getModel().elements.get(actor.id)).toMatchObject({ x: 0, y: 0 });
    expect(store.getModel().elements.get(actor.id)?.display).toMatchObject({
      anchor: { x: 110, y: 90 },
    });
  });

  test('update name, custom properties and display', () => {
    const { store, goal } = setup();
    store.updateElement(goal.id, {
      name: 'G1',
      customProperties: { maintain: 'true' },
      display: { backgroundColor: '#fff' },
    });
    store.updateElement(goal.id, { display: { width: 120 } });
    expect(store.getModel().elements.get(goal.id)).toMatchObject({
      name: 'G1',
      customProperties: { maintain: 'true' },
      display: { backgroundColor: '#fff', width: 120 },
    });
    store.updateElement(goal.id, { display: { backgroundColor: undefined, width: undefined } });
    expect(store.getModel().elements.get(goal.id)?.display).toBeUndefined();
    store.updateElement(goal.id, { customProperties: null });
    expect(store.getModel().elements.get(goal.id)?.customProperties).toBeUndefined();
  });

  test('nest into another actor appends to its children', () => {
    const { store, goal } = setup();
    const other = store.addElement({ kind: 'istar.Agent', x: 500, y: 100 });
    const q = store.addElement({ kind: 'istar.Quality', x: 510, y: 110, parent: other.id });
    store.nestElement(goal.id, other.id);
    expect(childrenOf(store.getModel(), other.id).map((e) => e.id)).toEqual([q.id, goal.id]);
    store.nestElement(goal.id, null);
    expect(store.getModel().elements.get(goal.id)?.parent).toBeUndefined();
  });

  test('collapse is stored in display', () => {
    const { store, actor } = setup();
    store.setCollapsed(actor.id, true);
    expect(store.getModel().elements.get(actor.id)?.display).toEqual({ collapsed: true });
    store.setCollapsed(actor.id, false);
    expect(store.getModel().elements.get(actor.id)?.display).toBeUndefined();
  });
});

describe('links', () => {
  test('connect enforces constraints and reports the reason', () => {
    const { store, goal, task } = setup();
    const ok = store.connect({ kind: 'istar.AndRefinementLink', source: task.id, target: goal.id });
    expect(ok.ok).toBe(true);
    const bad = store.connect({ kind: 'istar.OrRefinementLink', source: goal.id, target: task.id });
    expect(bad).toMatchObject({ ok: false, code: 'duplicate-link' });
    expect(store.getModel().links.size).toBe(1);
  });

  test('Needed-By and Qualification are retried reversed, like piStar', () => {
    const { store, actor, task } = setup();
    const res = store.addElement({ kind: 'istar.Resource', x: 0, y: 0, parent: actor.id });
    const result = store.connect({ kind: 'istar.NeededByLink', source: task.id, target: res.id });
    expect(result).toMatchObject({ ok: true, reversed: true, link: { source: res.id } });
    const noRetry = store.connect(
      { kind: 'istar.QualificationLink', source: task.id, target: res.id },
      { tryReversed: false },
    );
    expect(noRetry.ok).toBe(false);
  });

  test('contribution label can be set and changed', () => {
    const { store, actor, goal } = setup();
    const q = store.addElement({ kind: 'istar.Quality', x: 0, y: 0, parent: actor.id });
    const r = store.connect({
      kind: 'istar.ContributionLink',
      source: goal.id,
      target: q.id,
      label: 'help',
    });
    if (!r.ok) throw new Error(r.reason);
    store.updateLink(r.link.id, { label: 'break' });
    expect(store.getModel().links.get(r.link.id)?.label).toBe('break');
  });

  test('dependencies: add, then removing any part removes the whole', () => {
    const { store, actor, goal } = setup();
    const other = store.addElement({ kind: 'istar.Role', x: 500, y: 300 });
    const dep = store.addDependency({
      depender: goal.id,
      dependee: other.id,
      dependum: { kind: 'istar.Resource', name: 'Data' },
    });
    if (!dep.ok) throw new Error(dep.reason);
    expect(dep.dependum).toMatchObject({ isDependum: true, x: 325, y: 225 });
    expect(JSON.parse(toPistar(store.getModel())).dependencies[0]).toMatchObject({
      source: goal.id,
      target: other.id,
    });
    expect(validateModel(store.getModel())).toEqual([]);

    store.disconnect(dep.links[1].id);
    expect(store.getModel().elements.has(dep.dependum.id)).toBe(false);
    expect(store.getModel().links.size).toBe(0);
    store.undo();
    store.removeElement(dep.dependum.id);
    expect(store.getModel().links.size).toBe(0);
    store.undo();
    store.removeElement(actor.id);
    const m = store.getModel();
    expect([...m.elements.keys()]).toEqual([other.id]);
    expect(m.links.size).toBe(0);
  });

  test('invalid dependency is rejected', () => {
    const { store, goal, task } = setup();
    const r = store.addDependency({
      depender: goal.id,
      dependee: task.id,
      dependum: { kind: 'istar.Goal' },
    });
    expect(r).toMatchObject({ ok: false, code: 'same-actor' });
  });
});

describe('undo/redo and events', () => {
  test('undo and redo walk snapshots', () => {
    const { store, goal } = setup();
    const before = store.getModel();
    store.updateElement(goal.id, { name: 'renamed' });
    const after = store.getModel();
    expect(store.undo()).toBe(true);
    expect(store.getModel()).toBe(before);
    expect(store.canRedo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getModel()).toBe(after);
    store.undo();
    store.moveElement(goal.id, 1, 1);
    expect(store.canRedo()).toBe(false);
  });

  test('change events describe the edit', () => {
    const { store, goal } = setup();
    const events: ModelChangeEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    store.moveElement(goal.id, 5, 6);
    store.undo();
    store.redo();
    off();
    store.moveElement(goal.id, 7, 8);
    expect(events.map((e) => e.source)).toEqual(['edit', 'undo', 'redo']);
    expect(events[0]!.changes).toEqual([{ type: 'moveElement', id: goal.id, x: 5, y: 6 }]);
    expect(events[0]!.previous.elements.get(goal.id)?.x).toBe(150);
  });

  test('no-op edits emit nothing and add no history', () => {
    const { store, goal } = setup();
    store.clearHistory();
    const listener = vi.fn<(event: ModelChangeEvent) => void>();
    store.subscribe(listener);
    store.moveElement(goal.id, 150, 150);
    expect(listener).not.toHaveBeenCalled();
    expect(store.canUndo()).toBe(false);
  });

  test('transactions are one undo step and one event, and roll back on error', () => {
    const { store, goal, task } = setup();
    const listener = vi.fn<(event: ModelChangeEvent) => void>();
    store.subscribe(listener);
    const before = store.getModel();
    store.transaction(() => {
      store.moveElement(goal.id, 1, 1);
      store.transaction(() => store.moveElement(task.id, 2, 2));
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].changes).toHaveLength(2);
    store.undo();
    expect(store.getModel()).toBe(before);

    expect(() =>
      store.transaction(() => {
        store.moveElement(goal.id, 9, 9);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.getModel()).toBe(before);
  });

  test('load resets history; history is bounded', () => {
    const store = createModelStore(undefined, { historyLimit: 3, createId: seqIds() });
    const a = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    for (let i = 1; i <= 5; i++) store.moveElement(a.id, i, i);
    let undos = 0;
    while (store.undo()) undos++;
    expect(undos).toBe(3);
    store.load(parsePistar('{"actors":[],"orphans":[],"dependencies":[],"links":[],"display":{}}'));
    expect(store.canUndo()).toBe(false);
  });

  test('edits keep the parsed file layout so saves stay stable', () => {
    const text = JSON.stringify(
      {
        actors: [{ id: 'a', text: 'A', type: 'istar.Actor', x: 1, y: 1, nodes: [] }],
        orphans: [],
        dependencies: [],
        links: [],
        display: {},
        tool: 'x',
        custom: 1,
        saveDate: 'd',
      },
      null,
      2,
    );
    const store = createModelStore(parsePistar(text));
    store.updateElement('a', { name: 'B' });
    expect(getSourceLayout(store.getModel())).toBeDefined();
    expect(toPistar(store.getModel())).toBe(text.replace('"text": "A"', '"text": "B"'));
  });

  test('store.canLink uses the current model', () => {
    const { store, goal, task } = setup();
    expect(store.canLink(task.id, goal.id, 'istar.AndRefinementLink')).toEqual({ ok: true });
    store.connect({ kind: 'istar.AndRefinementLink', source: task.id, target: goal.id });
    expect(store.canLink(task, goal, 'istar.AndRefinementLink').ok).toBe(false);
  });
});

// An actor with at least one non-actor child is kept enclosing it by every operation that
// changes what the actor contains (`operations.ts`'s `refreshActorBoxes`): `actor.x`/`y` becomes
// the union of the kind-default-size box at the actor's anchor (`display.anchor` when present,
// else the actor's own position) and its children, and a stored `display` size (when present)
// becomes that box's size, floored on the kind's default. `display.anchor` is written only while
// a child reaches left of/above the anchor, and removed once nothing does — so an actor whose
// children always fit inside its own default box never moves or gets an anchor key at all. An
// actor with no children keeps its existing `x`/`y`, anchor and size. See
// `serialization.test.ts`'s "ratchet regression" describe for why this can't grow forever across
// a save/parse round trip.
describe('refreshing an actor’s box', () => {
  // `updateElement` on the actor itself (not a child) never refreshes it, so this is the way to
  // give it a stored size that isn't immediately replaced by the content box: `addElement` with
  // `parent: actor.id` would refresh the actor right away, discarding a size given at creation.
  // The goal (150, 150) already fits inside the default-size Actor box at (100, 100), so
  // `addElement`'s own refresh (triggered by the goal's `parent`) leaves the actor at its own
  // position before the size is set.
  function setupWithSize() {
    const store = createModelStore(undefined, { createId: seqIds() });
    const actor = store.addElement({ kind: 'istar.Actor', x: 100, y: 100 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 150, y: 150, parent: actor.id });
    store.updateElement(actor.id, { display: { width: 300, height: 200 } });
    return { store, actor, goal };
  }

  test('a child inside the default box leaves x/y unchanged, with no anchor', () => {
    const { store, actor, goal } = setup();
    void goal;
    expect(store.getModel().elements.get(actor.id)).toMatchObject({ x: 100, y: 100 });
    expect(store.getModel().elements.get(actor.id)?.display?.anchor).toBeUndefined();
  });

  test('moving a child left of the actor shifts x, sets the anchor, and grows the stored size', () => {
    const { store, actor, goal } = setupWithSize();

    store.moveElement(goal.id, actor.x - 150, actor.y);
    const moved = store.getModel().elements.get(actor.id)!;
    expect(moved).toMatchObject({ x: actor.x - 150, y: actor.y });
    expect(moved.display?.anchor).toEqual({ x: actor.x, y: actor.y });
    expect(moved.display!.width!).toBeGreaterThan(300);

    // Moving the child back drops the anchor key and restores the actor's own corner; the
    // stored size floors back to the content box there (the kind default, for this one small
    // child).
    store.moveElement(goal.id, goal.x, goal.y);
    const back = store.getModel().elements.get(actor.id)!;
    expect(back).toMatchObject({ x: actor.x, y: actor.y });
    expect(back.display?.anchor).toBeUndefined();
    const defaultSize = metamodelOf(store.getModel()).elements.get('istar.Actor')!.size;
    expect(back.display).toEqual(defaultSize);
  });

  test('dragging the actor shifts it, any anchor, and its children by the same delta, nothing else', () => {
    const { store, actor, goal } = setupWithSize();
    store.moveElement(goal.id, actor.x - 150, actor.y);
    const before = store.getModel().elements.get(actor.id)!;
    const anchor = before.display!.anchor!;

    store.moveElement(actor.id, 500, 500);
    const dx = 500 - before.x;
    const dy = 500 - before.y;
    const m = store.getModel();
    expect(m.elements.get(actor.id)).toMatchObject({ x: 500, y: 500 });
    expect(m.elements.get(actor.id)?.display).toMatchObject({
      anchor: { x: anchor.x + dx, y: anchor.y + dy },
      width: before.display!.width,
      height: before.display!.height,
    });
    // The goal sits at the box's own corner (it's the sole child, and pulled the box left of the
    // actor's own position), so it shifts by the same delta as the actor.
    expect(m.elements.get(goal.id)).toMatchObject({
      x: before.x + dx,
      y: before.y + dy,
    });
  });

  test('resizing a child grows the stored size to fit it exactly', () => {
    const { store, actor, goal } = setupWithSize();
    store.updateElement(goal.id, { display: { width: 3000, height: 3000 } });
    // The box is the union of the default-size floor at (100, 100) and the resized child
    // (150, 150)-(3150, 3150), so it reaches to (3150, 3150) from the actor's own corner.
    expect(store.getModel().elements.get(actor.id)!.display).toEqual({
      width: 3050,
      height: 3050,
    });
  });

  test('resizing the actor itself through updateElement is not immediately overridden', () => {
    const { store, actor } = setupWithSize();
    store.updateElement(actor.id, { display: { width: 900, height: 900 } });
    expect(store.getModel().elements.get(actor.id)?.display).toEqual({ width: 900, height: 900 });
  });

  test('nesting a child out leaves the now-childless actor as-is, and grows the new one', () => {
    const { store, actor, goal } = setupWithSize();
    const other = store.addElement({
      kind: 'istar.Agent',
      x: 2000,
      y: 2000,
      display: { width: 50, height: 50 },
    });
    store.nestElement(goal.id, other.id);

    // No children left to enclose: `x`/`y` and the stored size are untouched, not reset to a
    // default.
    const oldActor = store.getModel().elements.get(actor.id)!;
    expect(oldActor).toMatchObject({ x: 100, y: 100 });
    expect(oldActor.display).toEqual({ width: 300, height: 200 });

    const newActor = store.getModel().elements.get(other.id)!;
    expect(newActor.display!.width!).toBeGreaterThan(50);
  });

  test('adding a child outside the stored size grows it without moving the actor off its own corner', () => {
    const { store, actor } = setupWithSize();
    store.addElement({ kind: 'istar.Goal', x: 3000, y: 3000, parent: actor.id });
    const refreshed = store.getModel().elements.get(actor.id)!;
    // The new child reaches right of/below the actor's own corner, not left of/above it, so the
    // box grows without ever needing an anchor.
    expect(refreshed).toMatchObject({ x: 100, y: 100 });
    expect(refreshed.display?.anchor).toBeUndefined();
    expect(refreshed.display!.width!).toBeGreaterThan(300);
  });

  test('removing the child that needed the grown size shrinks it back', () => {
    const { store, actor, goal } = setupWithSize();
    store.moveElement(goal.id, 3150, 150);
    const other = store.addElement({ kind: 'istar.Task', x: 150, y: 150, parent: actor.id });
    expect(store.getModel().elements.get(actor.id)!.display!.width!).toBeGreaterThan(300);

    store.removeElement(goal.id);
    const defaultSize = metamodelOf(store.getModel()).elements.get('istar.Actor')!.size;
    expect(store.getModel().elements.get(actor.id)!.display).toEqual(defaultSize);
    expect(store.getModel().elements.has(other.id)).toBe(true);
  });

  test('no stored size: an actor is left with none after a child moves', () => {
    const { store, actor, goal } = setup();
    store.moveElement(goal.id, 3150, 150);
    expect(store.getModel().elements.get(actor.id)?.display).toBeUndefined();
  });

  test('undo restores the previous x/y, anchor and stored size', () => {
    const { store, actor, goal } = setupWithSize();
    const before = store.getModel().elements.get(actor.id)!;

    store.moveElement(goal.id, actor.x - 150, actor.y);
    const moved = store.getModel().elements.get(actor.id)!;
    expect(moved).toMatchObject({ x: actor.x - 150, y: actor.y });
    expect(moved.display?.anchor).toEqual({ x: actor.x, y: actor.y });
    expect(moved.display).not.toEqual(before.display);

    store.undo();
    expect(store.getModel().elements.get(actor.id)).toMatchObject({ x: before.x, y: before.y });
    expect(store.getModel().elements.get(actor.id)?.display).toEqual(before.display);

    store.redo();
    expect(store.getModel().elements.get(actor.id)).toMatchObject({ x: moved.x, y: moved.y });
    expect(store.getModel().elements.get(actor.id)?.display).toEqual(moved.display);
  });
});
