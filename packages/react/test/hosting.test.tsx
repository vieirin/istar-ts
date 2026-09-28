import { createModelStore } from '@istar-ts/core';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { ElementComponentProps, ElementIssue, IstarCanvasHandle, Selection } from '../src';
import {
  ElementIssuesBadge,
  IstarCanvas,
  IstarProvider,
  createRegistry,
  defaultNameFor,
  defaultRegistry,
  groupIssuesById,
  worstSeverity,
} from '../src';

function BadgeNode({ issues }: ElementComponentProps): ReactElement {
  return (
    <span data-testid="with-issues">
      {issues.length}:{issues[0]?.message ?? ''}
    </span>
  );
}

describe('host issues', () => {
  test('groupIssuesById and worstSeverity', () => {
    const issues: ElementIssue[] = [
      { id: 'a', severity: 'info', message: 'i' },
      { id: 'a', severity: 'warning', message: 'w' },
      { id: 'b', severity: 'error', message: 'e' },
    ];
    const map = groupIssuesById(issues);
    expect(map.get('a')).toHaveLength(2);
    expect(worstSeverity(map.get('a'))).toBe('warning');
    expect(worstSeverity(map.get('b'))).toBe('error');
    expect(worstSeverity([])).toBeUndefined();
  });

  test('ElementIssuesBadge renders for errors and nothing when empty', () => {
    const { rerender } = render(
      <ElementIssuesBadge issues={[{ id: 'x', severity: 'error', message: 'boom' }]} />,
    );
    expect(screen.getByRole('status').className).toContain('is-error');
    rerender(<ElementIssuesBadge issues={[]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('issues prop reaches a custom component', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({
      kind: 'istar.Goal',
      x: 20,
      y: 60,
      parent: actor.id,
      name: 'G1',
    });
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas
          store={store}
          issues={[{ id: goal.id, severity: 'error', message: 'bad goal' }]}
          registry={createRegistry({
            elements: {
              'istar.Goal': {
                component: BadgeNode,
              },
            },
          })}
        />
      </div>,
    );
    expect(screen.getByTestId('with-issues').textContent).toBe('1:bad goal');
  });
});

describe('selection bridge', () => {
  test('onSelectionChange fires and handle.select updates selection', async () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const goal = store.addElement({
      kind: 'istar.Goal',
      x: 20,
      y: 60,
      parent: actor.id,
    });
    const seen: Selection[] = [];
    const ref = createRef<IstarCanvasHandle>();
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas
          ref={ref}
          store={store}
          fitView={false}
          onSelectionChange={(s) => seen.push(s)}
        />
      </div>,
    );
    // Initial null selection
    expect(seen[0]).toBeNull();

    await act(async () => {
      ref.current!.select({ type: 'element', id: goal.id });
    });
    expect(seen.at(-1)).toEqual({ type: 'element', id: goal.id });

    await act(async () => {
      ref.current!.select({ type: 'element', id: actor.id });
    });
    expect(seen.at(-1)).toEqual({ type: 'element', id: actor.id });
  });

  test('IstarProvider onSelectionChange works with nested canvas', async () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const onSelectionChange = vi.fn<(selection: Selection) => void>();
    const ref = createRef<IstarCanvasHandle>();
    render(
      <IstarProvider store={store} onSelectionChange={onSelectionChange}>
        <IstarCanvas ref={ref} fitView={false} />
      </IstarProvider>,
    );
    await act(async () => {
      ref.current!.select({ type: 'element', id: actor.id });
    });
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'element', id: actor.id });
  });
});

describe('defaultName', () => {
  test('defaultNameFor uses label, string, or factory', () => {
    const model = createModelStore().getModel();
    expect(defaultNameFor(defaultRegistry, 'istar.Goal', model)).toBe('Goal');

    const registry = createRegistry({
      elements: {
        'istar.Goal': {
          defaultName: ({ model: m }) => `G${m.elements.size + 1}: New`,
        },
        'istar.Task': { defaultName: 'AT1: Task' },
      },
    });
    expect(defaultNameFor(registry, 'istar.Goal', model)).toBe('G1: New');
    expect(defaultNameFor(registry, 'istar.Task', model)).toBe('AT1: Task');
  });
});
