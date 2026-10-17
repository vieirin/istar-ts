// One test per branch of DSM3-goals' `language_nfr_constraints.js`, by constraint code. Its
// "must be an element" branches are the cases where a link id is the source or the target.
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
  const connect = (s: IstarElement<string>, t: { id: string }, kind: NfrLinkKind) => {
    const result = store.connect({ kind, source: s.id, target: t.id });
    if (!result.ok) throw new Error(`setup: ${result.reason}`);
    return result.link;
  };
  const checkTo = (s: IstarElement<string>, t: { id: string }, kind: NfrLinkKind) =>
    canLink(store.getModel(), s.id, t.id, kind);
  const checkFrom = (s: { id: string }, t: IstarElement<string>, kind: NfrLinkKind) =>
    canLink(store.getModel(), s.id, t.id, kind);
  return { store, add, check, checkFrom, checkTo, connect };
}

const SOFTGOAL_LINKS = [
  ['nfr.AndRefinementLink', 'you cannot refine an Operationalization with a NFR'],
  ['nfr.OrRefinementLink', 'you cannot refine an Operationalization with a NFR'],
  ['nfr.ContributionLink', 'you cannot have a NFR contributing to an Operationalization'],
  ['nfr.CorrelationLink', 'you cannot have an Operationalization as the target of a Correlation'],
] as const;

describe.each(SOFTGOAL_LINKS)('%s.isValid', (kind, nfrToOperationalization) => {
  it('!source.isElement(): a link is no source', () => {
    const { add, checkFrom, contribution } = withContribution();
    expect(checkFrom(contribution, add('nfr.NFR'), kind)).toMatchObject({
      ok: false,
      code: 'unknown-element',
    });
  });

  it('!target.isElement(): a link is no target', () => {
    const { add, checkTo, contribution } = withContribution();
    expect(checkTo(add('nfr.Operationalization'), contribution, kind)).toMatchObject({
      ok: false,
      code: 'invalid-target',
    });
  });

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

/** A model with one contribution, for links whose source or target is a link. */
function withContribution() {
  const t = setup();
  const contribution = t.connect(
    t.add('nfr.Operationalization'),
    t.add('nfr.NFR'),
    'nfr.ContributionLink',
  );
  return { ...t, contribution };
}

describe('ArgumentLink.isValid', () => {
  it('a link is no source', () => {
    const { add, connect, contribution, store } = withContribution();
    const other = connect(add('nfr.Operationalization'), add('nfr.NFR'), 'nfr.ContributionLink');
    expect(canLink(store.getModel(), contribution.id, other.id, 'nfr.ArgumentLink')).toMatchObject({
      ok: false,
      code: 'unknown-element',
    });
  });

  it('argues about a link from a Claim', () => {
    const { add, checkTo, contribution } = withContribution();
    expect(checkTo(add('nfr.Claim'), contribution, 'nfr.ArgumentLink')).toEqual({ ok: true });
  });

  it('needs a Claim as its source', () => {
    const { add, checkTo, contribution } = withContribution();
    for (const kind of ['nfr.NFR', 'nfr.Operationalization'] as const) {
      expect(checkTo(add(kind), contribution, 'nfr.ArgumentLink')).toMatchObject({
        ok: false,
        code: 'invalid-source',
      });
    }
  });

  it('needs a link as its target, not an element (nor the Claim itself)', () => {
    const { add, check } = withContribution();
    const claim = add('nfr.Claim');
    expect(check(claim, add('nfr.NFR'), 'nfr.ArgumentLink')).toMatchObject({
      ok: false,
      code: 'invalid-target',
    });
    expect(check(claim, claim, 'nfr.ArgumentLink')).toMatchObject({ ok: false });
  });

  it('allows one argument between the same Claim and link', () => {
    const { add, checkTo, connect, contribution } = withContribution();
    const claim = add('nfr.Claim');
    connect(claim, contribution, 'nfr.ArgumentLink');
    expect(checkTo(claim, contribution, 'nfr.ArgumentLink')).toMatchObject({
      ok: false,
      code: 'duplicate-link',
    });
    expect(checkTo(add('nfr.Claim'), contribution, 'nfr.ArgumentLink')).toEqual({ ok: true });
  });
});
