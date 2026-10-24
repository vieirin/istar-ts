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
import { files, next, openOn, startServer } from './server';

const AGENT = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';

/** Lets every queued action of every session run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

function count(sent: ActionMessage[], from: number, clientId: string, kind: string): number {
  return sent.slice(from).filter((m) => m.clientId === clientId && m.action.kind === kind).length;
}

async function twoSessions() {
  const shared = createIstarSharedModel(ISTAR_GLSP, { model: fixture('pistar/welcome.txt').text });
  const { server, sent } = await startServer(files, createIstarServerModules({ shared }));
  const a = await openOn(server, sent, ISTAR_GLSP, undefined, { clientId: 'a' });
  const b = await openOn(server, sent, ISTAR_GLSP, 'ignored.txt', { clientId: 'b' });
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
    await settle();
    const from = sent.length;
    await a.send(goal());
    await settle();
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
    await settle();
    expect(a.state.model.elements.has(created.id)).toBe(false);
    expect(count(sent, undoFrom, 'a', 'updateModel')).toBe(1);
    expect(count(sent, undoFrom, 'b', 'updateModel')).toBe(1);
  });

  test('an edit by the host’s own client reaches both sessions once', async () => {
    const { shared, sent } = await twoSessions();
    await settle();
    const from = sent.length;
    const result = await shared.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: AGENT,
      location: { x: 700, y: 200 },
    });
    expect(result.ok).toBe(true);
    await settle();
    expect(count(sent, from, 'a', 'updateModel')).toBe(1);
    expect(count(sent, from, 'b', 'updateModel')).toBe(1);
  });

  test('a disposed session stops listening; the shared dispatcher keeps working', async () => {
    const { shared, server, sent, a } = await twoSessions();
    await server.disposeClientSession({ clientSessionId: 'b' });
    await settle();
    const from = sent.length;
    await a.send(goal());
    await settle();
    expect(count(sent, from, 'a', 'updateModel')).toBe(1);
    expect(sent.slice(from).filter((m) => m.clientId === 'b')).toEqual([]);
    // Still the host's: a direct edit is still heard by A.
    const direct = sent.length;
    await shared.dispatcher.dispatch({ kind: 'glspUndo' });
    await settle();
    expect(count(sent, direct, 'a', 'updateModel')).toBe(1);
  });

  test('a session’s own store and dispatcher stop with the session', async () => {
    const { server, sent } = await startServer();
    const s = await openOn(server, sent, ISTAR_GLSP, 'welcome.txt', { clientId: 'own' });
    const state = s.session.container.get<IstarModelState>(ModelState);
    expect(state.isShared).toBe(false);
    const heard: string[] = [];
    state.dispatcher.subscribe((action) => heard.push(action.kind));
    await server.disposeClientSession({ clientSessionId: 'own' });
    await settle();
    // The disposed dispatcher no longer hears the store, so a direct store edit sends nothing.
    const from = sent.length;
    state.store.moveElement(AGENT, 10, 10);
    await settle();
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
