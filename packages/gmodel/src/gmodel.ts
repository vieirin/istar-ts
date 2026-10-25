/**
 * `modelToGModelSchema`: the GModel (GLSP's notation model) of an istar-ts model, as plain schema
 * JSON. The piStar file holds both the semantic model and its layout, so the notation is derived
 * from the one model instead of kept beside it, a deliberate difference from the reference
 * architecture's separate source and representation models (Metin & Bork 2025, §4.1.3). There is
 * one representation per model, which `@istar-ts/glsp`'s server sends and any other client may
 * draw.
 *
 * Coordinates. The model's `x`/`y` are absolute, as in the piStar file. Top-level nodes and edge
 * routing points keep them. An actor is a container: its node's position is its boundary's
 * top-left corner, and its elements are its children, positioned relative to that corner
 * (`child.x - boundary.x`, `child.y - boundary.y`), as GLSP nests bounds. The boundary is core's
 * `actorBounds` (after piStar's `updateBoundary`); the React canvas renders this schema itself
 * (`@istar-ts/react`'s `gmodelToFlow`), so both clients draw the same boundary:
 * the kind's default size at the actor's `x`/`y`, grown to hold every element plus 10px padding.
 *
 * Sizes come from the element's `display` width/height (a resized element) or its kind's default
 * size in the metamodel, so the client needs no bounds round trip (`needsClientLayout: false`).
 *
 * Nothing here knows a dialect: kinds, categories, sizes and the kinds a link may target all come
 * from the model's metamodel (`metamodelOf`).
 */
import type {
  AnyIstarModel,
  AnyMetamodel,
  IstarElement,
  IstarLink,
  IstarModel,
  Point,
  Size,
} from '@istar-ts/core';
import { actorBounds, metamodelOf } from '@istar-ts/core';
import { typeHintsFor } from '@istar-ts/actions';
import type {
  GEdgePlacement,
  GEdgeSchema,
  GGraphSchema,
  GLabelSchema,
  GModelChildSchema,
  GModelElementArgs,
  GNodeSchema,
} from './schema';
import type { GModelSizeOverrides, GModelTypeOverrides } from './types';
import { GRAPH_TYPE, LABEL_TYPE, LINK_ANCHOR_TYPE, gmodelTypes } from './types';

/** A collapsed actor's box, as the React canvas draws it. */
export const COLLAPSED_ACTOR_SIZE: Size = { width: 60, height: 60 };
/**
 * Centre of the actor symbol circle, relative to the actor node's own box; matches
 * `@istar-ts/react`'s `ACTOR_SYMBOL_OFFSET` (`packages/react/src/layout.ts`) and the stock
 * client's own copy (`examples/glsp-client/src/istar-views.ts`'s `ACTOR_SYMBOL_OFFSET`).
 */
export const ACTOR_SYMBOL_OFFSET = 20;
/** CSS class centring an actor's name label on the symbol circle, independent of text width. */
export const ACTOR_LABEL_CSS_CLASS = 'istar-glsp-actor-label';
/** Side of the anchor node on the middle of a link that links may target. */
export const LINK_ANCHOR_SIZE = 12;
/** Id of the root `graph` element. */
export const GRAPH_ID = 'istar-graph';

/** Id of an element's or link's name label. */
export function labelId(id: string): string {
  return `${id}_label`;
}

/** Id of a link's value label (a contribution's `help`, `++`, …). */
export function valueLabelId(id: string): string {
  return `${id}_value`;
}

/** Id of the anchor node on the middle of link `linkId`. */
export function linkAnchorId(linkId: string): string {
  return `${linkId}_anchor`;
}

export interface ModelToGModelOptions {
  /** Kind → GModel type overrides (see `gmodelTypes`). */
  readonly types?: GModelTypeOverrides;
  /**
   * Kind → size overrides, for a host whose `@istar-ts/react` registry draws a kind at a size
   * other than the metamodel's own default (a contribution's `sizes`, #154). Falls back to the
   * metamodel's size for any kind not listed.
   */
  readonly sizes?: GModelSizeOverrides;
}

interface Box extends Point, Size {}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function label(
  id: string,
  text: string,
  place: Pick<GLabelSchema, 'position' | 'edgePlacement'>,
  cssClasses: string[] = [],
): GLabelSchema {
  return {
    id,
    type: LABEL_TYPE,
    text,
    alignment: { x: 0, y: 0 },
    ...place,
    cssClasses,
    children: [],
  };
}

/** What a node or edge carries of its element or link besides the graph: kind, properties, … */
function argsOf(
  source: IstarElement<string> | IstarLink<string>,
  position?: Point,
): GModelElementArgs {
  return {
    kind: source.kind,
    ...(source.customProperties ? { customProperties: source.customProperties } : {}),
    ...(source.display ? { display: source.display } : {}),
    ...(source.extra ? { extra: source.extra } : {}),
    ...(position ? { position } : {}),
  };
}

/** The point halfway along a polyline. */
function midpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (const [i, length] of lengths.entries()) {
    if (rest <= length && length > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + ((b.x - a.x) * rest) / length, y: a.y + ((b.y - a.y) * rest) / length };
    }
    rest -= length;
  }
  return points[0]!;
}

/**
 * The model's GModel, as schema JSON. Every element is a node and every link an edge, with the
 * element's or link's id; types follow `gmodelTypes`, and `args` (`GModelElementArgs`) carries
 * the kind verbatim, the custom properties, and the file's `display` and unknown keys.
 *
 * - Actors are containers holding their elements. A collapsed actor is a small node without
 *   children; like piStar, its elements' dependency links end on the actor and its elements'
 *   other links are hidden.
 * - Dependums are top-level nodes (class `dependum`); an n-ary link's hub is a small node, its
 *   legs and end are edges.
 * - Names are `label` children (`<id>_label`); a link's value (`label` in the file) is a second
 *   label (`<id>_value`).
 * - A link that targets a link ends on an anchor node (`node:link-anchor`, `<id>_anchor`) on the
 *   middle of that link, as DSM3-goals draws it. Every link whose kind some link kind may target
 *   has one, so a client can start such a link on it.
 */
export function modelToGModelSchema<EK extends string, LK extends string>(
  input: IstarModel<EK, LK>,
  options: ModelToGModelOptions = {},
): GGraphSchema {
  const model = input as unknown as AnyIstarModel;
  const metamodel = metamodelOf(model) as AnyMetamodel;
  const types = gmodelTypes(metamodel, options.types);
  const typeOf = (kind: string): string => {
    const type = types.of(kind);
    if (type === undefined) throw new Error(`kind "${kind}" is not part of ${metamodel.name}`);
    return type;
  };
  const isActor = (element: IstarElement<string>): boolean =>
    metamodel.elements.get(element.kind)?.category === 'actor';
  const defaultSizeOf = (kind: string): Size =>
    options.sizes?.[kind] ?? metamodel.elements.get(kind)?.size ?? { width: 0, height: 0 };
  const sizeOf = (element: IstarElement<string>): Size => {
    const base = defaultSizeOf(element.kind);
    const { width, height } = element.display ?? {};
    return {
      width: typeof width === 'number' ? width : base.width,
      height: typeof height === 'number' ? height : base.height,
    };
  };

  const childrenOf = new Map<string, IstarElement<string>[]>();
  for (const element of model.elements.values()) {
    const parent = element.parent === undefined ? undefined : model.elements.get(element.parent);
    if (isActor(element) || !parent || !isActor(parent)) continue;
    const list = childrenOf.get(parent.id) ?? [];
    list.push(element);
    childrenOf.set(parent.id, list);
  }

  /** Absolute boxes of the drawn elements, for anchors. */
  const boxes = new Map<string, Box>();
  /** Element hidden by a collapsed actor → that actor. */
  const collapsedInto = new Map<string, string>();
  const nodes: GNodeSchema[] = [];

  const node = (
    element: IstarElement<string>,
    box: Box,
    origin: Point,
    cssClasses: string[],
    children: GModelChildSchema[],
    argsPosition?: Point,
  ): GNodeSchema => {
    boxes.set(element.id, box);
    return {
      id: element.id,
      type: typeOf(element.kind),
      position: { x: box.x - origin.x, y: box.y - origin.y },
      size: { width: box.width, height: box.height },
      args: argsOf(element, argsPosition),
      cssClasses,
      children,
    };
  };
  const elementNode = (element: IstarElement<string>, box: Box, origin: Point): GNodeSchema =>
    node(element, box, origin, element.isDependum ? ['dependum'] : [], [
      label(labelId(element.id), element.name, {
        position: { x: box.width / 2, y: box.height / 2 },
      }),
    ]);

  const origin = { x: 0, y: 0 };
  for (const actor of model.elements.values()) {
    if (!isActor(actor)) continue;
    const inner = childrenOf.get(actor.id) ?? [];
    const collapsed = actor.display?.collapsed === true;
    const box: Box = collapsed
      ? { x: actor.x, y: actor.y, ...COLLAPSED_ACTOR_SIZE }
      : actorBounds(model, actor.id, metamodel, defaultSizeOf);
    // The name sits in the actor symbol, a circle centred `ACTOR_SYMBOL_OFFSET`px from the
    // boundary's corner; the CSS class centres the text on that point regardless of its
    // width (#120), instead of guessing the rendered text's size.
    const children: GModelChildSchema[] = [
      label(
        labelId(actor.id),
        actor.name,
        { position: { x: ACTOR_SYMBOL_OFFSET, y: ACTOR_SYMBOL_OFFSET } },
        [ACTOR_LABEL_CSS_CLASS],
      ),
    ];
    if (collapsed) {
      for (const child of inner) collapsedInto.set(child.id, actor.id);
    } else {
      for (const child of inner) {
        children.push(elementNode(child, { x: child.x, y: child.y, ...sizeOf(child) }, box));
      }
    }
    nodes.push(
      node(actor, box, origin, collapsed ? ['collapsed'] : [], children, {
        x: actor.x,
        y: actor.y,
      }),
    );
  }

  for (const element of model.elements.values()) {
    if (isActor(element) || collapsedInto.has(element.id) || boxes.has(element.id)) continue;
    nodes.push(elementNode(element, { x: element.x, y: element.y, ...sizeOf(element) }, origin));
  }

  // Links: endpoints after collapsing; a link on a hidden link is hidden too. Resolved on
  // demand, so a chain of links on links resolves whatever the file's order.
  interface Ends {
    readonly source: string;
    readonly target: string;
    /** For a link on a link: the link it targets (`target` is that link's anchor). */
    readonly targetLink?: IstarLink<string>;
  }
  const ends = new Map<string, Ends | null>();
  const visiting = new Set<string>();
  const endsOf = (link: IstarLink<string>): Ends | null => {
    const known = ends.get(link.id);
    if (known !== undefined) return known;
    if (visiting.has(link.id)) return null;
    visiting.add(link.id);
    let result: Ends | null = null;
    const hiddenSource = collapsedInto.get(link.source);
    const targetLink = model.links.get(link.target);
    if (targetLink) {
      if (!hiddenSource && endsOf(targetLink)) {
        result = { source: link.source, target: linkAnchorId(targetLink.id), targetLink };
      }
    } else {
      const hiddenTarget = collapsedInto.get(link.target);
      if (!hiddenSource && !hiddenTarget) result = { source: link.source, target: link.target };
      // As piStar collapses an actor: dependency links move to the actor, other links hide.
      else if (metamodel.links.get(link.kind)?.category === 'dependency') {
        result = { source: hiddenSource ?? link.source, target: hiddenTarget ?? link.target };
      }
    }
    visiting.delete(link.id);
    ends.set(link.id, result);
    return result;
  };

  // Anchors: on every link of a kind some link kind may target, and on any link a link targets.
  const anchored = new Set(
    typeHintsFor(metamodel).edgeHints.flatMap((hint) =>
      (hint.targetElementTypeIds ?? []).filter((kind) => metamodel.links.has(kind)),
    ),
  );
  const targeted = new Set<string>();
  for (const link of model.links.values()) {
    if (model.links.has(link.target)) targeted.add(link.target);
  }
  const anchorCenters = new Map<string, Point>();
  /** A drawn element's centre. */
  const at = (id: string): Point => {
    const box = boxes.get(id);
    return box ? center(box) : { x: 0, y: 0 };
  };
  /** The middle of a drawn link: halfway along it, from centre to centre through its vertices. */
  const anchorCenter = (link: IstarLink<string>, end: Ends): Point => {
    const known = anchorCenters.get(link.id);
    if (known) return known;
    const targetEnds = end.targetLink && endsOf(end.targetLink);
    const target =
      end.targetLink && targetEnds ? anchorCenter(end.targetLink, targetEnds) : at(end.target);
    const point = midpoint([at(end.source), ...(link.display?.vertices ?? []), target]);
    anchorCenters.set(link.id, point);
    return point;
  };

  const edges: GEdgeSchema[] = [];
  const anchors: GNodeSchema[] = [];
  const placement: GEdgePlacement = { position: 0.5, side: 'on', rotate: false, offset: 0 };
  for (const link of model.links.values()) {
    const end = endsOf(link);
    if (!end) continue;
    const children: GLabelSchema[] = [];
    if (link.label !== undefined) {
      children.push(label(valueLabelId(link.id), link.label, { edgePlacement: { ...placement } }));
    }
    if (link.name !== undefined) {
      children.push(label(labelId(link.id), link.name, { edgePlacement: { ...placement } }));
    }
    edges.push({
      id: link.id,
      type: typeOf(link.kind),
      sourceId: end.source,
      targetId: end.target,
      routingPoints: (link.display?.vertices ?? []).map((v) => ({ x: v.x, y: v.y })),
      args: argsOf(link),
      cssClasses: [],
      children,
    });
    if (anchored.has(link.kind) || targeted.has(link.id)) {
      const point = anchorCenter(link, end);
      const half = LINK_ANCHOR_SIZE / 2;
      anchors.push({
        id: linkAnchorId(link.id),
        type: LINK_ANCHOR_TYPE,
        position: { x: point.x - half, y: point.y - half },
        size: { width: LINK_ANCHOR_SIZE, height: LINK_ANCHOR_SIZE },
        cssClasses: [],
        children: [],
      });
    }
  }

  // Edges above nodes, anchors above the edges they sit on.
  return {
    id: GRAPH_ID,
    type: GRAPH_TYPE,
    position: { x: 0, y: 0 },
    cssClasses: [],
    children: [...nodes, ...edges, ...anchors],
  };
}
