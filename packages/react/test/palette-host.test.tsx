// #202: a host-provided dispatcher (built with `createActionDispatcher`, not the provider's own)
// answers `requestContextActions` from `ActionDispatcherOptions.palette`, read once at creation.
// Without a `palette` option that defaulted to iStar 2.0's `DEFAULT_PALETTE`, so a dispatcher
// over a model of another metamodel (KAOS, NFR, …) answered with no element tools at all.
import type { AnyMetamodel, ModelStore } from '@istar-ts/core';
import { createModelStore, extendMetamodel } from '@istar-ts/core';
import { createActionDispatcher } from '@istar-ts/actions';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import { NFR } from '../../core/test/dsm3-roots';
import type { IstarEditor, IstarExtension } from '../src';
import { IstarCanvas, IstarProvider, useIstarEditor } from '../src';

/** A store over a root metamodel (NFR here), typed loosely like the editor itself: kinds are
 * plain strings internally, looked up in the metamodel (see `context.tsx`). */
function storeOf(metamodel: AnyMetamodel): ModelStore {
  return createModelStore(undefined, { metamodel }) as unknown as ModelStore;
}

function Grab({ onEditor }: { onEditor: (editor: IstarEditor) => void }): null {
  const editor = useIstarEditor();
  useEffect(() => {
    onEditor(editor);
  });
  return null;
}

describe('a host-provided dispatcher follows the model metamodel for its palette (#202)', () => {
  test('an NFR model gets NFR tools, not iStar 2.0’s (or none)', async () => {
    const store = storeOf(NFR as unknown as AnyMetamodel);
    const dispatcher = createActionDispatcher(store);
    let editor: IstarEditor | undefined;
    await act(async () => {
      render(
        <IstarProvider store={store} dispatcher={dispatcher}>
          <IstarCanvas />
          <Grab onEditor={(e) => (editor = e)} />
        </IstarProvider>,
      );
    });
    const ids = editor?.contextActions?.map((a) => a.id) ?? [];
    expect(ids).toContain('nfr.NFR');
    expect(ids).toContain('nfr.Operationalization');
    // Nothing from iStar 2.0 (not in NFR's metamodel).
    expect(ids.some((id) => (id ?? '').startsWith('istar.'))).toBe(false);
  });

  test('a palette function option is read per request, not once at creation', async () => {
    const store = storeOf(NFR as unknown as AnyMetamodel);
    let label = 'First';
    const dispatcher = createActionDispatcher(store, {
      palette: () => ({
        elements: { 'nfr.NFR': { label }, 'nfr.Operationalization': false, 'nfr.Claim': false },
        links: {},
        groups: {},
      }),
    });
    let editor: IstarEditor | undefined;
    const { rerender } = render(
      <IstarProvider store={store} dispatcher={dispatcher} extensions={[]}>
        <IstarCanvas />
        <Grab onEditor={(e) => (editor = e)} />
      </IstarProvider>,
    );
    await act(async () => {});
    expect(editor?.contextActions?.find((a) => a.id === 'nfr.NFR')?.label).toBe('First');
    label = 'Second';
    // A change that re-triggers the provider's hints/palette effect (here, the model itself
    // changing isn't needed: the dispatcher is re-asked whenever `registry` changes too).
    await act(async () => {
      rerender(
        <IstarProvider store={store} dispatcher={dispatcher} extensions={[{ name: 'noop' }]}>
          <IstarCanvas />
          <Grab onEditor={(e) => (editor = e)} />
        </IstarProvider>,
      );
    });
    expect(editor?.contextActions?.find((a) => a.id === 'nfr.NFR')?.label).toBe('Second');
  });
});

describe('the provider’s own dispatcher refreshes its palette when extensions change (#202)', () => {
  const thing = extendMetamodel(NFR, {
    name: 'thing',
    elements: [{ kind: 'nfr2.Thing', category: 'node' }],
    links: [],
  });

  test('swapping extensions refreshes the palette without a new dispatcher or metamodel', async () => {
    const store = storeOf(thing as unknown as AnyMetamodel);
    let editor: IstarEditor | undefined;
    const noExtensions: readonly IstarExtension[] = [];
    const { rerender } = render(
      <IstarProvider store={store} extensions={noExtensions}>
        <IstarCanvas />
        <Grab onEditor={(e) => (editor = e)} />
      </IstarProvider>,
    );
    await act(async () => {});
    // The registry's own fallback entry for the extended kind (registryForMetamodel), its label.
    expect(editor?.contextActions?.find((a) => a.id === 'nfr2.Thing')?.label).toBe('Thing');

    const withPalette: readonly IstarExtension[] = [
      {
        name: 'thing-palette',
        palette: { elements: { 'nfr2.Thing': { label: 'Custom Thing' } }, links: {}, groups: {} },
      },
    ];
    await act(async () => {
      rerender(
        <IstarProvider store={store} extensions={withPalette}>
          <IstarCanvas />
          <Grab onEditor={(e) => (editor = e)} />
        </IstarProvider>,
      );
    });
    expect(editor?.contextActions?.find((a) => a.id === 'nfr2.Thing')?.label).toBe('Custom Thing');
  });
});
