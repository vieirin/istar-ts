import {
  connectDispatcher,
  createActionDispatcher,
  createMirrorStore,
  createRemoteDispatcher,
} from '@istar-ts/actions';
import type {
  ActionDispatcher,
  ActionResult,
  ChangeBoundsOperation,
  IstarAction,
  ResponseFor,
} from '@istar-ts/actions';
import type { IstarElement } from '@istar-ts/core';
import { ISTAR_2_0, createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import type { ReactFlowProps } from '@xyflow/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { IstarCanvas, IstarInspector } from '../src';

// A drag only ends (`onNodeDragStop`) after a real pointer drag React Flow measures, which
// jsdom can't do: capture the prop the canvas hands `<ReactFlow>` and call it, like a drop.
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

/** The model elsewhere (a worker, a server): a store and dispatcher behind a `MessageChannel`. */
function remoteModel() {
  const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
  const server = createActionDispatcher(store, { sendModel: true });
  const { port1, port2 } = new MessageChannel();
  connectDispatcher(port1, server);
  return { store, remote: createRemoteDispatcher(port2) };
}

const only = (elements: Iterable<IstarElement>, kind: string): IstarElement => {
  const found = [...elements].filter((e) => e.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!;
};

/** Reads a `.react-flow__node`'s absolute position off the `translate(Xpx, Ypx)` React Flow
 * draws it at, as `link-anchor.test.tsx` does for an anchor node. */
function nodePosition(node: HTMLElement): { x: number; y: number } {
  const [, x, y] = node.style.transform.match(/translate\((-?[\d.]+)px, *(-?[\d.]+)px\)/)!;
  return { x: Number(x), y: Number(y) };
}

/**
 * Wraps a real dispatcher, holding every `kind` action's `dispatch` unresolved — and so, for a
 * `changeBounds`, the store unmoved — until `release()` forwards it. Simulates a mirror store
 * whose model doesn't reflect an edit until the remote's echo arrives (#266), without the full
 * two-postMessage-hop machinery: close enough, since `createMirrorStore`'s own delay is exactly
 * that its `apply` (the model update) happens on a notification the dispatch's promise merely
 * awaits (see `mirror.ts`), not synchronously inside the dispatch call. `rejectNext` makes the
 * next `release()` settle with a rejection instead of forwarding, as a remote that refused the
 * edit would. `adjust` rewrites the action before forwarding it (default: unchanged), as a
 * remote applying its own guard — a snap to grid, a clamp — would.
 */
function delayingDispatcher(
  dispatcher: ActionDispatcher,
  kind: string,
  adjust: (action: IstarAction) => IstarAction = (action) => action,
): { dispatcher: ActionDispatcher; release(): void; rejectNext(): void } {
  let settle: (() => void) | undefined;
  let forceReject = false;
  return {
    dispatcher: {
      dispatch<A extends IstarAction>(action: A) {
        if (action.kind !== kind) return dispatcher.dispatch(action);
        return new Promise<ActionResult<ResponseFor<A>>>((resolve) => {
          settle = () => {
            if (forceReject) {
              forceReject = false;
              resolve({
                ok: false,
                diagnostics: [{ elementId: '', severity: 'error', message: `${kind} refused` }],
              });
            } else {
              resolve(
                dispatcher.dispatch(adjust(action) as A) as Promise<ActionResult<ResponseFor<A>>>,
              );
            }
          };
        });
      },
      subscribe: dispatcher.subscribe,
    },
    release: () => settle?.(),
    rejectNext: () => {
      forceReject = true;
    },
  };
}

describe('IstarCanvas over a mirror store', () => {
  test('creates, nests, moves, undoes and edits in the inspector, all on the remote model', async () => {
    const { store, remote } = remoteModel();
    const mirror = createMirrorStore(remote);
    await mirror.ready;
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={mirror} dispatcher={mirror.dispatcher} aside={<IstarInspector />} />
      </div>,
    );
    const remoteElements = () => store.getModel().elements.values();

    // Create: an actor on the pane.
    fireEvent.click(screen.getByRole('button', { name: 'Actor' }));
    fireEvent.click(container.querySelector('.react-flow__pane')!, { clientX: 100, clientY: 100 });
    await waitFor(() => expect(mirror.getModel().elements.size).toBe(1));
    const actor = only(remoteElements(), 'istar.Actor');
    const actorNode = () => container.querySelector(`.react-flow__node[data-id="${actor.id}"]`)!;
    await waitFor(() => expect(actorNode()).not.toBeNull());
    // The canvas selected the new actor and opened its name for editing, on the mirror's model.
    const inline = (await screen.findByLabelText('Element name')) as HTMLTextAreaElement;
    expect(inline.value).toBe('Actor');
    fireEvent.keyDown(inline, { key: 'Escape' });

    // Nest: a goal clicked into the actor.
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    fireEvent.click(actorNode(), { clientX: 140, clientY: 160 });
    await waitFor(() => expect(mirror.getModel().elements.size).toBe(2));
    const goal = only(remoteElements(), 'istar.Goal');
    expect(goal.parent).toBe(actor.id);
    expect(mirror.getModel().elements.get(goal.id)).toEqual(goal);
    // Nesting the goal re-anchored the actor on it (`operations.ts`'s `refreshActorBoxes`):
    // `actor`'s own `x` is now stale, so re-read it for the assertions below.
    const anchoredActor = only(remoteElements(), 'istar.Actor');
    expect(mirror.getModel().elements.get(actor.id)).toEqual(anchoredActor);

    // Move: the actor dropped 40 to the right, its goal with it.
    const flowNode = captured!.nodes!.find((n) => n.id === actor.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x + 40, y: flowNode.position.y } },
      ]);
    });
    await waitFor(() =>
      expect(mirror.getModel().elements.get(actor.id)?.x).toBe(anchoredActor.x + 40),
    );
    expect(store.getModel().elements.get(actor.id)?.x).toBe(anchoredActor.x + 40);
    expect(store.getModel().elements.get(goal.id)?.x).toBe(goal.x + 40);

    // Undo (the palette's button): the remote's stack, mirrored back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mirror.getModel().elements.get(actor.id)?.x).toBe(anchoredActor.x));
    expect(store.getModel().elements.get(goal.id)?.x).toBe(goal.x);

    // Inspector: rename the goal.
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${goal.id}"]`)!);
    const name = (await screen.findByLabelText('Name')) as HTMLTextAreaElement;
    expect(name.value).toBe(goal.name);
    fireEvent.change(name, { target: { value: 'Mirrored goal' } });
    fireEvent.blur(name);
    await waitFor(() => expect(store.getModel().elements.get(goal.id)?.name).toBe('Mirrored goal'));
    await waitFor(() => expect(screen.getAllByText('Mirrored goal').length).toBeGreaterThan(0));
    expect(mirror.getModel().elements.get(goal.id)?.name).toBe('Mirrored goal');

    mirror.dispose();
  });
});

describe('IstarCanvas, a dropped node, and a dispatch that resolves late (#266)', () => {
  test('holds the dropped position through an unrelated re-render, until the dispatch resolves', async () => {
    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const actor = store.addElement({
      id: 'actor',
      kind: 'istar.Actor',
      name: 'Actor',
      x: 100,
      y: 100,
    });
    const { dispatcher, release } = delayingDispatcher(
      createActionDispatcher(store),
      'changeBounds',
    );

    // A host re-rendering with a new `extensions` array every time (context.tsx's `registry`
    // memo rebuilds on it), as the one in the bug report does.
    function Host(): ReactElement {
      const [n, setN] = useState(0);
      return (
        <div style={{ width: 800, height: 600 }} data-rerenders={n}>
          <button type="button" onClick={() => setN((x) => x + 1)}>
            rerender
          </button>
          <IstarCanvas store={store} dispatcher={dispatcher} extensions={[]} />
        </div>
      );
    }
    const { container } = render(<Host />);
    const actorNode = () =>
      container.querySelector(`.react-flow__node[data-id="${actor.id}"]`) as HTMLElement;
    await waitFor(() => expect(actorNode()).not.toBeNull());

    const flowNode = captured!.nodes!.find((n) => n.id === actor.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x + 40, y: flowNode.position.y } },
      ]);
    });

    // The dropped position shows right away, even though the store hasn't moved yet (the
    // dispatch is still pending).
    expect(store.getModel().elements.get(actor.id)?.x).toBe(actor.x);
    expect(nodePosition(actorNode())).toEqual({ x: actor.x + 40, y: actor.y });

    // An unrelated re-render rebuilds the canvas's graph from the model, which still has the
    // pre-drag position: the dropped one must still show, not snap back.
    fireEvent.click(screen.getByRole('button', { name: 'rerender' }));
    expect(nodePosition(actorNode())).toEqual({ x: actor.x + 40, y: actor.y });

    release();
    await waitFor(() => expect(store.getModel().elements.get(actor.id)?.x).toBe(actor.x + 40));
    expect(nodePosition(actorNode())).toEqual({ x: actor.x + 40, y: actor.y });
  });

  test('reverts to the stored position when the dispatch is rejected', async () => {
    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const actor = store.addElement({
      id: 'actor',
      kind: 'istar.Actor',
      name: 'Actor',
      x: 100,
      y: 100,
    });
    const { dispatcher, release, rejectNext } = delayingDispatcher(
      createActionDispatcher(store),
      'changeBounds',
    );
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} dispatcher={dispatcher} />
      </div>,
    );
    const actorNode = () =>
      container.querySelector(`.react-flow__node[data-id="${actor.id}"]`) as HTMLElement;
    await waitFor(() => expect(actorNode()).not.toBeNull());

    const flowNode = captured!.nodes!.find((n) => n.id === actor.id)!;
    rejectNext();
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x + 40, y: flowNode.position.y } },
      ]);
    });
    expect(nodePosition(actorNode())).toEqual({ x: actor.x + 40, y: actor.y });

    release();
    await waitFor(() => expect(nodePosition(actorNode())).toEqual({ x: actor.x, y: actor.y }));
    expect(store.getModel().elements.get(actor.id)?.x).toBe(actor.x);
  });

  test('shows the store’s position, not the dropped one, once an accepted dispatch resolves', async () => {
    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const actor = store.addElement({
      id: 'actor',
      kind: 'istar.Actor',
      name: 'Actor',
      x: 100,
      y: 100,
    });
    // A remote that moves the element somewhere other than asked (snap to grid, a clamp, a
    // guard) before accepting the edit.
    const { dispatcher, release } = delayingDispatcher(
      createActionDispatcher(store),
      'changeBounds',
      (action) => ({
        ...action,
        newBounds: (action as ChangeBoundsOperation).newBounds.map((bounds) => ({
          ...bounds,
          newPosition: { x: 500, y: 500 },
        })),
      }),
    );
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} dispatcher={dispatcher} />
      </div>,
    );
    const actorNode = () =>
      container.querySelector(`.react-flow__node[data-id="${actor.id}"]`) as HTMLElement;
    await waitFor(() => expect(actorNode()).not.toBeNull());

    const flowNode = captured!.nodes!.find((n) => n.id === actor.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x + 40, y: flowNode.position.y } },
      ]);
    });
    // The dropped position holds while the dispatch is pending.
    expect(nodePosition(actorNode())).toEqual({ x: actor.x + 40, y: actor.y });

    release();
    await waitFor(() => expect(store.getModel().elements.get(actor.id)?.x).toBe(500));
    // Not the dropped position: the store's, once the (accepted) dispatch resolved it. The
    // store updates synchronously inside the dispatch call, ahead of the promise chain
    // `onNodeDragStop`'s `.then` clears `pendingMoves` through, so this needs its own `waitFor`.
    await waitFor(() => expect(nodePosition(actorNode())).toEqual({ x: 500, y: 500 }));
  });
});
