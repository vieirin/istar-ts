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
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help (+)' })).toBeTruthy();
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
