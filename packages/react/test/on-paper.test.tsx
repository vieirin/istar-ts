import { ISTAR_2_0, createEmptyModel, createModelStore, extendMetamodel } from '@istar-ts/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { IstarCanvas } from '../src';

// A node kind that may lie on the paper, as DSM3-goals' KAOS and NFR nodes do, beside one that
// keeps the extension default (inside actors only, as piStar's iStar nodes).
const METAMODEL = extendMetamodel(ISTAR_2_0, {
  name: 'paper',
  elements: [
    {
      kind: 'paper.Note',
      label: 'Note',
      category: 'node',
      info: { canBeOnPaper: true },
    },
    { kind: 'paper.Inner', label: 'Inner', category: 'node' },
  ],
});

function setup() {
  const store = createModelStore(createEmptyModel(undefined, { metamodel: METAMODEL }));
  const utils = render(
    <div style={{ width: 800, height: 600 }}>
      <IstarCanvas store={store} />
    </div>,
  );
  const pane = utils.container.querySelector('.react-flow__pane')!;
  const elements = () => [...store.getModel().elements.values()];
  return { ...utils, store, pane, elements };
}

describe('canBeOnPaper', () => {
  test('a click on empty paper adds a node of a kind that can lie on the paper', () => {
    const { pane, elements } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.click(pane, { clientX: 200, clientY: 150 });
    expect(elements()).toHaveLength(1);
    expect(elements()[0]).toMatchObject({ kind: 'paper.Note', name: 'Note' });
    expect(elements()[0]!.parent).toBeUndefined();
  });

  test('a click on a node outside any actor adds the new node on the paper too', () => {
    const { store, container, elements } = setup();
    const first = store.addElement({ kind: 'paper.Note', x: 100, y: 100 } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    const node = container.querySelector(`.react-flow__node[data-id="${first.id}"]`)!;
    fireEvent.click(node, { clientX: 150, clientY: 120 });
    expect(elements()).toHaveLength(2);
    expect(elements().every((e) => e.parent === undefined)).toBe(true);
  });

  test('other node kinds still need an actor, as in piStar', () => {
    const { pane, elements } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Inner' }));
    fireEvent.click(pane, { clientX: 200, clientY: 150 });
    expect(elements()).toHaveLength(0);
    expect(
      screen.getAllByRole('status').some((s) => s.textContent?.includes('Click on an actor')),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    fireEvent.click(pane, { clientX: 200, clientY: 150 });
    expect(elements()).toHaveLength(0);
  });
});
