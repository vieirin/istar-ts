import type { ModelStore } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import type { ReactFlowProps } from '@xyflow/react';
import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { IstarEditor } from '../src';
import { defaultRegistry, IstarCanvas, IstarProvider, modelToFlow, useIstarEditor } from '../src';

// A drag start fires on a real pointer drag React Flow measures, which jsdom can't do: capture
// the prop the canvas hands `<ReactFlow>` and call it directly, like `mirror.test.tsx` does for
// `onNodeDragStop`.
let captured: ReactFlowProps | undefined;
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XyflowReact>();
  return {
    ...actual,
    ReactFlow(props: ReactFlowProps) {
      captured = props;
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

function setup(
  store: ModelStore,
  initial?: (editor: IstarEditor) => void,
  canvasProps?: { selectActorOnBodyClick?: boolean },
) {
  const editor: { current?: IstarEditor } = {};
  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <IstarProvider store={store}>
        <Grab onEditor={(e) => (editor.current = e)} />
        <IstarCanvas fitView={false} {...canvasProps} />
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

describe('actors are selected only through their symbol', () => {
  function actorOf(store: ModelStore): string {
    return [...store.getModel().elements.values()].find((e) => e.kind === 'istar.Actor')!.id;
  }
  function press(target: Element, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}) {
    fireEvent.pointerDown(target, modifiers);
    fireEvent.click(target, modifiers);
  }
  const body = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-boundary`)!;
  const symbol = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-symbol`)!;

  test('clicking the boundary body neither selects the actor nor clears the selection', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    press(body(container, actor));
    expect(highlighted(container)).toEqual([g1]);
    expect(editor().selection).toEqual({ type: 'element', id: g1 });
  });

  test('clicking the symbol selects the actor; Ctrl-clicking it adds to the selection', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    press(symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });

    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    press(symbol(container, actor), { ctrlKey: true });
    expect(highlighted(container).toSorted()).toEqual([actor, g1].toSorted());
  });

  test('box selection skips actors, and only the symbol drags them', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    const node = container.querySelector(`.react-flow__node[data-id="${actor}"]`)!;
    expect(node.classList.contains('selectable')).toBe(false);
    expect(modelToFlow(store.getModel(), defaultRegistry).nodes[0]).toMatchObject({
      id: actor,
      selectable: false,
      dragHandle: '.istar-actor-symbol',
    });
  });

  test('Alt+click collapses only from the symbol', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    press(body(container, actor), { altKey: true });
    expect(store.getModel().elements.get(actor)?.display?.collapsed).not.toBe(true);
    press(symbol(container, actor), { altKey: true });
    expect(store.getModel().elements.get(actor)?.display?.collapsed).toBe(true);
  });
});

describe('an actor is selected on pointer down, before release', () => {
  function actorOf(store: ModelStore): string {
    return [...store.getModel().elements.values()].find((e) => e.kind === 'istar.Actor')!.id;
  }
  function press(target: Element, modifiers: { ctrlKey?: boolean } = {}) {
    fireEvent.pointerDown(target, modifiers);
    fireEvent.click(target, modifiers);
  }
  const body = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-boundary`)!;
  const symbol = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-symbol`)!;

  test('pressing the symbol selects the actor and deselects whatever was selected, before mouseup', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(highlighted(container)).toEqual([g1]);

    fireEvent.pointerDown(symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('flag off: pressing the body does not select the actor on pointer down either', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    fireEvent.pointerDown(body(container, actor));
    expect(highlighted(container)).toEqual([g1]);
  });

  test('flag on: pressing the body selects the actor and deselects whatever was selected, before mouseup', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(highlighted(container)).toEqual([g1]);

    fireEvent.pointerDown(body(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('a plain press+release on an already-selected actor leaves it selected', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    press(symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    press(symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
  });

  test('a Ctrl press+release on an already-selected actor toggles it off exactly once', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    press(symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    press(symbol(container, actor), { ctrlKey: true });
    fireEvent.keyUp(document.body, { key: 'Control' });
    expect(highlighted(container)).toEqual([]);
  });
});

describe('a drag beginning on the actor symbol selects it (jitter tolerance)', () => {
  function actorOf(store: ModelStore): string {
    return [...store.getModel().elements.values()].find((e) => e.kind === 'istar.Actor')!.id;
  }
  const body = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-boundary`)!;
  const symbol = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-symbol`)!;
  function dragStart(container: HTMLElement, nodeId: string, target: Element) {
    const node = captured!.nodes!.find((n) => n.id === nodeId)!;
    act(() => {
      captured!.onNodeDragStart!({ target } as unknown as MouseEvent, node, [node]);
    });
  }

  test('a drag starting on the symbol selects the actor', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    dragStart(container, actor, symbol(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('a drag starting on the body does not select the actor', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    dragStart(container, actor, body(container, actor));
    expect(highlighted(container)).toEqual([]);
    expect(editor().selection).toBeNull();
  });

  test('a non-actor node is unaffected', () => {
    const { store, g1 } = twoGoals();
    const { container, editor } = setup(store);
    dragStart(container, g1, container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(highlighted(container)).toEqual([]);
    expect(editor().selection).toBeNull();
  });
});

describe('selectActorOnBodyClick', () => {
  function actorOf(store: ModelStore): string {
    return [...store.getModel().elements.values()].find((e) => e.kind === 'istar.Actor')!.id;
  }
  function press(target: Element, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}) {
    fireEvent.pointerDown(target, modifiers);
    fireEvent.click(target, modifiers);
  }
  const body = (container: HTMLElement, id: string) =>
    container.querySelector(`.react-flow__node[data-id="${id}"] .istar-actor-boundary`)!;
  function dragStart(container: HTMLElement, nodeId: string, target: Element) {
    const node = captured!.nodes!.find((n) => n.id === nodeId)!;
    act(() => {
      captured!.onNodeDragStart!({ target } as unknown as MouseEvent, node, [node]);
    });
  }

  test('off: clicking the body still does not select the actor', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store);
    press(body(container, actor));
    expect(highlighted(container)).toEqual([]);
    expect(editor().selection).toBeNull();
  });

  test('on: clicking the body selects the actor', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(body(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('on: a drag starting on the body selects the actor', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    dragStart(container, actor, body(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('on: Alt+click on the body selects but does not collapse', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(body(container, actor), { altKey: true });
    expect(highlighted(container)).toEqual([actor]);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
    expect(store.getModel().elements.get(actor)?.display?.collapsed).not.toBe(true);
  });

  test('on: a modifier click on an already-selected actor toggles it off', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(body(container, actor));
    expect(highlighted(container)).toEqual([actor]);
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    press(body(container, actor), { ctrlKey: true });
    fireEvent.keyUp(document.body, { key: 'Control' });
    expect(highlighted(container)).toEqual([]);
    expect(editor().selection).toBeNull();
  });

  test('on: a click delivered to a child node is not treated as a body click on the actor', () => {
    const { store, g1 } = twoGoals();
    const { container, editor } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(editor().selection).toEqual({ type: 'element', id: g1 });
    expect(highlighted(container)).toEqual([g1]);
  });

  test('on: the actor has no dragHandle (body drags it) even with another element selected', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store, undefined, { selectActorOnBodyClick: true });
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(captured!.nodes!.find((n) => n.id === actor)).toMatchObject({ dragHandle: undefined });
  });

  test('off: with an element selected, the actor keeps the symbol as its dragHandle', () => {
    const { store, g1 } = twoGoals();
    const actor = actorOf(store);
    const { container } = setup(store);
    press(container.querySelector(`.react-flow__node[data-id="${g1}"]`)!);
    expect(captured!.nodes!.find((n) => n.id === actor)).toMatchObject({
      dragHandle: '.istar-actor-symbol',
    });
  });

  test('with nothing selected, the actor has no dragHandle whether the flag is on or off', () => {
    const { store } = twoGoals();
    const actor = actorOf(store);
    setup(store);
    expect(captured!.nodes!.find((n) => n.id === actor)).toMatchObject({ dragHandle: undefined });

    const { store: store2 } = twoGoals();
    const actor2 = actorOf(store2);
    setup(store2, undefined, { selectActorOnBodyClick: true });
    expect(captured!.nodes!.find((n) => n.id === actor2)).toMatchObject({ dragHandle: undefined });
  });
});

describe('nodeClickDistance', () => {
  test('defaults to 3', () => {
    setup(createModelStore());
    expect(captured!.nodeClickDistance).toBe(3);
  });

  test('passes through the given value', () => {
    const store = createModelStore();
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider store={store}>
          <IstarCanvas fitView={false} nodeClickDistance={10} />
        </IstarProvider>
      </div>,
    );
    expect(captured!.nodeClickDistance).toBe(10);
  });
});
