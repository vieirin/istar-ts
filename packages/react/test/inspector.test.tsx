import type { ModelStore } from '@istar-ts/core';
import { createModelStore, defineProperties, prop } from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import type { InspectorProps, IstarEditor, IstarRegistry } from '../src';
import { IstarInspector, IstarProvider, createRegistry, useIstarEditor } from '../src';
import type { IstarElement } from '@istar-ts/core';

const resourceSchema = defineProperties(
  'istar.Resource',
  { type: prop.enum(['bool', 'int']), initialValue: prop.string() },
  {
    validate: (v) =>
      v.type === 'bool' &&
      v.initialValue !== undefined &&
      !['true', 'false'].includes(v.initialValue)
        ? [{ key: 'initialValue', message: 'must be true or false' }]
        : [],
  },
);

function setup(registry?: IstarRegistry) {
  const store = createModelStore();
  const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
  const resource = store.addElement({
    kind: 'istar.Resource',
    x: 10,
    y: 60,
    parent: actor.id,
    name: 'battery',
    customProperties: { type: 'bool', initialValue: 'maybe', Description: 'note' },
  });
  let editor: IstarEditor | undefined;
  function Grab(): null {
    const e = useIstarEditor();
    useEffect(() => {
      editor = e;
    });
    return null;
  }
  render(
    <IstarProvider store={store} registry={registry}>
      <Grab />
      <IstarInspector />
    </IstarProvider>,
  );
  act(() => editor!.select({ type: 'element', id: resource.id }));
  return { store, resource, actor };
}

const valueOf = (store: ModelStore, id: string) =>
  store.getModel().elements.get(id)?.customProperties;

function Custom({ target, actions }: InspectorProps<IstarElement>): ReactElement {
  return (
    <button type="button" onClick={() => actions.setProperties({ initialValue: 'true' })}>
      {`custom for ${target.name}`}
    </button>
  );
}

describe('IstarInspector', () => {
  test('shows a hint when nothing is selected', () => {
    render(
      <IstarProvider store={createModelStore()}>
        <IstarInspector />
      </IstarProvider>,
    );
    expect(screen.getByText(/Select an element/)).toBeTruthy();
  });

  test('default inspector: name, free-form properties, commit on blur', () => {
    const { store, resource } = setup();
    const name = screen.getByLabelText('Name') as HTMLTextAreaElement;
    expect(name.value).toBe('battery');
    fireEvent.change(name, { target: { value: 'charge' } });
    expect(store.getModel().elements.get(resource.id)?.name).toBe('battery');
    fireEvent.blur(name);
    expect(store.getModel().elements.get(resource.id)?.name).toBe('charge');
    fireEvent.click(screen.getByLabelText('Remove property Description'));
    expect(valueOf(store, resource.id)).toEqual({ type: 'bool', initialValue: 'maybe' });
  });

  test('schema fields render typed inputs, show issues and write strings', () => {
    const { store, resource } = setup(
      createRegistry({ elements: { 'istar.Resource': { properties: resourceSchema } } }),
    );
    expect(screen.getByText('must be true or false')).toBeTruthy();
    const type = screen.getByLabelText('type') as HTMLSelectElement;
    expect(type.tagName).toBe('SELECT');
    fireEvent.change(type, { target: { value: 'int' } });
    expect(valueOf(store, resource.id)?.type).toBe('int');
    // Schema keys are not repeated in the free-form list; other keys are.
    expect(screen.queryByLabelText('Remove property type')).toBeNull();
    expect(screen.getByLabelText('Remove property Description')).toBeTruthy();
  });

  test('a registry inspector replaces the default one; false hides it', () => {
    const { store, resource } = setup(
      createRegistry({ elements: { 'istar.Resource': { inspector: Custom } } }),
    );
    fireEvent.click(screen.getByText('custom for battery'));
    expect(valueOf(store, resource.id)?.initialValue).toBe('true');
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  test('inspector: false shows nothing for that kind', () => {
    setup(createRegistry({ elements: { 'istar.Resource': { inspector: false } } }));
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Inspector' }).textContent).toBe('');
  });
});
