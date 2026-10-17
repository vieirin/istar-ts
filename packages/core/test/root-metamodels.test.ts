import { describe, expect, expectTypeOf, test } from 'vitest';
import type { ElementKindOf, LinkKindOf, Metamodel, RootMetamodelDeclaration } from '../src';
import {
  ISTAR_2_0,
  ISTAR_2_0_DECLARATION,
  LINK_KIND_INFO,
  MetamodelError,
  NODE_KIND_INFO,
  PISTAR_TOOL,
  ISTAR_VERSION,
  canLink,
  createModelStore,
  defineMetamodel,
  extendMetamodel,
} from '../src';

/** A small KAOS-like root, enough to exercise the builder (the real one ships in PR4). */
const KAOS = defineMetamodel({
  name: 'kaos',
  prefix: 'kaos',
  elements: [
    { kind: 'kaos.Goal', category: 'node', size: { width: 135, height: 36 } },
    { kind: 'kaos.Softgoal', behavesLike: 'kaos.Goal' },
    {
      kind: 'kaos.Agent',
      category: 'node',
      info: { canBeInnerElement: false, canBeDependum: false },
    },
  ],
  links: [
    {
      kind: 'kaos.Conflict',
      rules: { sources: ['node'], targets: ['node'], sameActor: false },
    },
    {
      kind: 'kaos.ResponsibilityAssignment',
      rules: { sources: ['kaos.Agent'], targets: ['node'], sameActor: false },
    },
  ],
  file: { tool: 'dsm3-goals', extra: { metamodelVersion: '1.0' } },
});

/** A root named "r" with the given parts, built lazily so `expect(...).toThrow` can catch it. */
function root(over: Partial<RootMetamodelDeclaration>): () => Metamodel<string, string> {
  return () => defineMetamodel({ name: 'r', prefix: 'r', elements: [], links: [], ...over });
}

describe('defineMetamodel', () => {
  test('ISTAR_2_0 is defineMetamodel(ISTAR_2_0_DECLARATION)', () => {
    const again = defineMetamodel(ISTAR_2_0_DECLARATION);
    expect(again).toEqual(ISTAR_2_0);
    expectTypeOf(again).toEqualTypeOf<Metamodel>();
    expect(ISTAR_2_0).toMatchObject({
      name: 'istar-2.0',
      framework: 'istar-2.0',
      prefix: 'istar',
      file: { tool: PISTAR_TOOL, istar: ISTAR_VERSION },
      extensions: [],
    });
  });

  test("iStar 2.0's info objects keep their identity", () => {
    for (const [kind, info] of Object.entries(NODE_KIND_INFO)) {
      expect(ISTAR_2_0.elements.get(kind as never)?.info).toBe(info);
    }
    for (const [kind, info] of Object.entries(LINK_KIND_INFO)) {
      expect(ISTAR_2_0.links.get(kind as never)?.info).toBe(info);
    }
  });

  test('builds a root of its own, typed with its kinds', () => {
    expect(KAOS).toMatchObject({
      name: 'kaos',
      framework: 'kaos',
      prefix: 'kaos',
      file: { tool: 'dsm3-goals', extra: { metamodelVersion: '1.0' } },
      extensions: [],
    });
    expect([...KAOS.elements.keys()]).toEqual(['kaos.Goal', 'kaos.Softgoal', 'kaos.Agent']);
    expect([...KAOS.links.keys()]).toEqual(['kaos.Conflict', 'kaos.ResponsibilityAssignment']);
    expect(KAOS.elementsByPistarType.get('kaos.Goal')).toBe('kaos.Goal');
    expectTypeOf<ElementKindOf<typeof KAOS>>().toEqualTypeOf<
      'kaos.Goal' | 'kaos.Softgoal' | 'kaos.Agent'
    >();
    expectTypeOf<LinkKindOf<typeof KAOS>>().toEqualTypeOf<
      'kaos.Conflict' | 'kaos.ResponsibilityAssignment'
    >();
  });

  test("a root's kinds belong to no extension and default to DSM3's node info", () => {
    const goal = KAOS.elements.get('kaos.Goal')!;
    expect(goal.extension).toBeUndefined();
    expect(goal.label).toBe('Goal');
    expect(goal.info).toEqual({ canBeInnerElement: true, canBeDependum: true, canBeOnPaper: true });
    expect(KAOS.elements.get('kaos.Agent')?.info).toEqual({
      canBeInnerElement: false,
      canBeDependum: false,
      canBeOnPaper: true,
    });
    expect(KAOS.links.get('kaos.Conflict')?.extension).toBeUndefined();
  });

  test('behavesLike resolves against kinds declared earlier', () => {
    const softgoal = KAOS.elements.get('kaos.Softgoal')!;
    expect(softgoal).toMatchObject({
      behavesLike: 'kaos.Goal',
      category: 'node',
      size: { width: 135, height: 36 },
    });
    expect(() =>
      defineMetamodel({
        name: 'late',
        prefix: 'late',
        elements: [
          { kind: 'late.B', behavesLike: 'late.A' },
          { kind: 'late.A', category: 'node' },
        ],
        links: [],
      }),
    ).toThrow('metamodel "late": "late.B" behaves like unknown element kind "late.A"');
  });

  test("a root's link kind may give neither rules nor behavesLike, but not both", () => {
    const m = defineMetamodel({
      name: 'bare',
      prefix: 'bare',
      elements: [{ kind: 'bare.Node', category: 'node' }],
      links: [
        { kind: 'bare.Link', rules: { sources: ['node'], targets: ['node'] } },
        { kind: 'bare.Builtin' },
      ],
    });
    expect(m.links.get('bare.Builtin')?.rules).toBeUndefined();
    expect(() =>
      defineMetamodel({
        name: 'both',
        prefix: 'both',
        elements: [{ kind: 'both.Node', category: 'node' }],
        links: [
          { kind: 'both.A', rules: { sources: ['node'], targets: ['node'] } },
          {
            kind: 'both.B',
            behavesLike: 'both.A',
            rules: { sources: ['node'], targets: ['node'] },
          },
        ],
      }),
    ).toThrow('metamodel "both": link kind "both.B" needs at most one of behavesLike or rules');
    // Extensions keep needing exactly one.
    expect(() => extendMetamodel(KAOS, { name: 'ext', links: [{ kind: 'ext.Link' }] })).toThrow(
      'extension "ext": link kind "ext.Link" needs exactly one of behavesLike or rules',
    );
  });

  test('a link kind without rules checks nothing it has no built-in rules for', () => {
    const m = defineMetamodel({
      name: 'bare',
      prefix: 'bare',
      elements: [{ kind: 'bare.Node', category: 'node' }],
      links: [{ kind: 'bare.Builtin' }],
    });
    const store = createModelStore(undefined, { metamodel: m });
    const a = store.addElement({ kind: 'bare.Node', x: 0, y: 0 });
    const b = store.addElement({ kind: 'bare.Node', x: 0, y: 0 });
    expect(canLink(store.getModel(), a, b, 'bare.Builtin')).toMatchObject({
      ok: false,
      code: 'unknown-link-kind',
    });
  });

  test("a root's link rules work with canLink", () => {
    const store = createModelStore(undefined, { metamodel: KAOS });
    const goal = store.addElement({ kind: 'kaos.Goal', x: 0, y: 0 });
    const soft = store.addElement({ kind: 'kaos.Softgoal', x: 200, y: 0 });
    const agent = store.addElement({ kind: 'kaos.Agent', x: 0, y: 100 });
    const model = store.getModel();
    expect(canLink(model, goal, soft, 'kaos.Conflict').ok).toBe(true);
    expect(canLink(model, agent, goal, 'kaos.ResponsibilityAssignment').ok).toBe(true);
    expect(canLink(model, goal, agent, 'kaos.ResponsibilityAssignment').ok).toBe(false);
  });

  test('rejects malformed declarations with the extension errors', () => {
    expect(root({ name: '' })).toThrow('a root metamodel needs a name');
    expect(root({ prefix: 'r.x' })).toThrow(MetamodelError);
    expect(root({ prefix: '' })).toThrow(/prefix "" must be a name without dots/);
    expect(root({ elements: [{ kind: 'Goal', category: 'node' }] })).toThrow(
      'metamodel "r": element kind "Goal" must be namespaced, e.g. "r.Name"',
    );
    expect(
      root({
        elements: [
          { kind: 'r.Goal', category: 'node' },
          { kind: 'r.Goal', category: 'node' },
        ],
      }),
    ).toThrow('metamodel "r": kind "r.Goal" already exists');
    expect(
      root({ links: [{ kind: 'r.Link', rules: { sources: ['r.Nope'], targets: ['node'] } }] }),
    ).toThrow('metamodel "r": sources of "r.Link" names unknown element kind "r.Nope"');
    expect(
      root({
        links: [
          {
            kind: 'r.Dep',
            category: 'dependency',
            rules: { sources: ['node'], targets: ['node'] },
          },
        ],
      }),
    ).toThrow(/dependency link kind "r\.Dep" must behave like a dependency link/);
  });

  test('a root may use any namespace, including another root prefix', () => {
    const m = defineMetamodel({
      name: 'mixed',
      prefix: 'mixed',
      elements: [{ kind: 'istar.Goal', category: 'node' }],
      links: [],
    });
    expect(m.elements.has('istar.Goal')).toBe(true);
  });
});

describe('extendMetamodel on a root', () => {
  test('keeps framework, prefix and file', () => {
    const m = extendMetamodel(KAOS, {
      name: 'ops',
      elements: [{ kind: 'ops.Operation', category: 'node' }],
    });
    expect(m.name).toBe('kaos+ops');
    expect(m.framework).toBe('kaos');
    expect(m.prefix).toBe('kaos');
    expect(m.file).toBe(KAOS.file);
    expect(m.extensions).toEqual(['ops']);
    // Extensions keep piStar-ext's node defaults.
    expect(m.elements.get('ops.Operation')?.info?.canBeOnPaper).toBe(false);
    const twice = extendMetamodel(ISTAR_2_0, { name: 'a' });
    expect(twice).toMatchObject({ framework: 'istar-2.0', prefix: 'istar', file: ISTAR_2_0.file });
  });

  test("reserves the root's prefix, not istar's", () => {
    expect(() =>
      extendMetamodel(KAOS, { name: 'ops', elements: [{ kind: 'kaos.X', category: 'node' }] }),
    ).toThrow(
      'extension "ops": element kind "kaos.X" uses the reserved "kaos." prefix; ' +
        'name it "ops.X" and set pistarType: "kaos.X" to read files that use it',
    );
    const m = extendMetamodel(KAOS, {
      name: 'ops',
      elements: [{ kind: 'istar.Goal', category: 'node' }],
    });
    expect(m.elements.has('istar.Goal')).toBe(true);
  });
});
