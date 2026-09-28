import type { ModelStore } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type { IstarCanvasHandle } from '../src';
import { IstarCanvas, IstarProvider } from '../src';

function actorWithGoal(): { store: ModelStore; goalId: string } {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 400, y: 300 });
  const goal = store.addElement({ kind: 'istar.Goal', x: 500, y: 380, parent: actor.id });
  return { store, goalId: goal.id };
}

function viewport(container: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = (container.querySelector('.react-flow__viewport') as HTMLElement).style
    .transform;
  const [x, y, zoom] = [...transform.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
  return { x: x!, y: y!, zoom: zoom! };
}

const identity = { x: 0, y: 0, zoom: 1 };

/** Makes every element report this size to React Flow (see test/setup.ts for the default). */
function setLayoutSize(width: number, height: number): void {
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => width },
    offsetHeight: { configurable: true, get: () => height },
  });
}

const defaultSize = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!,
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!,
};
afterEach(() => {
  Object.defineProperties(HTMLElement.prototype, defaultSize);
});

describe('IstarCanvas ref', () => {
  test('exposes viewport controls', async () => {
    const { store, goalId } = actorWithGoal();
    const ref = createRef<IstarCanvasHandle>();
    const { container } = render(<IstarCanvas ref={ref} store={store} fitView={false} />);
    expect(viewport(container)).toEqual(identity);

    // Goal box: absolute (500, 380), default size 90x35, so its centre is (545, 397.5). The
    // flow container is 100x100 here (setup.ts), so centring puts that point at (50, 50).
    await act(async () => expect(await ref.current!.centerOn(goalId)).toBe(true));
    expect(viewport(container)).toEqual({ x: -495, y: -347.5, zoom: 1 });
    await act(async () => expect(await ref.current!.centerOn('no-such-id')).toBe(false));

    await act(async () => expect(await ref.current!.zoomIn()).toBe(true));
    expect(viewport(container).zoom).toBeCloseTo(1.2);
    await act(async () => expect(await ref.current!.zoomOut()).toBe(true));
    expect(viewport(container).zoom).toBeCloseTo(1);

    await act(async () => expect(await ref.current!.fitView({ nodes: [goalId] })).toBe(true));
    expect(viewport(container).zoom).not.toBeCloseTo(1);
  });

  test('works inside an outer IstarProvider', async () => {
    const { store, goalId } = actorWithGoal();
    const ref = createRef<IstarCanvasHandle>();
    const { container } = render(
      <IstarProvider store={store}>
        <IstarCanvas ref={ref} fitView={false} />
      </IstarProvider>,
    );
    await act(async () => expect(await ref.current!.centerOn(goalId, { zoom: 2 })).toBe(true));
    expect(viewport(container)).toEqual({ x: -1040, y: -745, zoom: 2 });
  });
});

describe('initial fitView', () => {
  test('waits until the container has a usable size', () => {
    const { store } = actorWithGoal();
    setLayoutSize(4, 4);
    const { container } = render(<IstarCanvas store={store} />);
    // Fitting now would clamp to minZoom; the viewport is left alone instead.
    expect(viewport(container)).toEqual(identity);

    setLayoutSize(800, 600);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(viewport(container)).not.toEqual(identity);
    expect(viewport(container).zoom).toBeGreaterThan(0.1);
  });

  test('a model loaded after mount is fitted when it arrives', () => {
    const store = createModelStore();
    const { container } = render(<IstarCanvas store={store} />);
    expect(viewport(container)).toEqual(identity);
    act(() => store.load(actorWithGoal().store.getModel()));
    expect(viewport(container)).not.toEqual(identity);
  });
});
