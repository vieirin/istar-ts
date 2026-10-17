// One test per branch of DSM3-goals' `language_nfr_constraints.js` that core can express today.
// ArgumentLink.isValid (a Claim towards a link) arrives with core's link-valued targets.
import { canLink, createEmptyModel, createModelStore } from '@istar-ts/core';
import type { IstarElement } from '@istar-ts/core';
import { describe, expect, it } from 'vitest';
import { NFR } from '../src';
import type { NfrElementKind, NfrLinkKind } from '../src';

function setup() {
  const store = createModelStore(createEmptyModel(undefined, { metamodel: NFR }));
  let y = 0;
  const add = (kind: NfrElementKind): IstarElement<NfrElementKind> =>
    store.addElement({ kind, x: 0, y: (y += 80) });
  const check = (s: IstarElement<string>, t: IstarElement<string>, kind: NfrLinkKind) =>
    canLink(store.getModel(), s.id, t.id, kind);
  const connect = (s: IstarElement<string>, t: IstarElement<string>, kind: NfrLinkKind) => {
    const result = store.connect({ kind, source: s.id, target: t.id });
    if (!result.ok) throw new Error(`setup: ${result.reason}`);
  };
  return { add, check, connect };
}

const SOFTGOAL_LINKS = [
  ['nfr.AndRefinementLink', 'you cannot refine an Operationalization with a NFR'],
  ['nfr.OrRefinementLink', 'you cannot refine an Operationalization with a NFR'],
  ['nfr.ContributionLink', 'you cannot have a NFR contributing to an Operationalization'],
  ['nfr.CorrelationLink', 'you cannot have an Operationalization as the target of a Correlation'],
] as const;

describe.each(SOFTGOAL_LINKS)('%s.isValid', (kind, nfrToOperationalization) => {
  it('rejects a link from an element onto itself', () => {
    const { add, check } = setup();
    const nfr = add('nfr.NFR');
    expect(check(nfr, nfr, kind)).toMatchObject({ ok: false, code: 'self-link' });
  });

  it('rejects an NFR softgoal towards an Operationalization, with DSM3’s message', () => {
    const { add, check } = setup();
    expect(check(add('nfr.NFR'), add('nfr.Operationalization'), kind)).toEqual({
      ok: false,
      code: 'invalid-target',
      reason: nfrToOperationalization,
    });
  });

  it('accepts softgoals and operationalizations otherwise', () => {
    const { add, check } = setup();
    expect(check(add('nfr.Operationalization'), add('nfr.NFR'), kind)).toEqual({ ok: true });
    expect(check(add('nfr.NFR'), add('nfr.NFR'), kind)).toEqual({ ok: true });
    expect(check(add('nfr.Operationalization'), add('nfr.Operationalization'), kind)).toEqual({
      ok: true,
    });
  });

  it('leaves Claims out, as source or target', () => {
    const { add, check } = setup();
    const nfr = add('nfr.NFR');
    expect(check(add('nfr.Claim'), nfr, kind)).toMatchObject({ ok: false, code: 'invalid-source' });
    expect(check(nfr, add('nfr.Claim'), kind)).toMatchObject({ ok: false, code: 'invalid-target' });
  });
});

describe('one link per pair', () => {
  it.each(['nfr.AndRefinementLink', 'nfr.OrRefinementLink', 'nfr.ContributionLink'] as const)(
    '%s allows one link between the same two elements',
    (kind) => {
      const { add, check, connect } = setup();
      const a = add('nfr.Operationalization');
      const b = add('nfr.NFR');
      connect(a, b, kind);
      expect(check(a, b, kind)).toMatchObject({ ok: false, code: 'duplicate-link' });
    },
  );

  it('CorrelationLink has no such limit in DSM3', () => {
    const { add, check, connect } = setup();
    const a = add('nfr.Operationalization');
    const b = add('nfr.NFR');
    connect(a, b, 'nfr.CorrelationLink');
    expect(check(a, b, 'nfr.CorrelationLink')).toEqual({ ok: true });
  });
});
