import type { ActionDispatcher, ActionResult, IstarAction, ResponseFor } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import type { Connection, ReactFlowProps } from '@xyflow/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { IstarEditor } from '../src';
import { IstarCanvas, IstarInspector, IstarProvider, useIstarEditor } from '../src';

// `onConnect` fires only at the end of a real pointer drag between handles, which React Flow
// resolves by the nodes' measured geometry — not reproducible in jsdom. Capture the prop the
// canvas hands `<ReactFlow>` instead, and call it directly, like a drag that ended on `dependee`.
let capturedOnConnect: ((connection: Connection) => void) | undefined;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XyflowReact>();
  return {
    ...actual,
    ReactFlow(props: ReactFlowProps) {
      capturedOnConnect = props.onConnect;
      return <actual.ReactFlow {...props} />;
    },
  };
});

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useEffect(() => {
    onEditor(editor);
  });
  return null;
}

/** Wraps a real dispatcher, recording the `kind` of every action sent to it. */
function recordingDispatcher(dispatcher: ActionDispatcher, kinds: string[]): ActionDispatcher {
  return {
    dispatch(action) {
      kinds.push(action.kind);
      return dispatcher.dispatch(action);
    },
    subscribe: dispatcher.subscribe,
  };
}

/** Rejects every action of `kind`, delegating everything else to a real dispatcher. */
function rejectingDispatcher(dispatcher: ActionDispatcher, kind: string): ActionDispatcher {
  return {
    dispatch<A extends IstarAction>(action: A) {
      if (action.kind === kind) {
        return Promise.resolve({
          ok: false,
          diagnostics: [{ elementId: '', severity: 'error', message: `${kind} refused` }],
        }) as Promise<ActionResult<ResponseFor<A>>>;
      }
      return dispatcher.dispatch(action);
    },
    subscribe: dispatcher.subscribe,
  };
}

describe('a custom dispatcher prop', () => {
  test('receives the canvas and inspector actions', () => {
    const store = createModelStore();
    const kinds: string[] = [];
    const dispatcher = recordingDispatcher(createActionDispatcher(store), kinds);
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} dispatcher={dispatcher} aside={<IstarInspector />} />
      </div>,
    );

    // The canvas: adding an actor from the palette dispatches `createNode`.
    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 100, clientY: 100 });
    expect(kinds).toContain('createNode');
    const actor = [...store.getModel().elements.values()][0]!;

    // The inspector: committing a new name dispatches `applyLabelEdit`.
    const name = screen.getByLabelText('Name') as HTMLTextAreaElement;
    fireEvent.change(name, { target: { value: 'Renamed' } });
    fireEvent.blur(name);
    expect(kinds).toContain('applyLabelEdit');
    expect(store.getModel().elements.get(actor.id)?.name).toBe('Renamed');
  });

  test('a rejection reaches notify', async () => {
    const store = createModelStore();
    const dispatcher = rejectingDispatcher(createActionDispatcher(store), 'createNode');
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} dispatcher={dispatcher} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 100, clientY: 100 });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('createNode refused');
    // The rejected action never reached the store.
    expect(store.getModel().elements.size).toBe(0);
  });

  test('a rejected createNode leaves no selection or editing id', async () => {
    const store = createModelStore();
    const dispatcher = rejectingDispatcher(createActionDispatcher(store), 'createNode');
    const editorRef: { current?: IstarEditor } = {};
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store} dispatcher={dispatcher}>
          <Grab onEditor={(e) => (editorRef.current = e)} />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 100, clientY: 100 });

    await screen.findByRole('alert');
    expect(editorRef.current!.selection).toBeNull();
    expect(editorRef.current!.editingId).toBeNull();
    expect(store.getModel().elements.size).toBe(0);
  });

  test('a rejected dependency connect leaves no selection or editing id', async () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const depender = store.addElement({
      kind: 'istar.Goal',
      x: 10,
      y: 10,
      parent: actor.id,
      name: 'Depender',
    });
    const dependee = store.addElement({
      kind: 'istar.Goal',
      x: 300,
      y: 10,
      parent: actor.id,
      name: 'Dependee',
    });
    const dispatcher = rejectingDispatcher(createActionDispatcher(store), 'createEdge');
    const editorRef: { current?: IstarEditor } = {};
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store} dispatcher={dispatcher}>
          <Grab onEditor={(e) => (editorRef.current = e)} />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );
    act(() => editorRef.current!.setTool({ type: 'dependency', dependum: 'istar.Goal' }));

    act(() => capturedOnConnect!({ source: depender.id, target: dependee.id } as Connection));

    await screen.findByRole('alert');
    expect(editorRef.current!.selection).toBeNull();
    expect(editorRef.current!.editingId).toBeNull();
    // The rejected action never created the dependum.
    expect(store.getModel().elements.size).toBe(3);
  });

  // #63: the dispatcher resolves on an already-settled promise, so its rejection reaches
  // `.then()` as a microtask — before `act()` flushes the commit that would otherwise refresh
  // `editorRef` first. `capturedOnConnect` is called outside `act()` on purpose, so React's
  // commit (which needs a macrotask here, since this render uses a concurrent root) stays
  // pending across that microtask tick, reproducing the race from the issue deterministically.
  test('a rejected dependency connect rolls back against the latest state, not a stale snapshot', async () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const depender = store.addElement({
      kind: 'istar.Goal',
      x: 10,
      y: 10,
      parent: actor.id,
      name: 'Depender',
    });
    const dependee = store.addElement({
      kind: 'istar.Goal',
      x: 300,
      y: 10,
      parent: actor.id,
      name: 'Dependee',
    });
    const dispatcher = rejectingDispatcher(createActionDispatcher(store), 'createEdge');
    const editorRef: { current?: IstarEditor } = {};
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store} dispatcher={dispatcher}>
          <Grab onEditor={(e) => (editorRef.current = e)} />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );
    act(() => editorRef.current!.setTool({ type: 'dependency', dependum: 'istar.Goal' }));

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    capturedOnConnect!({ source: depender.id, target: dependee.id } as Connection);
    // Lets the already-settled rejection reach `.then()` before the pending `select`/
    // `setEditingId` updates from `onConnect` are committed.
    await Promise.resolve();
    errors.mockRestore();

    await screen.findByRole('alert');
    expect(editorRef.current!.selection).toBeNull();
    expect(editorRef.current!.editingId).toBeNull();
    // The rejected action never created the dependum.
    expect(store.getModel().elements.size).toBe(3);
  });

  test('elementActions.setDisplay and linkActions.setLabel/setName dispatch, not the store directly', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const quality = store.addElement({
      kind: 'istar.Quality',
      x: 10,
      y: 10,
      parent: actor.id,
    });
    const task = store.addElement({ kind: 'istar.Task', x: 100, y: 10, parent: actor.id });
    const link = store.connect({
      kind: 'istar.ContributionLink',
      source: task.id,
      target: quality.id,
      label: 'help',
      name: 'Original',
    });
    if (!link.ok) throw new Error('setup failed');

    const kinds: string[] = [];
    const dispatcher = recordingDispatcher(createActionDispatcher(store), kinds);
    const editorRef: { current?: IstarEditor } = {};
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store} dispatcher={dispatcher}>
          <Grab onEditor={(e) => (editorRef.current = e)} />
        </IstarProvider>
      </div>,
    );

    act(() =>
      editorRef.current!.elementActions(quality.id).setDisplay({ backgroundColor: '#fff' }),
    );
    expect(kinds).toContain('istar.updateDisplay');
    expect(store.getModel().elements.get(quality.id)?.display).toEqual({
      backgroundColor: '#fff',
    });

    act(() => editorRef.current!.linkActions(link.link.id).setLabel('hurt'));
    expect(kinds).toContain('istar.setLinkValue');
    expect(store.getModel().links.get(link.link.id)?.label).toBe('hurt');

    act(() => editorRef.current!.linkActions(link.link.id).setName(undefined));
    expect(kinds).toContain('applyLabelEdit');
    expect(store.getModel().links.get(link.link.id)?.name).toBeUndefined();
  });
});

describe('dispatcherFor', () => {
  test('routes canvas actions through "canvas" and inspector actions through "inspector"', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({
      kind: 'istar.Goal',
      x: 10,
      y: 10,
      parent: actor.id,
      name: 'Original',
    });
    const base = createActionDispatcher(store);
    const canvasKinds: string[] = [];
    const inspectorKinds: string[] = [];
    const canvasDispatcher = recordingDispatcher(base, canvasKinds);
    const inspectorDispatcher = recordingDispatcher(base, inspectorKinds);
    const dispatcherFor = (surface: 'canvas' | 'inspector'): ActionDispatcher =>
      surface === 'inspector' ? inspectorDispatcher : canvasDispatcher;
    const editorRef: { current?: IstarEditor } = {};

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store} dispatcherFor={dispatcherFor}>
          <Grab onEditor={(e) => (editorRef.current = e)} />
          <IstarCanvas aside={<IstarInspector />} />
        </IstarProvider>
      </div>,
    );

    // The canvas: adding an actor from the palette dispatches `createNode` through 'canvas'.
    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 400, clientY: 400 });
    expect(canvasKinds).toContain('createNode');
    expect(inspectorKinds).not.toContain('createNode');

    // The inspector: committing a new name on the selected goal dispatches `applyLabelEdit`
    // through 'inspector' (`IstarInspector` passes `surface: 'inspector'` to `elementActions`).
    act(() => editorRef.current!.select({ type: 'element', id: goal.id }));
    const name = screen.getByLabelText('Name') as HTMLTextAreaElement;
    fireEvent.change(name, { target: { value: 'Renamed' } });
    fireEvent.blur(name);
    expect(inspectorKinds).toContain('applyLabelEdit');
    expect(canvasKinds).not.toContain('applyLabelEdit');
    expect(store.getModel().elements.get(goal.id)?.name).toBe('Renamed');
  });

  test('omitted, both surfaces use the base dispatcher', () => {
    const store = createModelStore();
    const kinds: string[] = [];
    const dispatcher = recordingDispatcher(createActionDispatcher(store), kinds);
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} dispatcher={dispatcher} aside={<IstarInspector />} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 100, clientY: 100 });
    expect(kinds).toContain('createNode');
  });
});
