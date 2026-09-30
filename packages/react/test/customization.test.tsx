import type { ModelStore } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import type { IstarEditor, IstarExtension, PaletteControls } from '../src';
import {
  applyExtensions,
  createRegistry,
  defaultRegistry,
  IstarCanvas,
  IstarProvider,
  modelToFlow,
  paletteEntryFor,
  paletteSections,
  useIstarEditor,
  usePaletteControls,
} from '../src';

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useEffect(() => {
    onEditor(editor);
  });
  return null;
}

function actorWithGoals(): { store: ModelStore; actor: string; g1: string; g2: string } {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 }).id;
  const g1 = store.addElement({ kind: 'istar.Goal', x: 40, y: 200, parent: actor }).id;
  const g2 = store.addElement({ kind: 'istar.Goal', x: 40, y: 400, parent: actor }).id;
  const linked = store.connect({ kind: 'istar.AndRefinementLink', source: g2, target: g1 });
  if (!linked.ok) throw new Error(linked.reason);
  return { store, actor, g1, g2 };
}

const frameless: IstarExtension = {
  name: 'frameless',
  elements: { 'istar.Actor': { boundary: false, size: { width: 300, height: 40 } } },
};

function renderCanvas(store: ModelStore, props: Parameters<typeof IstarCanvas>[0] = {}) {
  const editor: { current?: IstarEditor } = {};
  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <IstarProvider store={store} extensions={props.extensions}>
        <Grab onEditor={(e) => (editor.current = e)} />
        <IstarCanvas fitView={false} {...props} />
      </IstarProvider>
    </div>,
  );
  return { ...view, editor: () => editor.current! };
}

describe('element tools with preset properties', () => {
  test('the new element gets the preset over the kind defaults', () => {
    const { store, actor } = actorWithGoals();
    const { container, editor } = renderCanvas(store);
    act(() =>
      editor().setTool({
        type: 'element',
        kind: 'istar.Goal',
        properties: { GoalType: 'Achieve' },
      }),
    );
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${actor}"]`)!, {
      clientX: 200,
      clientY: 300,
    });
    const added = [...store.getModel().elements.values()].at(-1)!;
    expect(added.kind).toBe('istar.Goal');
    expect(added.customProperties).toMatchObject({ GoalType: 'Achieve' });
  });
});

describe('usePaletteControls', () => {
  test('lists the registry tools as data and toggles them like the built-in palette', () => {
    const store = createModelStore();
    const controls: { current?: PaletteControls } = {};
    function Bar(): ReactElement {
      const current = usePaletteControls();
      useEffect(() => {
        controls.current = current;
      });
      return <div />;
    }
    render(
      <IstarProvider store={store}>
        <Bar />
      </IstarProvider>,
    );
    const goal = controls.current!.controls.find((c) => c.key === 'istar.Goal')!;
    expect(goal).toMatchObject({ label: 'Goal', active: false });
    expect(controls.current!.controls.some((c) => c.tool.type === 'link')).toBe(true);
    expect(controls.current!.canUndo).toBe(false);

    act(() => goal.select());
    expect(controls.current!.tool).toEqual({ type: 'element', kind: 'istar.Goal' });
    expect(controls.current!.controls.find((c) => c.key === 'istar.Goal')!.active).toBe(true);
    act(() => controls.current!.controls.find((c) => c.key === 'istar.Goal')!.select());
    expect(controls.current!.tool).toBeNull();

    act(() => void store.addElement({ kind: 'istar.Actor', x: 0, y: 0 }));
    expect(controls.current!.canUndo).toBe(true);
    act(() => controls.current!.undo());
    expect(store.getModel().elements.size).toBe(0);
  });
});

describe('actors without a boundary', () => {
  test('are laid out at their own size, with their elements still nested', () => {
    const { store, actor, g1 } = actorWithGoals();
    // A saved display size (e.g. the old MutRoSe editor stored 3604x1207) is ignored.
    store.updateElement(actor, { display: { width: 3604, height: 1207 } });
    const registry = createRegistry(frameless.elements ? { elements: frameless.elements } : {});
    const { nodes } = modelToFlow(store.getModel(), registry);
    expect(nodes.find((n) => n.id === actor)).toMatchObject({
      position: { x: 0, y: 0 },
      width: 300,
      height: 40,
      data: { frameless: true },
    });
    expect(nodes.find((n) => n.id === g1)).toMatchObject({
      parentId: actor,
      position: { x: 40, y: 200 },
    });
  });

  test('draw no boundary, and select from anywhere on the node', () => {
    const { store, actor } = actorWithGoals();
    const { container, editor } = renderCanvas(store, { extensions: [frameless] });
    const node = container.querySelector(`.react-flow__node[data-id="${actor}"]`)!;
    expect(node.querySelector('.istar-actor-boundary')).toBeNull();
    expect(node.querySelector('.istar-actor.is-frameless')).not.toBeNull();
    const symbol = node.querySelector('.istar-actor-symbol')!;
    fireEvent.pointerDown(symbol);
    fireEvent.click(symbol);
    expect(editor().selection).toEqual({ type: 'element', id: actor });
  });

  test('a node added on empty space joins the nearest one; Alt+click does not collapse', () => {
    const { store, actor } = actorWithGoals();
    const { container, editor } = renderCanvas(store, { extensions: [frameless] });
    act(() => editor().setTool({ type: 'element', kind: 'istar.Task' }));
    fireEvent.click(container.querySelector('.react-flow__pane')!, { clientX: 500, clientY: 500 });
    const added = [...store.getModel().elements.values()].at(-1)!;
    expect(added).toMatchObject({ kind: 'istar.Task', parent: actor });

    const symbol = container.querySelector(
      `.react-flow__node[data-id="${actor}"] .istar-actor-symbol`,
    )!;
    fireEvent.pointerDown(symbol, { altKey: true });
    fireEvent.click(symbol, { altKey: true });
    expect(store.getModel().elements.get(actor)?.display?.collapsed).not.toBe(true);
  });
});

describe('canvas appearance options', () => {
  const linkPath = (container: HTMLElement): string =>
    container.querySelector('.istar-link-line')!.getAttribute('d')!;

  test('links are straight by default and Bézier curves with linkShape="curved"', () => {
    const { store } = actorWithGoals();
    const straight = renderCanvas(store);
    expect(linkPath(straight.container)).toMatch(/^M [\d.-]+ [\d.-]+ L /);
    straight.unmount();

    const curved = renderCanvas(store, { linkShape: 'curved' });
    const d = linkPath(curved.container);
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+ C /);
    // G2 is below G1: the curve leaves G2's top going up and enters G1's bottom from below,
    // so both control points sit straight above/below their end points.
    const [x0, , c1x, , c2x, , x3] = d.match(/-?[\d.]+/g)!.map(Number);
    expect(c1x).toBeCloseTo(x0!);
    expect(c2x).toBeCloseTo(x3!);
  });

  test('colorMode="dark" themes the canvas and React Flow; minimap is optional', () => {
    const { store } = actorWithGoals();
    const { container } = renderCanvas(store, { colorMode: 'dark', minimap: true });
    expect(container.querySelector('.istar-canvas')!.classList.contains('istar-dark')).toBe(true);
    expect(container.querySelector('.react-flow')!.classList.contains('dark')).toBe(true);
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull();
    expect(screen.queryAllByRole('toolbar').length).toBeGreaterThan(0);
  });

  test('light is the default and has no minimap', () => {
    const { store } = actorWithGoals();
    const { container } = renderCanvas(store);
    expect(container.querySelector('.istar-canvas')!.classList.contains('istar-dark')).toBe(false);
    expect(container.querySelector('.react-flow__minimap')).toBeNull();
  });
});

describe('element kinds with several palette entries', () => {
  const resources: IstarExtension = {
    name: 'resources',
    elements: {
      'istar.Resource': {
        palette: [
          {
            label: 'Boolean',
            title: 'Boolean resource: click in an actor',
            group: 'resource',
            properties: { type: 'bool', initialValue: 'true' },
          },
          {
            label: 'Integer',
            title: 'Integer resource (0 to 5): click in an actor',
            group: 'resource',
            properties: { type: 'int', initialValue: '5', lowerBound: '0', upperBound: '5' },
          },
        ],
      },
    },
    paletteGroups: { resource: { label: 'Resource' } },
  };

  test('entries share a group, keep the kind icon, and each creates the kind with its presets', () => {
    const { store, actor } = actorWithGoals();
    const { container, editor } = renderCanvas(store, { extensions: [resources] });
    // One dropdown button for the group, like Contribution.
    fireEvent.click(screen.getByRole('button', { name: 'More: Resource' }));
    const integer = screen.getByRole('menuitemradio', { name: 'Integer' });
    expect(integer.querySelector('svg')).not.toBeNull();
    fireEvent.click(integer);
    expect(editor().tool).toEqual({
      type: 'element',
      kind: 'istar.Resource',
      properties: { type: 'int', initialValue: '5', lowerBound: '0', upperBound: '5' },
    });
    // The active entry's own hint.
    expect(screen.getByRole('status').textContent).toContain('Integer resource (0 to 5)');

    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${actor}"]`)!, {
      clientX: 200,
      clientY: 300,
    });
    const added = [...store.getModel().elements.values()].at(-1)!;
    expect(added.kind).toBe('istar.Resource');
    expect(added.customProperties).toMatchObject({ type: 'int', upperBound: '5' });
  });

  test('usePaletteControls and paletteEntryFor report each entry; one entry works as before', () => {
    const registry = applyExtensions(defaultRegistry, [resources]);
    const labels = paletteSections(registry)
      .flat()
      .flatMap((slot) => (slot.type === 'item' ? [slot.item] : slot.items))
      .filter((item) => item.tool.type === 'element' && item.tool.kind === 'istar.Resource')
      .map((item) => [item.entry.label, item.entry.group, item.entry.icon !== undefined]);
    expect(labels).toEqual([
      ['Boolean', 'resource', true],
      ['Integer', 'resource', true],
    ]);
    expect(
      paletteEntryFor(registry, {
        type: 'element',
        kind: 'istar.Resource',
        properties: { type: 'bool', initialValue: 'true' },
      })?.label,
    ).toBe('Boolean');
    expect(paletteEntryFor(registry, { type: 'element', kind: 'istar.Goal' })?.label).toBe('Goal');

    const store = createModelStore();
    const controls: { current?: PaletteControls } = {};
    function Bar(): ReactElement {
      const current = usePaletteControls();
      useEffect(() => {
        controls.current = current;
      });
      return <div />;
    }
    render(
      <IstarProvider store={store} extensions={[resources]}>
        <Bar />
      </IstarProvider>,
    );
    expect(
      controls
        .current!.controls.filter((c) => c.group === 'resource')
        .map((c) => [c.label, c.tool]),
    ).toEqual([
      [
        'Boolean',
        {
          type: 'element',
          kind: 'istar.Resource',
          properties: { type: 'bool', initialValue: 'true' },
        },
      ],
      [
        'Integer',
        {
          type: 'element',
          kind: 'istar.Resource',
          properties: { type: 'int', initialValue: '5', lowerBound: '0', upperBound: '5' },
        },
      ],
    ]);
  });
});

describe('wheel and touch navigation', () => {
  const viewportOf = (container: HTMLElement) => {
    const t = (container.querySelector('.react-flow__viewport') as HTMLElement).style.transform;
    const [x, y, zoom] = [...t.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    return { x: x!, y: y!, zoom: zoom! };
  };

  test('Shift + wheel pans sideways only, from deltaY or deltaX; it can be turned off', () => {
    const { store } = actorWithGoals();
    const { container, unmount } = renderCanvas(store);
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.wheel(pane, { shiftKey: true, deltaY: 100 });
    expect(viewportOf(container)).toEqual({ x: -100, y: 0, zoom: 1 });
    fireEvent.wheel(pane, { shiftKey: true, deltaX: -40, deltaY: 0 });
    expect(viewportOf(container)).toEqual({ x: -60, y: 0, zoom: 1 });
    unmount();

    const off = renderCanvas(store, { panOnShiftScroll: false });
    fireEvent.wheel(off.container.querySelector('.react-flow__pane')!, {
      shiftKey: true,
      deltaY: 100,
    });
    expect(viewportOf(off.container).x).toBe(0);
  });

  test('a two-finger pinch zooms around its midpoint, even when it starts on a node', () => {
    const { store, g1 } = actorWithGoals();
    const { container } = renderCanvas(store);
    const node = container.querySelector(`.react-flow__node[data-id="${g1}"]`)!;
    const touches = (d: number) => [
      { identifier: 1, clientX: 100 - d, clientY: 100 },
      { identifier: 2, clientX: 100 + d, clientY: 100 },
    ];
    fireEvent.touchStart(node, { touches: touches(20), changedTouches: touches(20) });
    fireEvent.touchMove(node, { touches: touches(40), changedTouches: touches(40) });
    fireEvent.touchEnd(node, { touches: [], changedTouches: touches(40) });
    // Twice the finger distance: zoom 2, keeping the midpoint (100, 100) fixed.
    expect(viewportOf(container)).toEqual({ x: -100, y: -100, zoom: 2 });
  });
});
