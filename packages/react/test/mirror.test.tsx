import {
  connectDispatcher,
  createActionDispatcher,
  createMirrorStore,
  createRemoteDispatcher,
} from '@istar-ts/actions';
import type { IstarElement } from '@istar-ts/core';
import { ISTAR_2_0, createModelStore } from '@istar-ts/core';
import type * as XyflowReact from '@xyflow/react';
import type { ReactFlowProps } from '@xyflow/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    // Move: the actor dropped 40 to the right, its goal with it.
    const flowNode = captured!.nodes!.find((n) => n.id === actor.id)!;
    act(() => {
      captured!.onNodeDragStop!(new MouseEvent('mouseup') as never, flowNode, [
        { ...flowNode, position: { x: flowNode.position.x + 40, y: flowNode.position.y } },
      ]);
    });
    await waitFor(() => expect(mirror.getModel().elements.get(actor.id)?.x).toBe(actor.x + 40));
    expect(store.getModel().elements.get(actor.id)?.x).toBe(actor.x + 40);
    expect(store.getModel().elements.get(goal.id)?.x).toBe(goal.x + 40);

    // Undo (the palette's button): the remote's stack, mirrored back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mirror.getModel().elements.get(actor.id)?.x).toBe(actor.x));
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
