import { describe, expect, expectTypeOf, test } from 'vitest';
import type { IstarElement, IstarLink, LinkRuleContext } from '../src';
import {
  MetamodelError,
  createModelStore,
  defineMetamodel,
  disconnect,
  isLinkRef,
  linkTargetOf,
  linksOf,
  parsePistar,
  removeElement,
  targetsLinks,
  validateModel,
} from '../src';
import { NFR } from './dsm3-roots';

/** A root whose second link kind has the given selectors, built lazily for `toThrow`. */
function declare(sources: string[], targets: string[]): () => unknown {
  return () =>
    defineMetamodel({
      name: 'n',
      prefix: 'n',
      elements: [{ kind: 'n.Node', category: 'node' }],
      links: [
        { kind: 'n.Plain', rules: { sources: ['node'], targets: ['node'] } },
        { kind: 'n.Note', rules: { sources, targets } },
      ],
    });
}

function nfrModel() {
  const store = createModelStore(undefined, { metamodel: NFR });
  const soft = store.addElement({ kind: 'nfr.NFR', x: 0, y: 0 });
  const op = store.addElement({ kind: 'nfr.Operationalization', x: 0, y: 100 });
  const claim = store.addElement({ kind: 'nfr.Claim', x: 200, y: 0 });
  const contribution = store.connect({
    kind: 'nfr.ContributionLink',
    source: op.id,
    target: soft.id,
    label: '+',
  });
  if (!contribution.ok) throw new Error(contribution.reason);
  return { store, soft, op, claim, contribution: contribution.link };
}

describe('links that target links', () => {
  test('connect a Claim to a Contribution link', () => {
    const { store, claim, contribution } = nfrModel();
    expect(store.canLink(claim, contribution, 'nfr.ArgumentLink')).toEqual({ ok: true });
    const argument = store.connect({
      kind: 'nfr.ArgumentLink',
      source: claim.id,
      target: contribution.id,
    });
    expect(argument.ok).toBe(true);
    if (!argument.ok) return;
    const model = store.getModel();
    expect(linkTargetOf(model, argument.link)).toBe(model.links.get(contribution.id));
    expect(linksOf(model, contribution.id).map((l) => l.id)).toEqual([argument.link.id]);
    expect(validateModel(model)).toEqual([]);
    // One per pair (unique 'kind').
    expect(store.canLink(claim, contribution.id, 'nfr.ArgumentLink')).toMatchObject({
      ok: false,
      code: 'duplicate-link',
    });
  });

  test('element selectors never match links, and link selectors never match elements', () => {
    const { store, soft, op, claim, contribution } = nfrModel();
    expect(store.canLink(claim, soft, 'nfr.ArgumentLink')).toEqual({
      ok: false,
      code: 'invalid-target',
      reason: 'the target of an Argument link must be a link',
      end: 'target',
    });
    expect(store.canLink(op, contribution, 'nfr.AndRefinementLink')).toMatchObject({
      ok: false,
      code: 'invalid-target',
    });
  });

  test('a link kind as a target selector matches that kind and what behaves like it', () => {
    const m = defineMetamodel({
      name: 'n',
      prefix: 'n',
      elements: [{ kind: 'n.Node', category: 'node' }],
      links: [
        { kind: 'n.Plain', rules: { sources: ['node'], targets: ['node'], sameActor: false } },
        { kind: 'n.Alias', behavesLike: 'n.Plain' },
        { kind: 'n.Other', rules: { sources: ['node'], targets: ['node'], sameActor: false } },
        { kind: 'n.Note', rules: { sources: ['node'], targets: ['n.Plain'], sameActor: false } },
      ],
    });
    expect(targetsLinks(m, 'n.Note')).toBe(true);
    expect(targetsLinks(m, 'n.Plain')).toBe(false);
    const store = createModelStore(undefined, { metamodel: m });
    const [a, b, c] = [0, 1, 2].map((i) => store.addElement({ kind: 'n.Node', x: i, y: 0 }));
    const link = (kind: 'n.Plain' | 'n.Alias' | 'n.Other', s: string, t: string): string => {
      const r = store.connect({ kind, source: s, target: t });
      if (!r.ok) throw new Error(r.reason);
      return r.link.id;
    };
    const plain = link('n.Plain', a!.id, b!.id);
    const alias = link('n.Alias', b!.id, c!.id);
    const other = link('n.Other', a!.id, c!.id);
    expect(store.canLink(c!, plain, 'n.Note').ok).toBe(true);
    expect(store.canLink(a!, alias, 'n.Note').ok).toBe(true);
    expect(store.canLink(b!, other, 'n.Note')).toMatchObject({
      ok: false,
      reason: 'the target of a Note link must be a Plain link',
    });
  });

  test("iStar 2.0's built-in rules only take element targets", () => {
    const store = createModelStore();
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const [g1, g2, g3] = [0, 1, 2].map((i) =>
      store.addElement({ kind: 'istar.Goal', x: i, y: 0, parent: actor.id }),
    );
    const r = store.connect({ kind: 'istar.AndRefinementLink', source: g1!.id, target: g2!.id });
    if (!r.ok) throw new Error(r.reason);
    expect(store.canLink(g3!, r.link, 'istar.OrRefinementLink')).toEqual({
      ok: false,
      code: 'invalid-target',
      reason: 'the target of an Or-Refinement link must be an element, not a link',
      end: 'target',
    });
  });

  test('check predicates see the target link', () => {
    const seen: (IstarElement<string> | IstarLink<string>)[] = [];
    const m = defineMetamodel({
      name: 'n',
      prefix: 'n',
      elements: [{ kind: 'n.Node', category: 'node' }],
      links: [
        { kind: 'n.Plain', rules: { sources: ['node'], targets: ['node'], sameActor: false } },
        {
          kind: 'n.Note',
          rules: { sources: ['node'], targets: ['link'], sameActor: false },
          check: (context: LinkRuleContext) => {
            seen.push(context.target);
            expectTypeOf(context.target).toEqualTypeOf<IstarElement<string> | IstarLink<string>>();
            return context.isThereLinkBetween(context.source, context.target)
              ? { ok: false, code: 'duplicate-link', reason: 'seen' }
              : { ok: true };
          },
        },
      ],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const a = store.addElement({ kind: 'n.Node', x: 0, y: 0 });
    const b = store.addElement({ kind: 'n.Node', x: 0, y: 0 });
    const plain = store.connect({ kind: 'n.Plain', source: a.id, target: b.id });
    if (!plain.ok) throw new Error(plain.reason);
    expect(store.canLink(a, plain.link.id, 'n.Note').ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(isLinkRef(seen[0]!)).toBe(true);
    expect(isLinkRef(a)).toBe(false);
  });

  test('validateModel checks links that target links last, whatever their order', () => {
    const json = {
      orphans: [
        { id: 'n', text: 'N', type: 'nfr.NFR', x: 0, y: 0 },
        { id: 'o', text: 'O', type: 'nfr.Operationalization', x: 0, y: 0 },
        { id: 'c', text: 'C', type: 'nfr.Claim', x: 0, y: 0 },
      ],
      links: [
        { id: 'arg', type: 'nfr.ArgumentLink', source: 'c', target: 'contrib' },
        { id: 'contrib', type: 'nfr.ContributionLink', source: 'o', target: 'n', label: '+' },
        { id: 'lost', type: 'nfr.ArgumentLink', source: 'c', target: 'nowhere' },
      ],
    };
    const model = parsePistar(json, { metamodel: NFR });
    expect(validateModel(model)).toEqual([
      {
        linkId: 'lost',
        kind: 'nfr.ArgumentLink',
        source: 'c',
        target: 'nowhere',
        code: 'unknown-element',
        message: 'the link refers to an element that does not exist',
      },
    ]);
  });

  test('removing a link or its endpoint removes the links that target it', () => {
    const { store, op, claim, contribution } = nfrModel();
    const argument = store.connect({
      kind: 'nfr.ArgumentLink',
      source: claim.id,
      target: contribution.id,
    });
    if (!argument.ok) throw new Error(argument.reason);
    const model = store.getModel();
    expect([...disconnect(model, contribution.id).links.keys()]).toEqual([]);
    expect([...removeElement(model, op.id).links.keys()]).toEqual([]);
    // Removing the argument keeps its target.
    expect([...disconnect(model, argument.link.id).links.keys()]).toEqual([contribution.id]);
  });

  test('connect with force accepts a link target', () => {
    const { store, claim, contribution } = nfrModel();
    expect(
      store.connect(
        { kind: 'nfr.ArgumentLink', source: claim.id, target: contribution.id },
        { force: true },
      ).ok,
    ).toBe(true);
  });

  test('only targets may name links', () => {
    expect(declare(['node'], ['link'])).not.toThrow();
    expect(declare(['node'], ['n.Plain', 'n.Note'])).not.toThrow();
    expect(declare(['link'], ['node'])).toThrow(MetamodelError);
    expect(declare(['n.Plain'], ['node'])).toThrow(
      'metamodel "n": sources of "n.Note" names unknown element kind "n.Plain"',
    );
    expect(declare(['node'], ['n.Later'])).toThrow(
      'metamodel "n": targets of "n.Note" names unknown element kind "n.Later"',
    );
  });
});
