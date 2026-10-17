import type { IstarElement } from '@istar-ts/core';
import { createModelStore, defineProperties, hubLinkOf, parsePistar, prop } from '@istar-ts/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import { KAOS } from '../../core/test/dsm3-roots';
import type { IstarEditor, IstarExtension } from '../src';
import { HubComponent, IstarInspector, IstarProvider, useIstarEditor } from '../src';

const kaosWelcome = readFileSync(
  join(import.meta.dirname, '../../../fixtures/dsm3/kaos-welcome.txt'),
  'utf8',
);

// DSM3 declares the refinement's properties on the link and saves them on its hub.
const refinement = defineProperties('kaos.RefinementLinkHub', {
  SysRef: prop.string({ default: '' }),
  Tactic: prop.string({ default: '' }),
});

const properties: IstarExtension<string, string> = {
  name: 'refinement-properties',
  links: { 'kaos.RefinementLink': { properties: refinement } },
};

function setup() {
  const store = createModelStore(parsePistar(kaosWelcome, { metamodel: KAOS }));
  // The refinement with the most sub-goals (kaos-welcome has one with two).
  const hub = [...store.getModel().elements.values()]
    .filter((e) => e.kind === 'kaos.RefinementLinkHub')
    .toSorted(
      (a, b) =>
        hubLinkOf(store.getModel(), b.id)!.legs.length -
        hubLinkOf(store.getModel(), a.id)!.legs.length,
    )[0]!;
  store.updateElement(hub.id, { customProperties: { SysRef: 'R1', Description: 'note' } });
  let editor: IstarEditor | undefined;
  function Grab(): null {
    const e = useIstarEditor();
    useEffect(() => {
      editor = e;
    });
    return null;
  }
  render(
    <IstarProvider store={store} extensions={[properties]}>
      <Grab />
      <IstarInspector />
    </IstarProvider>,
  );
  act(() => editor!.select({ type: 'element', id: hub.id }));
  return { store, hub, editor: () => editor! };
}

/** The inspector's sources and target, as shown. */
function ends(): { sources: string[]; target: string } {
  const list = document.querySelectorAll('.istar-hub-sources li');
  return {
    sources: [...list].map((li) => li.textContent ?? ''),
    target: document.querySelector('.istar-hub-target')?.textContent ?? '',
  };
}

describe('HubComponent', () => {
  test('draws a circle filling its box, with a non-scaling stroke', () => {
    const element = {
      id: 'h',
      kind: 'kaos.RefinementLinkHub',
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
  test('titles the hub with its link, edits the link’s properties and has no name field', () => {
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

  test('deleting the hub deletes the whole refinement: legs and end too', () => {
    const { store, hub } = setup();
    const parts = hubLinkOf(store.getModel(), hub.id)!;
    expect(parts.legs.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Delete refinement'));
    const model = store.getModel();
    expect(model.elements.has(hub.id)).toBe(false);
    for (const link of [...parts.legs, parts.end!]) expect(model.links.has(link.id)).toBe(false);
  });
});

describe('inspecting an n-ary link', () => {
  test('the hub lists the sources, in leg order, and the target', () => {
    const { store, hub } = setup();
    const model = store.getModel();
    const parts = hubLinkOf(model, hub.id)!;
    expect(parts.legs.length).toBe(2);
    expect(ends()).toEqual({
      sources: parts.legs.map((leg) => model.elements.get(leg.source)!.name),
      target: model.elements.get(parts.end!.target)!.name,
    });
  });

  test.each(['leg', 'end'] as const)('selecting a %s inspects the whole link', (part) => {
    const { store, hub, editor } = setup();
    const parts = hubLinkOf(store.getModel(), hub.id)!;
    const link = part === 'leg' ? parts.legs[1]! : parts.end!;
    act(() => editor().select({ type: 'link', id: link.id }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Refinement');
    expect(ends().sources).toHaveLength(2);
    expect((screen.getByLabelText('SysRef') as HTMLInputElement).value).toBe('R1');
    // Deleting from there deletes the whole link.
    fireEvent.click(screen.getByText('Delete refinement'));
    const model = store.getModel();
    expect(model.elements.has(hub.id)).toBe(false);
    for (const l of [...parts.legs, parts.end!]) expect(model.links.has(l.id)).toBe(false);
  });
});

describe("a leg's own properties", () => {
  // Cailliau's case-driven refinement puts a probability on each leg.
  const legs = defineProperties('kaos.RefinementLinkStart', {
    Probability: prop.number({ min: 0, max: 1, optional: true }),
  });
  const withLegs: IstarExtension<string, string> = {
    name: 'leg-properties',
    links: { 'kaos.RefinementLinkStart': { properties: legs } },
  };

  function selectLeg(extensions: IstarExtension<string, string>[]) {
    const store = createModelStore(parsePistar(kaosWelcome, { metamodel: KAOS }));
    const hub = [...store.getModel().elements.values()].find(
      (e) =>
        e.kind === 'kaos.RefinementLinkHub' && hubLinkOf(store.getModel(), e.id)!.legs.length === 2,
    )!;
    const leg = hubLinkOf(store.getModel(), hub.id)!.legs[0]!;
    store.updateLink(leg.id, { customProperties: { Probability: '20.00%', Note: 'n' } });
    let editor: IstarEditor | undefined;
    function Grab(): null {
      const e = useIstarEditor();
      useEffect(() => {
        editor = e;
      });
      return null;
    }
    render(
      <IstarProvider store={store} extensions={extensions}>
        <Grab />
        <IstarInspector />
      </IstarProvider>,
    );
    act(() => editor!.select({ type: 'link', id: leg.id }));
    return { store, hub, leg };
  }

  test("shows under the hub's, as typed fields, and edits the leg", () => {
    const { store, hub, leg } = selectLeg([properties, withLegs]);
    // The hub's schema first, then the leg's.
    expect((screen.getByLabelText('SysRef') as HTMLInputElement).value).toBe('');
    const sourceName = store.getModel().elements.get(leg.source)!.name;
    expect(document.querySelector('.istar-hub-part h4')?.textContent).toBe(
      `Refinement leg: ${sourceName}`,
    );
    // A probability may be a percentage, so it is a text input.
    const probability = screen.getByLabelText('Probability') as HTMLInputElement;
    expect(probability.type).toBe('text');
    expect(probability.value).toBe('20.00%');
    fireEvent.change(probability, { target: { value: '.35' } });
    fireEvent.blur(probability);
    expect(store.getModel().links.get(leg.id)?.customProperties).toEqual({
      Probability: '.35',
      Note: 'n',
    });
    expect(store.getModel().elements.get(hub.id)?.customProperties).not.toHaveProperty(
      'Probability',
    );
  });

  test("without a schema, the leg's properties are still listed", () => {
    selectLeg([properties]);
    // The free-form editor, not a typed field.
    expect(screen.getByLabelText('Probability').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Remove property Probability')).toBeTruthy();
    expect(screen.getByLabelText('Remove property Note')).toBeTruthy();
  });
});

describe('reference properties', () => {
  test("offer the model's elements of the allowed kinds, by name", () => {
    const anchor = defineProperties('kaos.RefinementLinkHub', {
      Context: prop.reference({ kinds: ['kaos.Softgoal'], optional: true }),
    });
    const store = createModelStore(parsePistar(kaosWelcome, { metamodel: KAOS }));
    const hub = [...store.getModel().elements.values()].find(
      (e) => e.kind === 'kaos.RefinementLinkHub',
    )!;
    store.updateElement(hub.id, { customProperties: { Context: 'nowhere' } });
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
        extensions={[
          { name: 'anchor', elements: { 'kaos.RefinementLinkHub': { properties: anchor } } },
        ]}
      >
        <Grab />
        <IstarInspector />
      </IstarProvider>,
    );
    act(() => editor!.select({ type: 'element', id: hub.id }));
    const select = screen.getByLabelText('Context') as HTMLSelectElement;
    const softgoals = [...store.getModel().elements.values()]
      .filter((e) => e.kind === 'kaos.Softgoal')
      .map((e) => e.name)
      .toSorted((a, b) => a.localeCompare(b));
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '—',
      ...softgoals,
      'nowhere (missing)',
    ]);
    const target = [...store.getModel().elements.values()].find((e) => e.kind === 'kaos.Softgoal')!;
    fireEvent.change(select, { target: { value: target.id } });
    expect(store.getModel().elements.get(hub.id)?.customProperties).toEqual({
      Context: target.id,
    });
  });
});
