/**
 * Shared-store hosting: the host binds its own store and dispatcher (`IstarSharedModel`), so
 * several GLSP sessions, and the host's other clients, show and edit one model. Each change
 * reaches every session exactly once: as the editing session's own `updateModel`, and as
 * another client's change everywhere else.
 */
import { describe, expect, test } from 'vitest';
import type { ActionMessage } from '@eclipse-glsp/server';
import { CreateNodeOperation, ModelState, UndoAction } from '@eclipse-glsp/server';
import type { IstarModelState } from '../src';
import { ISTAR_GLSP, createIstarServerModules, createIstarSharedModel } from '../src';
import { fixture } from './fixtures';
import { files, next, openOn, startServer, validationSettled } from './server';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';

/**
 * A short, bounded wait for a negative assertion ("nothing more arrives"): there is no event to
 * wait for when proving absence. By the time this runs, the one known asynchronous source (GLSP's
 * live-validation debounce, see `validationSettled`) has already been waited out, so this is just
 * a safety margin against a duplicate send, not a race against that debounce (#111).
 */
async function quiet(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

function count(sent: ActionMessage[], from: number, clientId: string, kind: string): number {
  return sent.slice(from).filter((m) => m.clientId === clientId && m.action.kind === kind).length;
}

async function twoSessions() {
  const shared = createIstarSharedModel(ISTAR_GLSP, { model: fixture('pistar/welcome.txt').text });
  const { server, sent } = await startServer(files, createIstarServerModules({ shared }));
  const a = await openOn(server, sent, ISTAR_GLSP, undefined, { clientId: 'a' });
  const b = await openOn(server, sent, ISTAR_GLSP, 'ignored.txt', { clientId: 'b' });
  // Each session's initial `setModel` schedules GLSP's live-validation debounce (100ms); wait it
  // out here so later assertions about exact message counts don't race it (#111).
  await validationSettled(sent, 'a');
  await validationSettled(sent, 'b');
  return { shared, server, sent, a, b };
}

function goal() {
  return CreateNodeOperation.create('node:istar.Goal', {
    containerId: AGENT,
    location: { x: 640, y: 160 },
  });
}

describe('a shared store', () => {
  test('every session shows the host’s model; requestModel reads no file', async () => {
    const { shared, a, b } = await twoSessions();
    expect(a.state.store).toBe(shared.store);
    expect(b.state.store).toBe(shared.store);
    expect(a.state.dispatcher).toBe(shared.dispatcher);
    expect(a.state.isShared).toBe(true);
    expect(JSON.stringify(a.root)).toBe(JSON.stringify(b.root));
    expect(JSON.stringify(a.root)).toContain(AGENT);
  });

  test('an edit in A pushes exactly one updateModel to A and one to B', async () => {
    const { sent, a, b } = await twoSessions();
    const from = sent.length;
    await a.send(goal());
    // A's own `updateModel` is sent inline by its operation handler, before `a.send` resolves;
    // B's is pushed asynchronously by its own listener and dispatcher, so wait for it directly.
    await next(sent, 'updateModel', from, 'b');
    await quiet();
    expect(count(sent, from, 'a', 'updateModel')).toBe(1);
    expect(count(sent, from, 'b', 'updateModel')).toBe(1);
    const created = [...a.state.model.elements.values()].find(
      (e) => e.kind === 'istar.Goal' && e.x === 640 && e.y === 160,
    )!;
    const update = sent.slice(from).find((m) => m.clientId === 'b')!;
    expect(JSON.stringify(update.action)).toContain(created.id);

    // B's undo is the same undo stack: A and B each get one update again.
    const undoFrom = sent.length;
    await b.send(UndoAction.create());
    await next(sent, 'updateModel', undoFrom, 'a');
    await quiet();
    expect(a.state.model.elements.has(created.id)).toBe(false);
    expect(count(sent, undoFrom, 'a', 'updateModel')).toBe(1);
    expect(count(sent, undoFrom, 'b', 'updateModel')).toBe(1);
  });

  test('an edit by the host’s own client reaches both sessions once', async () => {
    const { shared, sent } = await twoSessions();
    const from = sent.length;
    const result = await shared.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: AGENT,
      location: { x: 700, y: 200 },
    });
    expect(result.ok).toBe(true);
    // Neither session made this change, so both hear it as another client's, asynchronously.
    await next(sent, 'updateModel', from, 'a');
    await next(sent, 'updateModel', from, 'b');
    await quiet();
    expect(count(sent, from, 'a', 'updateModel')).toBe(1);
    expect(count(sent, from, 'b', 'updateModel')).toBe(1);
  });

  test('a disposed session stops listening; the shared dispatcher keeps working', async () => {
    const { shared, server, sent, a } = await twoSessions();
    await server.disposeClientSession({ clientSessionId: 'b' });
    const from = sent.length;
    await a.send(goal());
    await quiet();
    expect(count(sent, from, 'a', 'updateModel')).toBe(1);
    expect(sent.slice(from).filter((m) => m.clientId === 'b')).toEqual([]);
    // Still the host's: a direct edit is still heard by A.
    const direct = sent.length;
    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    await next(sent, 'updateModel', direct, 'a');
    await quiet();
    expect(count(sent, direct, 'a', 'updateModel')).toBe(1);
  });

  test('a session’s own store and dispatcher stop with the session', async () => {
    const { server, sent } = await startServer();
    const s = await openOn(server, sent, ISTAR_GLSP, 'welcome.txt', { clientId: 'own' });
    // The session's initial `setModel` schedules GLSP's live-validation debounce; wait it out so
    // it can't land after `from` below and look like a leak from the disposed session (#111).
    await validationSettled(sent, 'own');
    const state = s.session.container.get<IstarModelState>(ModelState);
    expect(state.isShared).toBe(false);
    const heard: string[] = [];
    state.dispatcher.subscribe((action) => heard.push(action.kind));
    await server.disposeClientSession({ clientSessionId: 'own' });
    // The disposed dispatcher no longer hears the store, so a direct store edit sends nothing.
    const from = sent.length;
    state.store.moveElement(AGENT, 10, 10);
    await quiet();
    expect(heard).toEqual([]);
    expect(sent.slice(from)).toEqual([]);
  });

  test('the shared model saves through the host’s save', async () => {
    const saved: string[] = [];
    const shared = createIstarSharedModel(ISTAR_GLSP, {
      model: fixture('pistar/welcome.txt').text,
      save: (file) => {
        saved.push(JSON.stringify(file));
      },
    });
    const { server, sent } = await startServer(files, createIstarServerModules({ shared }));
    const a = await openOn(server, sent, ISTAR_GLSP, undefined, { clientId: 'a' });
    const from = sent.length;
    server.process({ clientId: 'a', action: { kind: 'saveModel' } });
    await next(sent, 'setDirtyState', from, 'a');
    expect(saved).toHaveLength(1);
    expect(a.state.dispatcher.isDirty()).toBe(false);
  });
});
