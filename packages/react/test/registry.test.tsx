import { createModelStore, defineProperties, prop } from '@istar-ts/core';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, test } from 'vitest';
import type { ElementComponentProps } from '../src';
import {
  IstarCanvas,
  applyExtensions,
  createRegistry,
  defaultPropertiesFor,
  defaultRegistry,
} from '../src';

function Chip({ element }: ElementComponentProps): ReactElement {
  return <span data-testid="chip">{`[${element.customProperties?.type}] ${element.name}`}</span>;
}

describe('registry', () => {
  test('default registry covers every kind like piStar', () => {
    expect(Object.keys(defaultRegistry.elements)).toHaveLength(7);
    expect(defaultRegistry.links['istar.ContributionLink'].palette).toHaveLength(4);
    expect(defaultRegistry.links['istar.DependencyLink'].palette).toHaveLength(4);
    expect(defaultRegistry.elements['istar.Task'].size).toEqual({ width: 95, height: 36 });
  });

  test('overrides merge per kind and leave the base untouched', () => {
    const registry = createRegistry({
      elements: {
        'istar.Resource': { palette: { label: 'Variable' }, defaultProperties: { type: 'bool' } },
        'istar.Role': { palette: false },
      },
      links: { 'istar.IsALink': { palette: false } },
    });
    expect(registry.elements['istar.Resource'].palette).toMatchObject({
      label: 'Variable',
      order: expect.any(Number),
    });
    expect(registry.elements['istar.Role'].palette).toBe(false);
    expect(registry.links['istar.IsALink'].palette).toBe(false);
    expect(defaultRegistry.elements['istar.Role'].palette).not.toBe(false);
    expect(registry.elements['istar.Resource'].component).toBe(
      defaultRegistry.elements['istar.Resource'].component,
    );
  });

  test('defaultProperties combine schema defaults with presets (preset wins)', () => {
    const schema = defineProperties('istar.Resource', {
      type: prop.enum(['bool', 'int'], { default: 'bool' }),
      initialValue: prop.string({ default: 'false' }),
    });
    const registry = createRegistry({
      elements: {
        'istar.Resource': {
          properties: schema,
          defaultProperties: ({ model }) => ({ initialValue: String(model.elements.size) }),
        },
      },
    });
    const model = createModelStore().getModel();
    expect(defaultPropertiesFor(registry, 'istar.Resource', model)).toEqual({
      type: 'bool',
      initialValue: '0',
    });
    expect(defaultPropertiesFor(registry, 'istar.Goal', model)).toBeUndefined();
  });

  test('a custom component renders instead of the default shape', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    store.addElement({
      kind: 'istar.Resource',
      x: 20,
      y: 60,
      parent: actor.id,
      name: 'battery',
      customProperties: { type: 'int' },
    });
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas
          store={store}
          registry={createRegistry({ elements: { 'istar.Resource': { component: Chip } } })}
        />
      </div>,
    );
    expect(screen.getByTestId('chip').textContent).toBe('[int] battery');
    expect(screen.queryByRole('button', { name: 'Resource' })).toBeTruthy();
  });

  test('extensions apply in order on top of the base registry', () => {
    const registry = applyExtensions(defaultRegistry, [
      {
        elements: {
          'istar.Resource': { palette: { label: 'First' }, defaultProperties: { a: '1' } },
        },
      },
      { elements: { 'istar.Resource': { palette: { label: 'Second' } } } },
    ]);
    expect(registry.elements['istar.Resource'].palette).toMatchObject({ label: 'Second' });
    expect(registry.elements['istar.Resource'].defaultProperties).toEqual({ a: '1' });
    expect(defaultRegistry.elements['istar.Resource'].palette).toMatchObject({ label: 'Resource' });
  });

  test('the extensions prop adapts the canvas', () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    store.addElement({
      kind: 'istar.Resource',
      x: 20,
      y: 60,
      parent: actor.id,
      name: 'battery',
      customProperties: { type: 'int' },
    });
    const extensions = [{ name: 'chips', elements: { 'istar.Resource': { component: Chip } } }];
    render(
      <div style={{ width: 800, height: 600 }}>
        <IstarCanvas store={store} extensions={extensions} />
      </div>,
    );
    expect(screen.getByTestId('chip').textContent).toBe('[int] battery');
  });
});
