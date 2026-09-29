import type { ModelStore } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import type { IstarEditor } from '../src';
import { IstarCanvas, IstarProvider, useIstarEditor } from '../src';

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useEffect(() => {
    onEditor(editor);
  });
  return null;
}

function twoGoals(): { store: ModelStore; g1: string; g2: string; link: string } {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
  const g1 = store.addElement({ kind: 'istar.Goal', x: 20, y: 20, parent: actor.id }).id;
  const g2 = store.addElement({ kind: 'istar.Goal', x: 20, y: 120, parent: actor.id }).id;
  const connected = store.connect({ kind: 'istar.AndRefinementLink', source: g2, target: g1 });
  if (!connected.ok) throw new Error(connected.reason);
  return { store, g1, g2, link: connected.link.id };
}

/** Ids React Flow currently draws as selected. */
function highlighted(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.react-flow__node.selected')].map(
    (n) => (n as HTMLElement).dataset.id!,
  );
}

function highlightedEdges(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.react-flow__edge.selected')].map(
    (e) => e.getAttribute('data-id') ?? e.getAttribute('data-testid')!,
  );
}

function setup(store: ModelStore, initial?: (editor: IstarEditor) => void) {
  const editor: { current?: IstarEditor } = {};
  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <IstarProvider store={store}>
        <Grab onEditor={(e) => (editor.current = e)} />
        <IstarCanvas fitView={false} />
      </IstarProvider>
    </div>,
  );
  if (initial) act(() => initial(editor.current!));
  return { ...view, editor: () => editor.current! };
}

describe('the canvas highlights the editor selection', () => {
  test('clicking a different element updates editor.selection (and thus the inspector)', () => {
    const { store, g1, g2 } = twoGoals();
    const { container, editor } = setup(store);
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(editor().selection).toEqual({ type: 'element', id: g1 });
    expect(highlighted(container)).toEqual([g1]);

    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${g2}"]`)!);
    expect(editor().selection).toEqual({ type: 'element', id: g2 });
    expect(highlighted(container)).toEqual([g2]);
  });

  test('select() from outside the canvas moves the highlight, and null clears it', () => {
    const { store, g1, g2 } = twoGoals();
    const { container, editor } = setup(store);
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(highlighted(container)).toEqual([g1]);

    act(() => editor().select({ type: 'element', id: g2 }));
    expect(highlighted(container)).toEqual([g2]);
    expect(editor().selection).toEqual({ type: 'element', id: g2 });

    act(() => editor().select(null));
    expect(highlighted(container)).toEqual([]);
    expect(editor().selection).toBeNull();
  });

  test('selecting a link highlights its edge only', () => {
    const { store, g1, link } = twoGoals();
    const { container, editor } = setup(store);
    act(() => editor().select({ type: 'element', id: g1 }));
    act(() => editor().select({ type: 'link', id: link }));
    expect(highlighted(container)).toEqual([]);
    expect(highlightedEdges(container)).toHaveLength(1);
    expect(editor().selection).toEqual({ type: 'link', id: link });
  });

  test('a selection made before the canvas mounts is shown', () => {
    const { store, g2 } = twoGoals();
    const editor: { current?: IstarEditor } = {};
    function App({ canvas }: { canvas: boolean }) {
      return (
        <IstarProvider store={store}>
          <Grab onEditor={(e) => (editor.current = e)} />
          {canvas && <IstarCanvas fitView={false} />}
        </IstarProvider>
      );
    }
    const { container, rerender } = render(<App canvas={false} />);
    act(() => editor.current!.select({ type: 'element', id: g2 }));
    rerender(<App canvas />);
    expect(highlighted(container)).toEqual([g2]);
  });

  test('an element added from the palette is highlighted', () => {
    const { store } = twoGoals();
    const actor = [...store.getModel().elements.values()].find((e) => e.kind === 'istar.Actor')!;
    const { container, editor } = setup(store);
    act(() => editor().setTool({ type: 'element', kind: 'istar.Goal' }));
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${actor.id}"]`)!, {
      clientX: 300,
      clientY: 300,
    });
    const added = [...store.getModel().elements.values()].at(-1)!;
    expect(added.kind).toBe('istar.Goal');
    expect(editor().selection).toEqual({ type: 'element', id: added.id });
    expect(highlighted(container)).toEqual([added.id]);
  });

  test('multi-selecting nodes in the canvas keeps them all highlighted', () => {
    const { store, g1, g2 } = twoGoals();
    const { container, editor } = setup(store);
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    // React Flow's multi-selection key: Control (Meta on macOS; jsdom isn't macOS).
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${g2}"]`)!, {
      ctrlKey: true,
    });
    fireEvent.keyUp(document.body, { key: 'Control' });
    expect(highlighted(container).toSorted()).toEqual([g1, g2].toSorted());
    expect(editor().selection?.type).toBe('element');
  });
});

describe('multi-selection follows each click’s own modifier key', () => {
  // jsdom isn't macOS, so React Flow's multi-selection key is Control here.
  function clickNode(container: HTMLElement, id: string, modifiers: { ctrlKey?: boolean } = {}) {
    const node = container.querySelector(`.react-flow__node[data-id="${id}"]`)!;
    fireEvent.pointerDown(node, modifiers);
    fireEvent.click(node, modifiers);
  }

  test('a modifier whose keyup never arrived does not turn plain clicks into multi-selection', () => {
    const { store, g1, g2 } = twoGoals();
    const { container } = setup(store);
    // A system shortcut (e.g. ⌘⇧5 on macOS) swallows the keyup: React Flow thinks it's held.
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    clickNode(container, g1);
    clickNode(container, g2);
    expect(highlighted(container)).toEqual([g2]);
  });

  test('a modifier click multi-selects even if React Flow missed the keydown', () => {
    const { store, g1, g2 } = twoGoals();
    const { container } = setup(store);
    clickNode(container, g1);
    clickNode(container, g2, { ctrlKey: true });
    expect(highlighted(container).toSorted()).toEqual([g1, g2].toSorted());
  });
});
