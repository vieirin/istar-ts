import type { ActionDispatcher, ActionResult, IstarAction, ResponseFor } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import { act, render, screen } from '@testing-library/react';
import { toPistar } from '@istar-ts/core';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IstarEditor } from '../src';
import { IstarCanvas, IstarProvider, useIstarEditor } from '../src';

// `NodeResizer` only fires its callbacks from a real pointer drag, not reproducible in jsdom.
// Capture the props the node hands it instead, and call them directly, like a drag that grew
// the node by (dw, dh) and moved it by (dx, dy).
let capturedResize:
  | {
      onResizeStart?: XyflowReact.NodeResizerProps['onResizeStart'];
      onResizeEnd?: XyflowReact.NodeResizerProps['onResizeEnd'];
    }
  | undefined;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XyflowReact>();
  return {
    ...actual,
    NodeResizer(props: XyflowReact.NodeResizerProps) {
      capturedResize = { onResizeStart: props.onResizeStart, onResizeEnd: props.onResizeEnd };
      return null;
    },
  };
});

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useLayoutEffect(() => {
    onEditor(editor);
  });
  return null;
}

function recordingDispatcher(dispatcher: ActionDispatcher, kinds: string[]): ActionDispatcher {
  return {
    dispatch(action) {
      kinds.push(action.kind);
      return dispatcher.dispatch(action);
    },
    subscribe: dispatcher.subscribe,
  };
}

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

function setup(dispatcherWrap: (d: ActionDispatcher) => ActionDispatcher) {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
  const goal = store.addElement({
    kind: 'istar.Goal',
    x: 50,
    y: 50,
    parent: actor.id,
    name: 'Goal',
  });
  const dispatcher = dispatcherWrap(createActionDispatcher(store));
  const editorRef: { current?: IstarEditor } = {};
  render(
    <div style={{ width: 800, height: 600 }}>
      <IstarProvider store={store} dispatcher={dispatcher}>
        <Grab onEditor={(e) => (editorRef.current = e)} />
        <IstarCanvas />
      </IstarProvider>
    </div>,
  );
  act(() => editorRef.current!.select({ type: 'element', id: goal.id }));
  return { store, goal, editorRef };
}

describe('node resize', () => {
  // toPistar stamps saveDate with the current second: pin the clock so a before/after pair of
  // calls can't straddle a second boundary.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('dispatches one compound tagged "canvas", and undo restores the prior size and position', async () => {
    const kinds: string[] = [];
    const { store, goal } = setup((d) => recordingDispatcher(d, kinds));
    const before = toPistar(store.getModel());

    capturedResize!.onResizeStart!({} as never, { x: goal.x, y: goal.y, width: 100, height: 60 });
    await act(async () => {
      capturedResize!.onResizeEnd!({} as never, {
        x: goal.x + 10,
        y: goal.y + 5,
        width: 150,
        height: 80,
      });
    });

    // The provider also asks the dispatcher for type hints and the palette on mount (#142); the
    // resize itself still dispatches exactly one `compound`.
    expect(kinds).toEqual(['requestTypeHints', 'requestContextActions', 'compound']);
    const current = store.getModel().elements.get(goal.id)!;
    expect(current.display?.width).toBe(150);
    expect(current.display?.height).toBe(80);
    expect(current.x).toBe(goal.x + 10);
    expect(current.y).toBe(goal.y + 5);

    store.undo();
    expect(toPistar(store.getModel())).toEqual(before);
  });

  test('a rejected compound leaves the model unchanged', async () => {
    const { store, goal } = setup((d) => rejectingDispatcher(d, 'compound'));
    const before = toPistar(store.getModel());

    capturedResize!.onResizeStart!({} as never, { x: goal.x, y: goal.y, width: 100, height: 60 });
    await act(async () => {
      capturedResize!.onResizeEnd!({} as never, {
        x: goal.x + 10,
        y: goal.y + 5,
        width: 150,
        height: 80,
      });
    });

    expect(toPistar(store.getModel())).toEqual(before);
    await screen.findByRole('alert');
  });
});
