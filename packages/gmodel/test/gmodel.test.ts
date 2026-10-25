import { describe, expect, test } from 'vitest';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import {
  ISTAR_2_0,
  LINK_SELECTOR,
  createModelStore,
  defineMetamodel,
  defineMetamodelExtension,
  extendMetamodel,
  metamodelOf,
} from '@istar-ts/core';
import type { GModelChildSchema, GModelElementSchema, GNodeSchema } from '../src';
import {
  GRAPH_ID,
  LINK_ANCHOR_TYPE,
  gmodelTypes,
  isGEdgeSchema,
  isGLabelSchema,
  isGNodeSchema,
  labelId,
  linkAnchorId,
  modelToGModelSchema,
} from '../src';
import { loadFixtures } from './fixtures';

function all(root: GModelElementSchema): GModelChildSchema[] {
  return root.children.flatMap((child) => [child, ...all(child)]);
}

function byId(root: GModelElementSchema, id: string): GModelChildSchema {
  const found = all(root).find((e) => e.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

const fixtures = loadFixtures();

describe('every fixture', () => {
  test.each(fixtures.map((f) => [f.name, f.model] as const))('%s', (_, model) => {
    const root = modelToGModelSchema(model);
    expect(root).toMatchObject({ id: GRAPH_ID, type: 'graph' });
    // Plain JSON: what goes on the wire is the schema itself.
    expect(JSON.parse(JSON.stringify(root))).toStrictEqual(root);
    const elements = all(root);
    const ids = new Set(elements.map((e) => e.id));
    expect(ids.size).toBe(elements.length);
    const types = gmodelTypes(metamodelOf(model) as AnyMetamodel);
    for (const e of elements) expect(types.all).toContain(e.type);
    const sourceOf = (e: GModelChildSchema) => model.elements.get(e.id) ?? model.links.get(e.id);
    // Labels and anchors stand for no element, and carry none of one's fields.
    for (const e of elements.filter((e) => !sourceOf(e))) {
      expect(isGLabelSchema(e) || e.type === LINK_ANCHOR_TYPE).toBe(true);
      expect('args' in e).toBe(false);
    }
    for (const e of elements.filter((e) => sourceOf(e))) {
      const source = sourceOf(e)!;
      expect(model.elements.has(e.id) ? isGNodeSchema(e) : isGEdgeSchema(e)).toBe(true);
      const args = (e as GNodeSchema).args!;
      // The kind, verbatim; the custom properties, `display` and unknown keys, as in the file.
      expect(args.kind).toBe(source.kind);
      expect(types.kindOf(e.type)).toBe(source.kind);
      expect(args.customProperties).toStrictEqual(source.customProperties);
      expect(args.display).toStrictEqual(source.display);
      expect(args.extra).toStrictEqual(source.extra);
    }
    for (const edge of elements.filter(isGEdgeSchema)) {
      expect(ids).toContain(edge.sourceId);
      expect(ids).toContain(edge.targetId);
    }
  });
});

/** A dialect istar-ts has never heard of: teams of ideas, and notes on the links between them. */
const BRAINSTORM = defineMetamodel({
  name: 'brainstorm',
  prefix: 'bs',
  elements: [
    { kind: 'bs.Team', category: 'actor', size: { width: 150, height: 120 } },
    { kind: 'bs.Idea', category: 'node', size: { width: 70, height: 30 } },
    { kind: 'bs.Note', category: 'node', size: { width: 40, height: 40 } },
  ],
  links: [
    { kind: 'bs.SupportsLink', rules: { sources: ['bs.Idea'], targets: ['bs.Idea'] } },
    { kind: 'bs.CommentLink', rules: { sources: ['bs.Note'], targets: [LINK_SELECTOR] } },
  ],
});

function brainstorm() {
  const store = createModelStore(undefined, { metamodel: BRAINSTORM });
  const team = store.addElement({ kind: 'bs.Team', x: 100, y: 100, name: 'Team' });
  const first = store.addElement({
    kind: 'bs.Idea',
    x: 130,
    y: 150,
    parent: team.id,
    customProperties: { votes: '3', 'never-heard-of': 'kept' },
  });
  const second = store.addElement({
    kind: 'bs.Idea',
    x: 330,
    y: 150,
    parent: team.id,
    display: { backgroundColor: '#fafafa', width: 90 },
  });
  const note = store.addElement({ kind: 'bs.Note', x: 230, y: 400 });
  const supports = store.connect({
    kind: 'bs.SupportsLink',
    source: first.id,
    target: second.id,
    customProperties: { strength: 'high' },
  });
  if (!supports.ok) throw new Error(supports.reason);
  const comment = store.connect({
    kind: 'bs.CommentLink',
    source: note.id,
    target: supports.link.id,
  });
  if (!comment.ok) throw new Error(comment.reason);
  return {
    model: store.getModel() as unknown as AnyIstarModel,
    team,
    first,
    second,
    note,
    supports: supports.link,
    comment: comment.link,
  };
}

describe('any metamodel, through the same code', () => {
  test('a root metamodel of its own', () => {
    const { model, team, first, second, note, supports, comment } = brainstorm();
    const root = modelToGModelSchema(model);

    // The actor is a container at its boundary's corner, its elements relative to it.
    const teamNode = byId(root, team.id) as GNodeSchema;
    expect(teamNode).toMatchObject({ type: 'node:bs.Team', args: { kind: 'bs.Team' } });
    const firstNode = byId(root, first.id) as GNodeSchema;
    expect(teamNode.children).toContain(firstNode);
    expect(firstNode.position).toEqual({
      x: first.x - teamNode.position.x,
      y: first.y - teamNode.position.y,
    });
    // Sizes: the kind's, or the element's own display size.
    expect(firstNode.size).toEqual({ width: 70, height: 30 });
    expect((byId(root, second.id) as GNodeSchema).size).toEqual({ width: 90, height: 30 });
    expect((byId(root, note.id) as GNodeSchema).size).toEqual({ width: 40, height: 40 });
    expect(byId(root, labelId(note.id))).toMatchObject({ type: 'label', text: note.name });

    // Custom properties and display, verbatim, unknown keys included.
    expect(firstNode.args).toEqual({
      kind: 'bs.Idea',
      customProperties: { votes: '3', 'never-heard-of': 'kept' },
    });
    expect((byId(root, second.id) as GNodeSchema).args?.display).toEqual({
      backgroundColor: '#fafafa',
      width: 90,
    });

    // A link kind that links may target has an anchor; the comment ends on it.
    expect(byId(root, supports.id)).toMatchObject({
      type: 'edge:bs.SupportsLink',
      sourceId: first.id,
      targetId: second.id,
      args: { kind: 'bs.SupportsLink', customProperties: { strength: 'high' } },
    });
    expect(byId(root, linkAnchorId(supports.id))).toMatchObject({ type: LINK_ANCHOR_TYPE });
    expect(byId(root, comment.id)).toMatchObject({
      type: 'edge:bs.CommentLink',
      sourceId: note.id,
      targetId: linkAnchorId(supports.id),
      args: { kind: 'bs.CommentLink' },
    });
  });

  test('a type override changes how a kind is drawn, never its kind', () => {
    const { model, first } = brainstorm();
    const root = modelToGModelSchema(model, {
      types: { 'bs.Idea': 'node:bubble' },
      sizes: { 'bs.Idea': { width: 50, height: 50 } },
    });
    expect(byId(root, first.id)).toMatchObject({
      type: 'node:bubble',
      size: { width: 50, height: 50 },
      args: { kind: 'bs.Idea' },
    });
  });

  test('an extended metamodel', () => {
    const WIDGETS = extendMetamodel(
      ISTAR_2_0,
      defineMetamodelExtension({
        name: 'widgets',
        elements: [{ kind: 'widgets.Widget', category: 'node', size: { width: 64, height: 32 } }],
      }),
    );
    const store = createModelStore(undefined, { metamodel: WIDGETS });
    const actor = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const widget = store.addElement({
      kind: 'widgets.Widget',
      x: 40,
      y: 50,
      parent: actor.id,
      customProperties: { colour: 'teal' },
    });
    const root = modelToGModelSchema(store.getModel());
    expect(byId(root, widget.id)).toMatchObject({
      type: 'node:widgets.Widget',
      size: { width: 64, height: 32 },
      args: { kind: 'widgets.Widget', customProperties: { colour: 'teal' } },
    });
    expect((byId(root, actor.id) as GNodeSchema).children.map((c) => c.id)).toContain(widget.id);
  });
});
