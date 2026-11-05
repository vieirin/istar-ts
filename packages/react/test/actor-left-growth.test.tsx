import { createActionDispatcher } from '@istar-ts/actions';
import type {
  ActionDispatcher,
  ActionResult,
  IstarAction,
  ResponseFor,
} from '@istar-ts/actions';
import { ISTAR_2_0, actorBounds, createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import type { ReactFlowProps } from '@xyflow/react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { IstarCanvas } from '../src';

// A drag only ends (`onNodeDragStop`) after a real pointer drag React Flow measures, which
// jsdom can't do: capture the prop the canvas hands `<ReactFlow>` and call it, like a drop (see
// `mirror.test.tsx`).
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

/** Reads a `.react-flow__node`'s absolute position off the `translate(Xpx, Ypx)` React Flow
 * draws it at (see `mirror.test.tsx`). */
function nodePosition(node: HTMLElement): { x: number; y: number } {
  const [, x, y] = node.style.transform.match(/translate\((-?[\d.]+)px, *(-?[\d.]+)px\)/)!;
  return { x: Number(x), y: Number(y) };
}

function nodeSize(node: HTMLElement): { width: number; height: number } {
  return {
    width: Number.parseFloat(node.style.width),
    height: Number.parseFloat(node.style.height),
  };
}

/** Holds every `kind` dispatch unresolved until `release()` forwards the oldest one still
 * waiting, simulating a mirror store with latency whose echoes arrive in the order sent (see
 * `mirror.test.tsx`'s `delayingDispatcher`; this one queues more than one in flight, for a
 * second drag on the same node before the first's echo arrives). */
function delayingDispatcher(
  dispatcher: ActionDispatcher,
  kind: string,
): { dispatcher: ActionDispatcher; release(): void } {
  const queue: (() => void)[] = [];
  return {
    dispatcher: {
      dispatch<A extends IstarAction>(action: A) {
        if (action.kind !== kind) return dispatcher.dispatch(action);
        return new Promise<ActionResult<ResponseFor<A>>>((resolve) => {
          queue.push(() =>
            resolve(dispatcher.dispatch(action) as Promise<ActionResult<ResponseFor<A>>>),
          );
        });
      },
      subscribe: dispatcher.subscribe,
    },
    release: () => queue.shift()?.(),
  };
}

describe('IstarCanvas, dragging a child past an actor’s left edge, over a store with latency', () => {
  test('holds the origin-shifted actor box; the echo settles it without a second jump', async () => {
    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const actor = store.addElement({
      id: 'actor',
      kind: 'istar.Actor',
      name: 'Actor',
      x: 100,
      y: 100,
    });
    const goal1 = store.addElement({
      id: 'goal1',
      kind: 'istar.Goal',
      name: 'Goal 1',
      x: 150,
      y: 150,
      parent: actor.id,
    });
    store.addElement({
      id: 'goal2',
      kind: 'istar.Goal',
      name: 'Goal 2',
      x: 250,
      y: 150,
      parent: actor.id,
    });

    const { dispatcher, release } = delayingDispatcher(
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

    // Drag goal1 150px to the left: past the actor's left edge.
    const flowNode = captured!.nodes!.find((n) => n.id === goal1.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x - 150, y: flowNode.position.y } },
      ]);
    });

    // Held, optimistic box: goal1 moved before the store (and so the model) has.
    expect(store.getModel().elements.get(goal1.id)?.x).toBe(goal1.x);
    const expectedBox = actorBounds(
      { ...store.getModel(), elements: new Map(store.getModel().elements).set(goal1.id, { ...goal1, x: goal1.x - 150 }) },
      actor.id,
      ISTAR_2_0,
    );
    const heldPosition = nodePosition(actorNode());
    const heldSize = nodeSize(actorNode());
    expect(heldPosition).toEqual({ x: expectedBox.x, y: expectedBox.y });
    expect(heldSize).toEqual({ width: expectedBox.width, height: expectedBox.height });

    // The echo: the store (and so the model) now agrees. The held box must not jump again.
    release();
    await waitFor(() => expect(store.getModel().elements.get(goal1.id)?.x).toBe(goal1.x - 150));
    expect(nodePosition(actorNode())).toEqual(heldPosition);
    expect(nodeSize(actorNode())).toEqual(heldSize);
  });

  test('a second drag before the first echo arrives holds from the displayed position, not the stale store one', async () => {
    const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
    const actor = store.addElement({
      id: 'actor',
      kind: 'istar.Actor',
      name: 'Actor',
      x: 100,
      y: 100,
    });
    const goal1 = store.addElement({
      id: 'goal1',
      kind: 'istar.Goal',
      name: 'Goal 1',
      x: 150,
      y: 150,
      parent: actor.id,
    });
    store.addElement({
      id: 'goal2',
      kind: 'istar.Goal',
      name: 'Goal 2',
      x: 250,
      y: 150,
      parent: actor.id,
    });

    const { dispatcher, release } = delayingDispatcher(
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

    // First drag: goal1 150px left. Its echo won't arrive until the second `release()` below.
    const firstDrag = captured!.nodes!.find((n) => n.id === goal1.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, firstDrag, [
        { ...firstDrag, position: { x: firstDrag.position.x - 150, y: firstDrag.position.y } },
      ]);
    });

    // Second drag on the same node, 30px further right, before the first dispatch resolved:
    // its delta must apply to where goal1 is actually shown (the held position above), not to
    // the store's still pre-drag `x`.
    const secondDrag = captured!.nodes!.find((n) => n.id === goal1.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, secondDrag, [
        { ...secondDrag, position: { x: secondDrag.position.x + 30, y: secondDrag.position.y } },
      ]);
    });
    const heldAfterSecondDrag = nodePosition(actorNode());
    const expectedBox = actorBounds(
      {
        ...store.getModel(),
        elements: new Map(store.getModel().elements).set(goal1.id, {
          ...goal1,
          x: goal1.x - 150 + 30,
        }),
      },
      actor.id,
      ISTAR_2_0,
    );
    expect(heldAfterSecondDrag).toEqual({ x: expectedBox.x, y: expectedBox.y });

    // The first dispatch's echo arrives (the store now shows the first, superseded position):
    // the second hold must survive it, not be cleared early and fall back to the stale store.
    release();
    await waitFor(() => expect(store.getModel().elements.get(goal1.id)?.x).toBe(goal1.x - 150));
    expect(nodePosition(actorNode())).toEqual(heldAfterSecondDrag);

    // The second dispatch's echo arrives: now the hold settles for real.
    release();
    await waitFor(() => expect(store.getModel().elements.get(goal1.id)?.x).toBe(goal1.x - 150 + 30));
    expect(nodePosition(actorNode())).toEqual(heldAfterSecondDrag);
  });
});
