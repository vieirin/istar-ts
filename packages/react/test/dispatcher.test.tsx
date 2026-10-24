import type { ActionDispatcher, ActionResult, IstarAction, ResponseFor } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { createModelStore } from '@istar-ts/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { IstarCanvas, IstarInspector } from '../src';

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
});
