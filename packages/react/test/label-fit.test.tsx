import { createModelStore, parsePistar } from '@istar-ts/core';
import { act, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { IstarEditor, IstarExtension, LinkLabelProps } from '../src';
import { IstarCanvas, IstarProvider, TEXT_BOXES, useIstarEditor } from '../src';

/**
 * jsdom has no layout: the label box gets a fixed size and the label content a height
 * proportional to its font scale (`contentPerEm` px at 1em).
 */
const geometry = { boxHeight: 80, boxWidth: 100, contentPerEm: 50, headerLinePerEm: 0 };
const scaleOf = (el: HTMLElement) => Number.parseFloat(el.style.fontSize || '1') || 1;
const saved: [string, PropertyDescriptor | undefined][] = [];
function stub(prop: string, get: (el: HTMLElement) => number) {
  saved.push([prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]);
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this);
    },
  });
}
beforeEach(() => {
  geometry.boxHeight = 80;
  geometry.contentPerEm = 50;
  geometry.headerLinePerEm = 0;
  stub('clientHeight', (el) => (el.classList.contains('istar-label-box') ? geometry.boxHeight : 0));
  stub('clientWidth', (el) =>
    el.classList.contains('istar-label-box') || el.classList.contains('istar-label-header-line')
      ? geometry.boxWidth
      : 0,
  );
  stub('scrollHeight', (el) =>
    el.classList.contains('istar-label-content')
      ? geometry.contentPerEm * scaleOf(el)
      : el.classList.contains('istar-label')
        ? geometry.contentPerEm * 0.6 * scaleOf(el.parentElement!)
        : 0,
  );
  // A header line clips itself: only its own scrollWidth shows that it is too wide.
  stub('scrollWidth', (el) =>
    el.classList.contains('istar-label-header-line')
      ? geometry.headerLinePerEm * scaleOf(el.closest('.istar-label-content') as HTMLElement)
      : 0,
  );
});
afterEach(() => {
  for (const [prop, descriptor] of saved.splice(0).toReversed()) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

function oneGoal(extensions: IstarExtension[] = [], name = 'Deliver the sample') {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
  const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id, name });
  const utils = render(
    <div style={{ width: 800, height: 500 }}>
      <IstarCanvas store={store} extensions={extensions} />
    </div>,
  );
  const node = () => utils.container.querySelector(`.react-flow__node[data-id="${goal.id}"]`)!;
  const content = () => node().querySelector('.istar-label-content') as HTMLElement;
  return { ...utils, store, goal, node, content };
}

describe('label fitting', () => {
  test('names that fit are laid out as before: full box, 1em, not clipped', () => {
    const fixture = readFileSync(
      join(import.meta.dirname, '../../../fixtures/pistar/welcome.txt'),
      'utf8',
    );
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas store={createModelStore(parsePistar(fixture))} />
      </div>,
    );
    const boxes = [...container.querySelectorAll<HTMLElement>('.istar-label-box')];
    expect(boxes.length).toBeGreaterThan(10);
    for (const box of boxes) {
      expect([box.style.top, box.style.right, box.style.bottom, box.style.left]).toEqual([
        '0%',
        '0%',
        '0%',
        '0%',
      ]);
      const content = box.firstElementChild as HTMLElement;
      expect(content.style.fontSize).toBe('1em');
      expect(content.classList.contains('is-clipped')).toBe(false);
    }
  });

  test('shrink: the font steps down until the label fits', () => {
    geometry.contentPerEm = 100; // 100px at 1em in an 80px box: fits at 0.8em
    const { content } = oneGoal();
    expect(content().style.fontSize).toBe('0.8em');
    expect(content().classList.contains('is-clipped')).toBe(false);
  });

  test('then ellipsis, with the full text as the tooltip', () => {
    geometry.contentPerEm = 100;
    geometry.boxHeight = 40; // still 70px at the 0.7 minimum
    const extensions: IstarExtension[] = [
      { name: 'tags', elements: { 'istar.Goal': { labelHeader: () => ['{Id = G1}'] } } },
    ];
    const { content } = oneGoal(extensions);
    expect(content().style.fontSize).toBe('0.7em');
    expect(content().classList.contains('is-clipped')).toBe(true);
    expect(content().getAttribute('title')).toBe('{Id = G1}\nDeliver the sample');
    expect(content().style.getPropertyValue('--istar-label-lines')).not.toBe('');
  });

  test('a header line too wide for the box shrinks the label before any ellipsis', () => {
    // The block fits in height and never looks too wide (the line clips itself), but the line
    // needs 130px at 1em in a 100px box: it fits at 0.7em.
    geometry.headerLinePerEm = 130;
    const extensions: IstarExtension[] = [
      { name: 'h', elements: { 'istar.Goal': { labelHeader: () => ['<<utility-based>>'] } } },
    ];
    const { content } = oneGoal(extensions);
    expect(content().style.fontSize).toBe('0.7em');
    expect(content().classList.contains('is-clipped')).toBe(false);
  });

  test('minScale bounds header-width shrinking, then ellipsis', () => {
    geometry.headerLinePerEm = 130;
    const extensions: IstarExtension[] = [
      {
        name: 'h',
        elements: {
          'istar.Goal': { labelHeader: () => ['{Reference to G1}'], labelFit: { minScale: 0.9 } },
        },
      },
    ];
    const { content } = oneGoal(extensions);
    expect(content().style.fontSize).toBe('0.9em');
    expect(content().classList.contains('is-clipped')).toBe(true);
  });

  test("labelFit 'none' leaves overflowing text as it is", () => {
    geometry.contentPerEm = 100;
    const { content } = oneGoal([
      { name: 'n', elements: { 'istar.Goal': { labelFit: { mode: 'none' } } } },
    ]);
    expect(content().style.fontSize).toBe('');
    expect(content().classList.contains('is-clipped')).toBe(false);
  });

  test('minScale and step are configurable', () => {
    geometry.contentPerEm = 100;
    geometry.boxHeight = 60;
    const { content } = oneGoal([
      { name: 'n', elements: { 'istar.Goal': { labelFit: { minScale: 0.5, step: 0.25 } } } },
    ]);
    expect(content().style.fontSize).toBe('0.5em');
  });

  test('header lines above the name, hidden while editing', () => {
    let editor: IstarEditor | undefined;
    function Grab(): null {
      const e = useIstarEditor();
      useEffect(() => {
        editor = e;
      });
      return null;
    }
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const extensions: IstarExtension[] = [
      {
        name: 'h',
        elements: {
          'istar.Goal': {
            labelHeader: (e) =>
              e.customProperties?.st ? [`«${e.customProperties.st}»`, '{k = v}'] : null,
          },
        },
      },
    ];
    store.updateElement(goal.id, { customProperties: { st: 'action' } });
    const { container } = render(
      <div style={{ width: 800, height: 500 }}>
        <IstarProvider store={store} extensions={extensions}>
          <Grab />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );
    const lines = () =>
      [
        ...container.querySelectorAll(
          `.react-flow__node[data-id="${goal.id}"] .istar-label-header-line`,
        ),
      ].map((l) => l.textContent);
    expect(lines()).toEqual(['«action»', '{k = v}']);
    act(() => editor!.setEditingId(goal.id));
    expect(lines()).toEqual([]);
    expect(screen.getByLabelText('Element name')).toBeTruthy();
  });

  test('textBox presets inset the label box', () => {
    const { node } = oneGoal([
      { name: 't', elements: { 'istar.Goal': { textBox: TEXT_BOXES.task } } },
    ]);
    const box = node().querySelector('.istar-label-box') as HTMLElement;
    expect([box.style.top, box.style.left]).toEqual(['6%', '12%']);
  });

  test("'grow' sets display.height after an edit, never on load", () => {
    geometry.contentPerEm = 100;
    let editor: IstarEditor | undefined;
    function Grab(): null {
      const e = useIstarEditor();
      useEffect(() => {
        editor = e;
      });
      return null;
    }
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const extensions: IstarExtension[] = [
      { name: 'g', elements: { 'istar.Goal': { labelFit: { mode: 'grow' } } } },
    ];
    render(
      <div style={{ width: 800, height: 500 }}>
        <IstarProvider store={store} extensions={extensions}>
          <Grab />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );
    // Loading/rendering leaves the model alone.
    expect(store.getModel().elements.get(goal.id)?.display).toBeUndefined();
    act(() => editor!.setEditingId(goal.id));
    act(() => editor!.setEditingId(null));
    expect(store.getModel().elements.get(goal.id)?.display).toEqual({ height: 100 });
  });
});

function ShowHeader({ labels }: LinkLabelProps): ReactElement {
  return <span data-testid="hdr">{(labels.header ?? []).join(' | ')}</span>;
}

function links(extensions: IstarExtension[]) {
  const store = createModelStore();
  const a = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
  const b = store.addElement({ kind: 'istar.Actor', x: 400, y: 0 });
  const link = store.connect({ kind: 'istar.IsALink', source: a.id, target: b.id });
  if (!link.ok) throw new Error(link.reason);
  const utils = render(
    <div style={{ width: 900, height: 500 }}>
      <IstarCanvas store={store} extensions={extensions} />
    </div>,
  );
  return { ...utils, id: link.link.id };
}

describe('link labelHeader', () => {
  test('lines go above the default label, without a labelComponent', () => {
    const { container, id } = links([
      { name: 'h', links: { 'istar.IsALink': { labelHeader: () => ['<<s>>', '{k=v}'] } } },
    ]);
    const edge = container.querySelector(`.react-flow__edge[data-id="${id}"]`)!;
    expect(
      [...edge.querySelectorAll('.istar-link-label.is-header')].map((t) => t.textContent),
    ).toEqual(['<<s>>', '{k=v}']);
    expect(edge.querySelector('.istar-link-label.is-actor-link')?.textContent).toBe('is-a');
  });

  test('a labelComponent receives them as labels.header', () => {
    links([
      {
        name: 'h',
        links: { 'istar.IsALink': { labelHeader: () => ['<<s>>'], labelComponent: ShowHeader } },
      },
    ]);
    expect(screen.getByTestId('hdr').textContent).toBe('<<s>>');
  });
});

describe('layering', () => {
  test('edge labels are lifted above actor boundaries, scoped to the canvas', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8');
    expect(css).toMatch(/\.istar-canvas \.react-flow__edgelabel-renderer \{\s*z-index: 1;\s*\}/);
  });
});
