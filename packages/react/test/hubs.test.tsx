import type { IstarElement } from '@istar-ts/core';
import {
  ISTAR_2_0,
  createEmptyModel,
  createModelStore,
  defineProperties,
  extendMetamodel,
  prop,
} from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import type { IstarEditor, IstarExtension } from '../src';
import { HubComponent, HubInspector, IstarInspector, IstarProvider, useIstarEditor } from '../src';

// A stand-in for the hub core generates for an n-ary link: an element kind drawn and inspected
// with the hub defaults.
const METAMODEL = extendMetamodel(ISTAR_2_0, {
  name: 'hubs',
  elements: [{ kind: 'hubs.RefinementHub', category: 'node', size: { width: 20, height: 20 } }],
});

const refinement = defineProperties('hubs.RefinementHub', {
  SysRef: prop.string({ default: '' }),
  Tactic: prop.string({ default: '' }),
});

const hubs: IstarExtension<string, string> = {
  name: 'hubs',
  elements: {
    'hubs.RefinementHub': {
      label: 'Refinement',
      component: HubComponent,
      inspector: HubInspector,
      properties: refinement,
    },
  },
};

function setup() {
  const store = createModelStore(createEmptyModel(undefined, { metamodel: METAMODEL }));
  const hub = store.addElement({
    kind: 'hubs.RefinementHub',
    x: 100,
    y: 100,
    customProperties: { SysRef: 'R1', Description: 'note' },
  } as never) as IstarElement<string>;
  let editor: IstarEditor | undefined;
  function Grab(): null {
    const e = useIstarEditor();
    useEffect(() => {
      editor = e;
    });
    return null;
  }
  render(
    <IstarProvider store={store} extensions={[hubs]}>
      <Grab />
      <IstarInspector />
    </IstarProvider>,
  );
  act(() => editor!.select({ type: 'element', id: hub.id }));
  return { store, hub };
}

describe('HubComponent', () => {
  test('draws a circle filling its box, with a non-scaling stroke', () => {
    const element = {
      id: 'h',
      kind: 'hubs.RefinementHub',
      name: '',
      x: 0,
      y: 0,
    } as unknown as IstarElement;
    const { container } = render(
      <HubComponent
        element={element}
        width={20}
        height={20}
        selected={false}
        editing={false}
        setEditing={() => {}}
        actions={{} as never}
        readOnly={false}
        issues={[]}
      />,
    );
    const circle = container.querySelector('circle')!;
    expect([
      circle.getAttribute('cx'),
      circle.getAttribute('cy'),
      circle.getAttribute('r'),
    ]).toEqual(['10', '10', '9']);
    expect(circle.style.vectorEffect).toBe('non-scaling-stroke');
    expect(container.textContent).toBe('');
  });
});

describe('HubInspector', () => {
  test('titles the hub with its link, edits its properties and has no name field', () => {
    const { store, hub } = setup();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Refinement');
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Color')).toBeNull();
    const sysRef = screen.getByLabelText('SysRef') as HTMLInputElement;
    expect(sysRef.value).toBe('R1');
    fireEvent.change(sysRef, { target: { value: 'R2' } });
    fireEvent.blur(sysRef);
    expect(store.getModel().elements.get(hub.id)?.customProperties).toEqual({
      SysRef: 'R2',
      Description: 'note',
    });
    // Keys outside the schema stay editable, as in the element inspector.
    expect(screen.getByLabelText('Remove property Description')).toBeTruthy();
  });

  test('deletes the hub', () => {
    const { store, hub } = setup();
    fireEvent.click(screen.getByText('Delete refinement'));
    expect(store.getModel().elements.has(hub.id)).toBe(false);
  });
});
