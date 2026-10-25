/**
 * `modelToGModel`: the GModel (GLSP's notation model) of an istar-ts model. The piStar file holds
 * both the semantic model and its layout, so the notation is derived from the one model instead
 * of kept beside it, a deliberate difference from the reference architecture's separate source
 * and representation models (Metin & Bork 2025, §4.1.3). There is one representation per model.
 *
 * Coordinates. The model's `x`/`y` are absolute, as in the piStar file. Top-level nodes and edge
 * routing points keep them. An actor is a container: its node's position is its boundary's
 * top-left corner, and its elements are its children, positioned relative to that corner
 * (`child.x - boundary.x`, `child.y - boundary.y`), as GLSP nests bounds. The boundary is core's
 * `actorBounds` (after piStar's `updateBoundary`), shared with the React canvas's `modelToFlow`:
 * the kind's default size at the actor's `x`/`y`, grown to hold every element plus 10px padding.
 *
 * Sizes come from the element's `display` width/height (a resized element) or its kind's default
 * size in the metamodel, so the client needs no bounds round trip (`needsClientLayout: false`).
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
import { GEdge, GGraph, GLabel, GNode } from '@eclipse-glsp/server';
import type { GModelElement } from '@eclipse-glsp/server';
import type { GModelSizeOverrides, GModelTypeOverrides } from './types';
import { LINK_ANCHOR_TYPE, gmodelTypes } from './types';

/** A collapsed actor's box, as the React canvas draws it. */
export const COLLAPSED_ACTOR_SIZE: Size = { width: 60, height: 60 };
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

function nameLabel(id: string, text: string, position: Point): GLabel {
  return GLabel.builder().id(labelId(id)).text(text).position(position).build();
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
 * The model's GModel. Every element is a `GNode` and every link a `GEdge`, with the element's or
 * link's id; types follow `gmodelTypes`.
 *
 * - Actors are containers holding their elements. A collapsed actor is a small node without
 *   children; like piStar, its elements' dependency links end on the actor and its elements'
 *   other links are hidden.
 * - Dependums are top-level nodes (class `dependum`); an n-ary link's hub is a small node, its
 *   legs and end are edges.
 * - Names are `label` children (`<id>_label`); a link's value (`label` in the file) is a second
 *   label (`<id>_value`). Custom properties are not copied: the framework only uses `args` for
 *   rendering options (framework-notes §2), and the client can ask for the model itself.
 * - A link that targets a link ends on an anchor node (`node:link-anchor`, `<id>_anchor`) on the
 *   middle of that link, as DSM3-goals draws it. Every link whose kind some link kind may target
 *   has one, so a client can start such a link on it.
 */
export function modelToGModel<EK extends string, LK extends string>(
  input: IstarModel<EK, LK>,
  options: ModelToGModelOptions = {},
): GGraph {
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
  const nodes: GModelElement[] = [];

  const elementNode = (element: IstarElement<string>, box: Box, origin: Point): GNode => {
    boxes.set(element.id, box);
    const builder = GNode.builder()
      .id(element.id)
      .type(typeOf(element.kind))
      .position(box.x - origin.x, box.y - origin.y)
      .size(box.width, box.height)
      .add(nameLabel(element.id, element.name, { x: box.width / 2, y: box.height / 2 }));
    if (element.isDependum) builder.addCssClass('dependum');
    return builder.build();
  };

  for (const actor of model.elements.values()) {
    if (!isActor(actor)) continue;
    const inner = childrenOf.get(actor.id) ?? [];
    const collapsed = actor.display?.collapsed === true;
    const box: Box = collapsed
      ? { x: actor.x, y: actor.y, ...COLLAPSED_ACTOR_SIZE }
      : actorBounds(model, actor.id, metamodel, defaultSizeOf);
    boxes.set(actor.id, box);
    const builder = GNode.builder()
      .id(actor.id)
      .type(typeOf(actor.kind))
      .position(box.x, box.y)
      .size(box.width, box.height)
      // The name sits in the actor symbol, a circle centred 20px from the boundary's corner.
      .add(nameLabel(actor.id, actor.name, { x: 20, y: 20 }));
    if (collapsed) {
      builder.addCssClass('collapsed');
      for (const child of inner) collapsedInto.set(child.id, actor.id);
    } else {
      for (const child of inner) {
        builder.add(elementNode(child, { x: child.x, y: child.y, ...sizeOf(child) }, box));
      }
    }
    nodes.push(builder.build());
  }

  const origin = { x: 0, y: 0 };
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

  const edges: GModelElement[] = [];
  const anchors: GModelElement[] = [];
  for (const link of model.links.values()) {
    const end = endsOf(link);
    if (!end) continue;
    const builder = GEdge.builder()
      .id(link.id)
      .type(typeOf(link.kind))
      .sourceId(end.source)
      .targetId(end.target)
      .addRoutingPoints((link.display?.vertices ?? []).map((v) => ({ x: v.x, y: v.y })));
    const placement = { position: 0.5, side: 'on', rotate: false, offset: 0 } as const;
    if (link.label !== undefined) {
      builder.add(
        GLabel.builder()
          .id(valueLabelId(link.id))
          .text(link.label)
          .edgePlacement(placement)
          .build(),
      );
    }
    if (link.name !== undefined) {
      builder.add(
        GLabel.builder().id(labelId(link.id)).text(link.name).edgePlacement(placement).build(),
      );
    }
    edges.push(builder.build());
    if (anchored.has(link.kind) || targeted.has(link.id)) {
      const point = anchorCenter(link, end);
      const half = LINK_ANCHOR_SIZE / 2;
      anchors.push(
        GNode.builder()
          .id(linkAnchorId(link.id))
          .type(LINK_ANCHOR_TYPE)
          .position(point.x - half, point.y - half)
          .size(LINK_ANCHOR_SIZE, LINK_ANCHOR_SIZE)
          .build(),
      );
    }
  }

  // Edges above nodes, anchors above the edges they sit on.
  return GGraph.builder()
    .id(GRAPH_ID)
    .addChildren(...nodes, ...edges, ...anchors)
    .build();
}
