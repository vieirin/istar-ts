import type { IstarModel } from '@istar-ts/core';
import { createModelStore, parsePistar } from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { IstarEditor } from '../src';
import { IstarCanvas, IstarInspector, IstarProvider, useIstarEditor } from '../src';

const fixture = readFileSync(
  join(
    import.meta.dirname,
    '../../../fixtures/goal-controller/dissertationExamples/singleGoal.txt',
  ),
  'utf8',
);

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useEffect(() => {
    onEditor(editor);
  });
  return null;
}

describe('IstarCanvas', () => {
  test('renders every element name and the palette', () => {
    const model = parsePistar(fixture);
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas model={model} onChange={() => {}} />
      </div>,
    );
    for (const element of model.elements.values()) {
      expect(screen.getAllByText(element.name).length).toBeGreaterThan(0);
    }
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
    // Contributions are grouped in a dropdown, like piStar.
    expect(screen.queryByRole('menuitemradio', { name: 'Help (+)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More: Contribution' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Help (+)' }));
    expect(screen.queryByRole('menu')).toBeNull();
    // The group button now shows (and toggles) the last choice.
    const help = screen.getByRole('button', { name: 'Help (+)' });
    expect(help.getAttribute('aria-pressed')).toBe('true');
  });

  test('palette toggles the active tool; clicking the pane adds an actor', () => {
    const store = createModelStore();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Actor' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // A status hint says what to do next, like piStar's status bar.
    expect(screen.getByRole('status').textContent).toContain('click on an empty spot');
    const pane = container.querySelector('.react-flow__pane')!;
    fireEvent.click(pane, { clientX: 100, clientY: 100 });
    expect([...store.getModel().elements.values()].map((e) => e.kind)).toEqual(['istar.Actor']);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    // Undo is enabled now.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getModel().elements.size).toBe(0);
  });

  test('controlled mode reports edits through onChange', () => {
    const initial = parsePistar(fixture);
    const onChange = vi.fn<(model: IstarModel) => void>();
    const editor: { current?: IstarEditor } = {};
    render(
      <IstarProvider model={initial} onChange={onChange}>
        <Grab onEditor={(e) => (editor.current = e)} />
      </IstarProvider>,
    );
    const goal = [...initial.elements.values()].find((e) => e.kind === 'istar.Goal')!;
    act(() => editor.current!.elementActions(goal.id).rename('Renamed'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].elements.get(goal.id)?.name).toBe('Renamed');
  });

  test('connection checks explain rejected links for the active tool', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 10, y: 10, parent: actor.id });
    const quality = store.addElement({ kind: 'istar.Quality', x: 10, y: 80, parent: actor.id });
    const editor: { current?: IstarEditor } = {};
    function Harness(): ReactElement {
      return (
        <IstarProvider store={store}>
          <Grab onEditor={(e) => (editor.current = e)} />
        </IstarProvider>
      );
    }
    render(<Harness />);
    act(() => editor.current!.setTool({ type: 'link', kind: 'istar.AndRefinementLink' }));
    expect(editor.current!.checkConnection(quality.id, goal.id)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('must be a Goal or a Task'),
    });
    act(() =>
      editor.current!.setTool({ type: 'link', kind: 'istar.ContributionLink', value: 'help' }),
    );
    expect(editor.current!.checkConnection(goal.id, quality.id)).toEqual({ ok: true });
    act(() => editor.current!.setTool({ type: 'dependency', dependum: 'istar.Goal' }));
    expect(editor.current!.checkConnection(goal.id, quality.id)).toMatchObject({
      code: 'same-actor',
    });
  });

  test('selecting a node shows it in the inspector without update loops', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const model = parsePistar(fixture);
    const goal = [...model.elements.values()].find((e) => e.kind === 'istar.Goal')!;
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={createModelStore(model)} aside={<IstarInspector />} />
      </div>,
    );
    const node = container.querySelector(`.react-flow__node[data-id="${goal.id}"]`)!;
    fireEvent.click(node);
    expect((screen.getByLabelText('Name') as HTMLTextAreaElement).value).toBe(goal.name);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/Maximum update depth/);
    errors.mockRestore();
  });
});

describe('inline name editing', () => {
  test('typing keeps every character and Enter commits once', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} />
      </div>,
    );
    const node = container.querySelector(`.react-flow__node[data-id="${goal.id}"] .istar-element`)!;
    fireEvent.doubleClick(node);
    const input = screen.getByLabelText('Element name') as HTMLTextAreaElement;
    for (const value of ['G', 'G1', 'G1:', 'G1: Collect']) {
      fireEvent.change(input, { target: { value } });
    }
    expect(input.value).toBe('G1: Collect');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(store.getModel().elements.get(goal.id)?.name).toBe('G1: Collect');
  });
});

describe('palette placement', () => {
  test('palette="top" renders a horizontal bar with labels; false hides it', () => {
    const { unmount } = render(<IstarCanvas store={createModelStore()} palette="top" />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(toolbar.textContent).toContain('Actor links');
    expect(toolbar.textContent).not.toContain('…');
    expect(toolbar.textContent).toContain('Goal');
    unmount();
    render(<IstarCanvas store={createModelStore()} palette={false} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('links are selectable objects', () => {
  test('clicking a link selects it and shows it in the inspector; it can be deleted', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const g1 = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id, name: 'G1' });
    const g2 = store.addElement({
      kind: 'istar.Goal',
      x: 20,
      y: 200,
      parent: actor.id,
      name: 'G2',
    });
    const link = store.connect({ kind: 'istar.AndRefinementLink', source: g2.id, target: g1.id });
    if (!link.ok) throw new Error(link.reason);
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} aside={<IstarInspector />} />
      </div>,
    );
    const edge = container.querySelector(`.react-flow__edge[data-id="${link.link.id}"]`)!;
    expect(edge).toBeTruthy();
    fireEvent.click(edge);
    expect(edge.classList.contains('selected')).toBe(true);
    expect(screen.getByText('And-Refinement')).toBeTruthy();
    expect(screen.getByText('G2 → G1')).toBeTruthy();
    // (The Delete key goes through React Flow's key handling, verified in a browser; jsdom
    // can't drive it, so delete through the inspector.)
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }));
    expect(store.getModel().links.size).toBe(0);
  });
});
