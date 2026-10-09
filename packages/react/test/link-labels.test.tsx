import type { IstarModel } from '@istar-ts/core';
import { ISTAR_2_0, createModelStore, extendMetamodel } from '@istar-ts/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, test } from 'vitest';
import type { IstarExtension, LinkLabelProps } from '../src';
import { IstarCanvas, IstarInspector } from '../src';

function model() {
  const store = createModelStore();
  const a = store.addElement({ kind: 'istar.Actor', x: 0, y: 0, name: 'A' });
  const b = store.addElement({ kind: 'istar.Actor', x: 400, y: 0, name: 'B' });
  const goal = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: a.id, name: 'G' });
  const quality = store.addElement({
    kind: 'istar.Quality',
    x: 20,
    y: 200,
    parent: a.id,
    name: 'Q',
  });
  const isA = store.connect({ kind: 'istar.IsALink', source: a.id, target: b.id, name: 'kind of' });
  const help = store.connect({
    kind: 'istar.ContributionLink',
    source: goal.id,
    target: quality.id,
    label: 'help',
  });
  if (!isA.ok || !help.ok) throw new Error('setup');
  return { store, isA: isA.link, help: help.link };
}

function Stereotype({ link, labels, selected }: LinkLabelProps): ReactElement {
  return (
    <span data-testid={`label-${link.id}`} data-selected={selected}>
      {`<<${link.customProperties?.stereotype ?? 'none'}>> ${labels.fixed ?? ''} ${labels.name ?? ''}`.trim()}
    </span>
  );
}

const labelOf = (container: HTMLElement, linkId: string, cls: string) =>
  container.querySelector(`.react-flow__edge[data-id="${linkId}"] .istar-link-label.${cls}`)
    ?.textContent;

describe('link labels', () => {
  test('iStar 2.0 labels draw as before; names only with linkNames, as in piStar', () => {
    const { store, isA, help } = model();
    const { container, unmount } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas store={store} />
      </div>,
    );
    expect(labelOf(container, isA.id, 'is-actor-link')).toBe('is-a');
    expect(labelOf(container, help.id, 'is-contribution')).toBe('help');
    expect(labelOf(container, isA.id, 'is-name')).toBeUndefined();
    expect(container.querySelector('.istar-link-label-slot')).toBeNull();
    unmount();

    const withNames = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas store={store} linkNames />
      </div>,
    );
    expect(labelOf(withNames.container, isA.id, 'is-name')).toBe('kind of');
    expect(labelOf(withNames.container, isA.id, 'is-actor-link')).toBe('is-a');
  });

  test('a kind’s labelComponent replaces the default labels and receives them', () => {
    const { store, isA, help } = model();
    store.updateLink(isA.id, { customProperties: { stereotype: 'role' } });
    const extensions: IstarExtension[] = [
      { name: 'stereotypes', links: { 'istar.IsALink': { labelComponent: Stereotype } } },
    ];
    const { container } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas store={store} extensions={extensions} />
      </div>,
    );
    expect(screen.getByTestId(`label-${isA.id}`).textContent).toBe('<<role>> is-a kind of');
    expect(labelOf(container, isA.id, 'is-actor-link')).toBeUndefined();
    // Other kinds keep their default labels.
    expect(labelOf(container, help.id, 'is-contribution')).toBe('help');
  });

  test('extended link kinds get the slot too', () => {
    const m = extendMetamodel(ISTAR_2_0, {
      name: 'x',
      links: [
        { kind: 'x.TracesLink', label: 'Traces', rules: { sources: ['node'], targets: ['node'] } },
      ],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const g1 = store.addElement({ kind: 'istar.Goal', x: 20, y: 60, parent: actor.id });
    const g2 = store.addElement({ kind: 'istar.Goal', x: 20, y: 200, parent: actor.id });
    const link = store.connect({ kind: 'x.TracesLink', source: g1.id, target: g2.id, name: 'n' });
    if (!link.ok) throw new Error(link.reason);
    const extensions: IstarExtension<string, string>[] = [
      { name: 'x', links: { 'x.TracesLink': { labelComponent: Stereotype } } },
    ];
    render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas store={store} extensions={extensions} />
      </div>,
    );
    expect(screen.getByTestId(`label-${link.link.id}`).textContent).toBe('<<none>>  n');
  });

  test('the default link inspector edits the name, as piStar’s properties panel does', () => {
    const { store, isA } = model();
    const { container } = render(
      <div style={{ width: 900, height: 500 }}>
        <IstarCanvas store={store} aside={<IstarInspector />} />
      </div>,
    );
    fireEvent.click(container.querySelector(`.react-flow__edge[data-id="${isA.id}"]`)!);
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('kind of');
    fireEvent.change(name, { target: { value: 'specializes' } });
    fireEvent.blur(name);
    expect((store.getModel() as IstarModel).links.get(isA.id)?.name).toBe('specializes');
    // The field remounts with the committed value: query it again.
    const again = screen.getByLabelText('Name') as HTMLInputElement;
    expect(again.value).toBe('specializes');
    fireEvent.change(again, { target: { value: '' } });
    fireEvent.blur(again);
    expect(store.getModel().links.get(isA.id)).not.toHaveProperty('name');
  });
});
