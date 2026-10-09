import type { GoalDiagnostic, IstarElement } from '@istar-ts/core';
import { createDiagnosticsStore, createModelStore, defineProperties, prop } from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type {
  ElementComponentProps,
  ElementIssue,
  InspectorProps,
  IstarEditor,
  IstarExtension,
  IssueSeverity,
  LinkLabelProps,
} from '../src';
import {
  DefaultElementComponent,
  ElementIssuesBadge,
  IstarCanvas,
  IstarInspector,
  IstarProvider,
  createRegistry,
  diagnosticToIssue,
  issueToDiagnostic,
  useElementDiagnostics,
  useGoalDiagnostics,
  useIstarEditor,
} from '../src';

function model() {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0, name: 'A' });
  const other = store.addElement({ kind: 'istar.Actor', x: 400, y: 0, name: 'B' });
  const goal = store.addElement({
    kind: 'istar.Goal',
    x: 20,
    y: 60,
    parent: actor.id,
    name: 'G1',
    customProperties: { Monitors: 'x', Note: 'n' },
  });
  const isA = store.connect({ kind: 'istar.IsALink', source: actor.id, target: other.id });
  if (!isA.ok) throw new Error('setup');
  return { store, actor, goal, link: isA.link };
}

const badgeOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .istar-issues-badge`);
const linkBadgeOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-link="${id}"] .istar-issues-badge`);

describe('canvas badges', () => {
  test('issues, a diagnostics list and a store merge; the badge shows the worst severity', () => {
    const { store, goal } = model();
    const diagnostics = createDiagnosticsStore();
    const { container, rerender } = render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas
          store={store}
          issues={[{ id: goal.id, severity: 'info', message: 'from issues' }]}
          diagnostics={diagnostics}
        />
      </div>,
    );
    expect(badgeOf(container, goal.id)?.className).toContain('is-info');

    act(() =>
      diagnostics.publish('lsp', [
        { elementId: goal.id, severity: 'warning', message: 'from issues' },
        { elementId: goal.id, severity: 'hint', message: 'style', key: 'Monitors' },
      ]),
    );
    const badge = badgeOf(container, goal.id)!;
    // Deduplicated by (elementId, key, message): the issue now reads as a warning.
    expect(badge.className).toContain('is-warning');
    expect(badge.getAttribute('aria-label')).toBe('warning: from issues; [lsp] Monitors: style');
    act(() =>
      diagnostics.publish('prism', [
        { elementId: goal.id, severity: 'error', message: 'unreachable' },
      ]),
    );
    expect(badgeOf(container, goal.id)?.className).toContain('is-error');

    // Clearing one source leaves the others.
    act(() => diagnostics.clear('prism'));
    expect(badgeOf(container, goal.id)?.className).toContain('is-warning');
    act(() => diagnostics.clear());
    expect(badgeOf(container, goal.id)?.className).toContain('is-info');

    rerender(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} diagnostics={[]} />
      </div>,
    );
    expect(badgeOf(container, goal.id)).toBeNull();
  });

  test('hover lists messages with their source', () => {
    render(
      <ElementIssuesBadge
        diagnostics={[
          { elementId: 'a', severity: 'hint', message: 'consider', source: 'llm' },
          { elementId: 'a', severity: 'info', message: 'fyi' },
        ]}
      />,
    );
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('is-info');
    fireEvent.mouseEnter(badge);
    expect(screen.getByText('[llm] consider')).toBeTruthy();
    expect(screen.getByText('Info')).toBeTruthy();
  });

  test('link diagnostics show beside the link label', () => {
    const { store, link } = model();
    const { container } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas
          store={store}
          diagnostics={[{ elementId: link.id, severity: 'error', message: 'cycle' }]}
        />
      </div>,
    );
    expect(linkBadgeOf(container, link.id)?.className).toContain('is-error');
    expect(
      container
        .querySelector(`.react-flow__edge[data-id="${link.id}"] .istar-link`)
        ?.getAttribute('data-severity'),
    ).toBe('error');
  });

  test('a labelComponent receives the link diagnostics; the badge sits in its slot', () => {
    const { store, link } = model();
    function Label({ diagnostics }: LinkLabelProps): ReactElement {
      return <span data-testid="label">{diagnostics?.length ?? 0}</span>;
    }
    const extensions: IstarExtension[] = [
      { name: 'labels', links: { 'istar.IsALink': { labelComponent: Label } } },
    ];
    const { container } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas
          store={store}
          extensions={extensions}
          diagnostics={[{ elementId: link.id, severity: 'warning', message: 'w' }]}
        />
      </div>,
    );
    expect(screen.getByTestId('label').textContent).toBe('1');
    expect(
      container.querySelector(`.istar-link-label-slot[data-link="${link.id}"] .istar-issues-badge`),
    ).not.toBeNull();
  });

  test('diagnosticBadges={false} leaves badges to the host', () => {
    const { store, goal, link } = model();
    const { container } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas
          store={store}
          diagnosticBadges={false}
          diagnostics={[
            { elementId: goal.id, severity: 'error', message: 'e' },
            { elementId: link.id, severity: 'error', message: 'e' },
          ]}
        />
      </div>,
    );
    expect(badgeOf(container, goal.id)).toBeNull();
    expect(linkBadgeOf(container, link.id)).toBeNull();
  });
});

describe('hooks', () => {
  test('producers inside the editor publish per source; components read their diagnostics', () => {
    const { store, goal } = model();
    let api: ReturnType<typeof useGoalDiagnostics> | undefined;
    function Producer(): null {
      const diagnostics = useGoalDiagnostics();
      useEffect(() => {
        api = diagnostics;
      });
      return null;
    }
    function Node(props: ElementComponentProps): ReactElement {
      const own = useElementDiagnostics(props.element.id);
      return (
        <span data-testid={`node-${props.element.name}`}>
          {own.map((d) => d.message).join(',')}|{props.issues.map((i) => i.message).join(',')}
        </span>
      );
    }
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarProvider
          store={store}
          registry={createRegistry({ elements: { 'istar.Goal': { component: Node } } })}
        >
          <Producer />
          <IstarCanvas />
        </IstarProvider>
      </div>,
    );
    act(() =>
      api!.publish('validator', [
        { elementId: goal.id, severity: 'error', message: 'bad', key: 'Monitors' },
      ]),
    );
    // Components written against `issues` see published diagnostics too.
    expect(screen.getByTestId('node-G1').textContent).toBe('bad|Monitors: bad');
    expect(api!.byElement.get(goal.id)?.[0]?.source).toBe('validator');
    act(() => api!.clear('validator'));
    expect(screen.getByTestId('node-G1').textContent).toBe('|');
  });
});

describe('inspector', () => {
  const schema = defineProperties('istar.Goal', { Monitors: prop.string() });

  function setup(diagnosticsFor: (ids: { goal: string; link: string }) => GoalDiagnostic[]) {
    const { store, goal, link } = model();
    let editor: IstarEditor | undefined;
    function Grab(): null {
      const e = useIstarEditor();
      useEffect(() => {
        editor = e;
      });
      return null;
    }
    const registry = createRegistry({ elements: { 'istar.Goal': { properties: schema } } });
    const view = render(
      <IstarProvider
        store={store}
        registry={registry}
        diagnostics={diagnosticsFor({ goal: goal.id, link: link.id })}
      >
        <Grab />
        <IstarInspector />
      </IstarProvider>,
    );
    return {
      ...view,
      goal,
      link,
      select: (selection: Parameters<IstarEditor['select']>[0]) =>
        act(() => editor!.select(selection)),
    };
  }

  const rowOf = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll<HTMLElement>('.istar-field, .istar-custom-property')].find(
      (row) => row.querySelector('.istar-field-label')?.textContent === label,
    );
  const texts = (root: Element | null | undefined) =>
    [...(root?.querySelectorAll('.istar-diagnostic') ?? [])].map((li) => li.textContent);

  test('element-level diagnostics at the top, property ones under their rows', () => {
    const { container, goal, select } = setup((ids) => [
      { elementId: ids.goal, severity: 'error', message: 'unreachable goal', source: 'prism' },
      {
        elementId: ids.goal,
        severity: 'warning',
        message: 'unknown variable',
        key: 'Monitors',
        source: 'lsp',
      },
      { elementId: ids.goal, severity: 'info', message: 'free text', key: 'Note' },
      { elementId: ids.goal, severity: 'hint', message: 'not set', key: 'Absent' },
    ]);
    select({ type: 'element', id: goal.id });
    // The element's own, and those about a property without a row, with their key.
    expect(texts(container.querySelector('.istar-inspector-diagnostics'))).toEqual([
      'unreachable goal (prism)',
      'Absent: not set',
    ]);
    // A schema property's row…
    const monitors = rowOf(container, 'Monitors');
    expect(texts(monitors)).toEqual(['unknown variable (lsp)']);
    expect(monitors?.querySelector('.istar-diagnostic.is-warning')).not.toBeNull();
    // …and a free-form one.
    expect(texts(rowOf(container, 'Note'))).toEqual(['free text']);
  });

  test('errors mark the row; links get their diagnostics too', () => {
    const { container, goal, link, select } = setup((ids) => [
      { elementId: ids.goal, severity: 'error', message: 'bad', key: 'Note' },
      { elementId: ids.link, severity: 'warning', message: 'redundant link' },
    ]);
    select({ type: 'element', id: goal.id });
    expect(rowOf(container, 'Note')?.className).toContain('has-error');
    expect(container.querySelector('.istar-inspector-diagnostics')).toBeNull();
    select({ type: 'link', id: link.id });
    expect(texts(container.querySelector('.istar-inspector-diagnostics'))).toEqual([
      'redundant link',
    ]);
  });

  test('custom inspectors receive the diagnostics', () => {
    function Custom({ diagnostics }: InspectorProps<IstarElement>): ReactElement {
      return <p data-testid="custom">{diagnostics?.map((d) => d.message).join(',')}</p>;
    }
    const { store, goal } = model();
    let editor: IstarEditor | undefined;
    function Grab(): null {
      const e = useIstarEditor();
      useEffect(() => {
        editor = e;
      });
      return null;
    }
    render(
      <IstarProvider
        store={store}
        registry={createRegistry({ elements: { 'istar.Goal': { inspector: Custom } } })}
        diagnostics={[{ elementId: goal.id, severity: 'info', message: 'hello' }]}
      >
        <Grab />
        <IstarInspector />
      </IstarProvider>,
    );
    act(() => editor!.select({ type: 'element', id: goal.id }));
    expect(screen.getByTestId('custom').textContent).toBe('hello');
  });
});

describe('compatibility', () => {
  test('ElementIssue callers compile and behave unchanged', () => {
    const issue: ElementIssue = { id: 'x', severity: 'warning', message: 'm' };
    expectTypeOf<IssueSeverity>().toEqualTypeOf<'error' | 'warning' | 'info'>();
    expectTypeOf(issueToDiagnostic(issue)).toEqualTypeOf<GoalDiagnostic>();
    expect(issueToDiagnostic(issue)).toEqual({ elementId: 'x', severity: 'warning', message: 'm' });
    expect(diagnosticToIssue({ elementId: 'x', severity: 'hint', message: 'm', key: 'k' })).toEqual(
      {
        id: 'x',
        severity: 'info',
        message: 'k: m',
      },
    );
    // Props built without `diagnostics`, as hosts did before 0.12.
    const element = { id: 'x', kind: 'istar.Goal', name: 'G', x: 0, y: 0 } as IstarElement;
    const props: ElementComponentProps = {
      element,
      width: 90,
      height: 35,
      selected: false,
      editing: false,
      setEditing: () => {},
      actions: { rename() {}, setProperties() {}, setDisplay() {}, remove() {} },
      readOnly: false,
      issues: [issue],
    };
    expectTypeOf<InspectorProps['issues']>().toEqualTypeOf<readonly ElementIssue[]>();
    const { container } = render(<DefaultElementComponent {...props} />);
    // Outside a canvas the default component still shows `issues`.
    expect(container.querySelector('.istar-issues-badge.is-warning')).not.toBeNull();
  });
});
