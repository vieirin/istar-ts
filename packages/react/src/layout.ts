/**
 * React Flow nodes and edges, derived from the GModel (`@istar-ts/gmodel`'s
 * `modelToGModelSchema`), the graph `@istar-ts/glsp`'s server sends its clients (#143, #165).
 * Both clients draw that one graph, so they can't disagree on geometry or structure.
 *
 * GModel children are positioned relative to their actor, as React Flow's are relative to their
 * `parentId`, so a child's position carries over unchanged. Kinds are read from `args.kind`,
 * never from the GModel type, so a contribution's type overrides can't lose them.
 *
 * Where each field the canvas draws comes from:
 * - from the GModel: the node and edge structure (which elements are drawn, nesting, collapsed
 *   actors' hidden elements and links, links on links), every element's box, names (labels), a
 *   link's value and name (labels), its vertices (`routingPoints`), and every element's and
 *   link's kind, `customProperties`, `display` and `extra` (`args`), which the node and edge
 *   components get as the `element`/`link` they draw (`ElementNodeData.element`,
 *   `IstarEdgeData.link`);
 * - from the registry, the presentation tier: components, label components, line styles,
 *   frameless actors (`boundary: false`, drawn at the kind's size), and where on a link its
 *   anchor sits (the middle of the link as React draws it, border to border and smooth through
 *   vertices, so links that target it end on the drawn line);
 * - from the model, by id: only what edits, i.e. the inspector and the canvas's own handlers
 *   (drag, resize, create, connect), which change the model through the dispatcher.
 */
import type {
  AnyMetamodel,
  Box,
  ElementKind,
  IstarElement,
  IstarLink,
  IstarModel,
  LinkKind,
  Size,
} from '@istar-ts/core';
import { ACTOR_PADDING, actorBounds, metamodelOf } from '@istar-ts/core';
import type {
  GEdgeSchema,
  GGraphSchema,
  GLabelSchema,
  GModelSizeOverrides,
  GNodeSchema,
} from '@istar-ts/gmodel';
import {
  isGEdgeSchema,
  isGLabelSchema,
  isGNodeSchema,
  labelId,
  linkAnchorId as gmodelLinkAnchorId,
  modelToGModelSchema,
  valueLabelId,
} from '@istar-ts/gmodel';
import type { Edge, Node } from '@xyflow/react';
import type { Anchor, Point } from './link-geometry';
import { linkMidpoint } from './link-geometry';
import type { AnyIstarRegistry, IstarRegistry } from './registry';
import { registryForMetamodel } from './registry';
import { ACTOR_RADIUS } from './shapes';

export type { Box };
export { ACTOR_PADDING };

/** Actor symbol circle: centred at (20, 20) from the boundary's top-left, radius 40. */
export const ACTOR_SYMBOL_OFFSET = 20;

export type ElementNodeData = {
  elementId: string;
  /**
   * The element as the GModel carries it: `kind`, `customProperties`, `display` and `extra`
   * from its `args`, `name` from its label, `parent` from its GModel parent, `isDependum` from
   * its `dependum` class, and `x`/`y` the absolute top-left of its drawn box (for an actor, its
   * boundary's corner). The node components draw this, not the model's element.
   */
  element: IstarElement;
};
export type ActorNodeData = ElementNodeData & {
  collapsed: boolean;
  /** Drawn without a boundary: just the kind's component at its own size (see `boundary`). */
  frameless?: boolean;
};
export type ActorFlowNode = Node<ActorNodeData, 'istarActor'>;
export type ElementFlowNode = Node<ElementNodeData, 'istarElement'>;
/** The middle of a link that other links target (DSM3's `virtualTarget`); see `linkAnchorId`. */
export type LinkAnchorNodeData = { linkId: string };
export type LinkAnchorFlowNode = Node<LinkAnchorNodeData, 'istarLinkAnchor'>;
export type IstarFlowNode = ActorFlowNode | ElementFlowNode | LinkAnchorFlowNode;

/** The drawn ends of the link a link targets, so the edge can follow its live middle. */
export interface TargetLinkEnds {
  /** Flow node ids: elements, or the anchor of the link that link targets in turn. */
  readonly source: string;
  readonly target: string;
  readonly vertices: readonly Point[];
}

export type IstarEdgeData = {
  linkId: string;
  /** The link this one points at, for links that target links (NFR's Argument). */
  targetLinkId?: string;
  /**
   * The link as the GModel carries it: `kind`, `customProperties`, `display` and `extra` from
   * its `args`, `label` and `name` from its value and name labels, and `source`/`target` its
   * drawn ends (a collapsed actor stands for its hidden elements; `target` is the link it
   * targets, for a link on a link). The edge components draw this, not the model's link.
   */
  link: IstarLink<string>;
  /** For a link on a link: the drawn ends of `targetLinkId`. */
  targetLinkEnds?: TargetLinkEnds;
};
export type IstarFlowEdge = Edge<IstarEdgeData, 'istar'>;

/**
 * Merge a model-derived node with the live React Flow node. Selection is kept; `measured` is
 * set to the model size. React Flow prefers `measured` over `width`/`height`, so carrying a
 * stale larger measurement after children move inward would leave the actor boundary stuck
 * expanded (piStar's `updateBoundary` shrinks back to the contents).
 */
export function adoptFlowNode(next: IstarFlowNode, prev: IstarFlowNode | undefined): IstarFlowNode {
  if (!prev) return next;
  const measured =
    next.width !== undefined && next.height !== undefined
      ? { width: next.width, height: next.height }
      : prev.measured;
  return { ...next, measured, selected: prev.selected } as IstarFlowNode;
}

/**
 * The actor's boundary: the kind's default-size rectangle grown to include all inner elements,
 * like piStar's `updateBoundary` (which floors on `originalSize`, not the last expanded size).
 *
 * Actor `display.width`/`height` are the last saved expanded size in piStar files — using them
 * as the floor would leave empty space after children move inward.
 *
 * A thin wrapper over core's `actorBounds` (the geometry `@istar-ts/gmodel` lays actors out
 * with), kept under its old name and signature for compatibility. `children` is unused:
 * `actorBounds` finds the same elements itself (by parent id and category). `registry` is used
 * as `defaultSizeOf`, as the canvas passes its sizes to the GModel (`registrySizes`).
 */
export function actorBoundary<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  registry: IstarRegistry<EK, LK>,
  actor: IstarElement<EK>,
  _children: readonly IstarElement<EK>[],
): Box {
  return actorBounds(model, actor.id, metamodelOf(model), (kind) => registry.elements[kind].size);
}

export interface FlowGraph {
  nodes: IstarFlowNode[];
  edges: IstarFlowEdge[];
  /** Absolute top-left of each node as laid out (for converting drags back to the model). */
  origins: Map<string, { x: number; y: number }>;
}

/** Side of the square node placed on the middle of a link that other links target. */
export const LINK_ANCHOR_SIZE = 12;

const LINK_ANCHOR_PREFIX = 'istar-link-anchor:';

/** The id of the anchor node on the middle of link `linkId`. */
export function linkAnchorId(linkId: string): string {
  return `${LINK_ANCHOR_PREFIX}${linkId}`;
}

/** The link whose anchor node this is, or `undefined` for any other node id. */
export function linkIdOfAnchor(nodeId: string): string | undefined {
  return nodeId.startsWith(LINK_ANCHOR_PREFIX)
    ? nodeId.slice(LINK_ANCHOR_PREFIX.length)
    : undefined;
}

/** Class of the actor symbol, the only part of an actor that selects and drags it. */
export const ACTOR_SYMBOL_CLASS = 'istar-actor-symbol';

/**
 * The registry's size of every element kind, for `modelToGModelSchema`'s `sizes`: the GModel
 * then lays elements and actor boundaries out at the sizes the registry draws (#154), which is
 * also what a GLSP server given the same contribution sends.
 */
export function registrySizes<EK extends string, LK extends string>(
  registry: IstarRegistry<EK, LK>,
): GModelSizeOverrides {
  const sizes: Record<string, Size> = {};
  for (const [kind, config] of Object.entries((registry as unknown as AnyIstarRegistry).elements)) {
    sizes[kind] = config.size;
  }
  return sizes;
}

/** The text of `node`'s label child `id`, if it has one. */
function labelText(node: GNodeSchema | GEdgeSchema, id: string): string | undefined {
  for (const child of node.children) {
    if (child.id === id && isGLabelSchema(child)) return (child as GLabelSchema).text;
  }
  return undefined;
}

/** An element as its GModel node carries it (`ElementNodeData.element`). */
function elementOf(
  node: GNodeSchema,
  at: { x: number; y: number },
  parent: string | undefined,
): IstarElement {
  const args = node.args!;
  const element: IstarElement<string> = {
    id: node.id,
    kind: args.kind,
    name: labelText(node, labelId(node.id)) ?? '',
    x: at.x,
    y: at.y,
    ...(parent !== undefined ? { parent } : {}),
    ...(node.cssClasses.includes('dependum') ? { isDependum: true } : {}),
    ...(args.customProperties ? { customProperties: args.customProperties } : {}),
    ...(args.display ? { display: args.display } : {}),
    ...(args.extra ? { extra: args.extra } : {}),
  };
  // Components take `IstarElement` (iStar 2.0's kinds) whatever the metamodel, as before.
  return element as IstarElement;
}

/**
 * React Flow's nodes and edges for a GModel, drawn with `registry` (by default the one
 * `registryForMetamodel` builds for `metamodel`). `metamodel` is the model's: it says which kinds
 * are actors, so actors of extended kinds are actors too.
 *
 * - Every GModel element node becomes an `istarActor` (actor kinds) or `istarElement` node
 *   (hubs included); its GModel children become React Flow children (`parentId`), at the same
 *   relative position. `collapsed` and `dependum` classes map onto the node data and classes.
 * - Every GModel edge becomes an `istar` edge; one that ends on a link anchor ends on the
 *   `istarLinkAnchor` node of the link it targets (`targetLinkId`).
 * - Every GModel link anchor becomes an `istarLinkAnchor` node (`linkAnchorId`), placed on the
 *   middle of its link as the canvas draws it (see the module comment).
 */
export function gmodelToFlow(
  schema: GGraphSchema,
  metamodel: AnyMetamodel,
  registry: IstarRegistry<string, string> | AnyIstarRegistry = registryForMetamodel(metamodel),
): FlowGraph {
  const elements = (registry as AnyIstarRegistry).elements;
  const isActorKind = (kind: string): boolean => metamodel.elements.get(kind)?.category === 'actor';
  const nodes: IstarFlowNode[] = [];
  const origins = new Map<string, { x: number; y: number }>();
  /** Drawn element boxes, absolute, for placing anchors. */
  const anchorsOf = new Map<string, Anchor>();

  const elementNode = (node: GNodeSchema, parent: { id: string; x: number; y: number } | null) => {
    const at = parent
      ? { x: parent.x + node.position.x, y: parent.y + node.position.y }
      : { x: node.position.x, y: node.position.y };
    const { width, height } = node.size;
    origins.set(node.id, at);
    anchorsOf.set(node.id, {
      center: { x: at.x + width / 2, y: at.y + height / 2 },
      width,
      height,
    });
    const dependum = node.cssClasses.includes('dependum');
    nodes.push({
      id: node.id,
      type: 'istarElement',
      ...(parent ? { parentId: parent.id } : {}),
      position: { x: node.position.x, y: node.position.y },
      width,
      height,
      data: { elementId: node.id, element: elementOf(node, at, parent?.id) },
      zIndex: 1,
      className: `istar-node istar-node-element${dependum ? ' istar-node-dependum' : ''}`,
    });
  };

  const graphNodes = schema.children.filter(isGNodeSchema) as GNodeSchema[];
  const anchorNodes = new Set<string>();
  // Parents precede their children in React Flow's node array, as the GModel nests them.
  for (const node of graphNodes) {
    if (!node.args) {
      anchorNodes.add(node.id);
      continue;
    }
    const kind = node.args.kind;
    if (!isActorKind(kind)) {
      elementNode(node, null);
      continue;
    }
    const collapsed = node.cssClasses.includes('collapsed');
    const frameless = elements[kind]?.boundary === false;
    // Like framed actors, frameless ones ignore any saved `display` size: the kind's size wins.
    const size = frameless ? elements[kind]!.size : node.size;
    const at = { x: node.position.x, y: node.position.y };
    origins.set(node.id, at);
    anchorsOf.set(
      node.id,
      frameless
        ? { center: { x: at.x + size.width / 2, y: at.y + size.height / 2 }, ...size }
        : {
            center: { x: at.x + ACTOR_SYMBOL_OFFSET, y: at.y + ACTOR_SYMBOL_OFFSET },
            radius: ACTOR_RADIUS,
            ...size,
          },
    );
    nodes.push({
      id: node.id,
      type: 'istarActor',
      position: at,
      width: size.width,
      height: size.height,
      data: {
        elementId: node.id,
        element: elementOf(node, at, undefined),
        collapsed,
        ...(frameless && { frameless }),
      },
      zIndex: 0,
      className: 'istar-node istar-node-actor',
      // Only the actor symbol (the circle) selects the actor, and drags it while something is
      // selected; clicks on the boundary's body do nothing, and box selection never picks up
      // the whole frame. IstarCanvas selects actors itself when their symbol is clicked, and
      // drops the drag handle while nothing is selected so the body drags too.
      selectable: false,
      dragHandle: `.${ACTOR_SYMBOL_CLASS}`,
    });
    for (const child of node.children) {
      if (isGNodeSchema(child) && child.args) elementNode(child, { id: node.id, ...at });
    }
  }

  // The GModel's anchors, by the link they sit on.
  const gmodelEdges = schema.children.filter(isGEdgeSchema) as GEdgeSchema[];
  const anchored = new Set<string>();
  /** GModel anchor id → the link it sits on. */
  const anchorLink = new Map<string, string>();
  for (const edge of gmodelEdges) {
    const id = gmodelLinkAnchorId(edge.id);
    if (anchorNodes.has(id)) {
      anchored.add(edge.id);
      anchorLink.set(id, edge.id);
    }
  }

  const edges: IstarFlowEdge[] = [];
  const edgeById = new Map<string, IstarFlowEdge>();
  for (const edge of gmodelEdges) {
    const kind = edge.args.kind;
    const targetLinkId = anchorLink.get(edge.targetId);
    const label = labelText(edge, valueLabelId(edge.id));
    const name = labelText(edge, labelId(edge.id));
    const link: IstarLink<string> = {
      id: edge.id,
      kind,
      source: edge.sourceId,
      target: targetLinkId ?? edge.targetId,
      ...(label !== undefined ? { label } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(edge.args.customProperties ? { customProperties: edge.args.customProperties } : {}),
      ...(edge.args.display ? { display: edge.args.display } : {}),
      ...(edge.args.extra ? { extra: edge.args.extra } : {}),
    };
    const flowEdge: IstarFlowEdge = {
      id: edge.id,
      type: 'istar',
      source: edge.sourceId,
      target: targetLinkId !== undefined ? linkAnchorId(targetLinkId) : edge.targetId,
      data: { linkId: edge.id, ...(targetLinkId !== undefined ? { targetLinkId } : {}), link },
      zIndex: 1,
      // `istar.OrRefinementLink` → `istar-edge-OrRefinementLink`; namespaced extension kinds
      // likewise drop their namespace.
      className: `istar-edge istar-edge-${kind.slice(kind.indexOf('.') + 1)}`,
    };
    edges.push(flowEdge);
    edgeById.set(edge.id, flowEdge);
  }
  for (const edge of edges) {
    const targetLinkId = edge.data!.targetLinkId;
    const target = targetLinkId === undefined ? undefined : edgeById.get(targetLinkId);
    if (target) {
      edge.data!.targetLinkEnds = {
        source: target.source,
        target: target.target,
        vertices: target.data!.link.display?.vertices ?? [],
      };
    }
  }

  // Anchors on the middle of their links as drawn; a link on a link ends on that link's anchor,
  // so chains resolve on demand.
  const placed = new Map<string, Anchor | null>();
  const anchorAt = (linkId: string): Anchor | null => {
    const known = placed.get(linkId);
    if (known !== undefined) return known;
    placed.set(linkId, null);
    const edge = edgeById.get(linkId);
    const source = edge && anchorsOf.get(edge.source);
    const targetLinkId = edge?.data!.targetLinkId;
    const target =
      edge && (targetLinkId === undefined ? anchorsOf.get(edge.target) : anchorAt(targetLinkId));
    if (!edge || !source || !target) return null;
    const middle = linkMidpoint(source, target, edge.data!.link.display?.vertices ?? []);
    const point: Anchor = { center: { x: middle.x, y: middle.y }, width: 0, height: 0 };
    placed.set(linkId, point);
    return point;
  };
  const half = LINK_ANCHOR_SIZE / 2;
  for (const edge of edges) {
    if (!anchored.has(edge.id)) continue;
    const middle = anchorAt(edge.id);
    if (!middle) continue;
    const position = { x: middle.center.x - half, y: middle.center.y - half };
    const id = linkAnchorId(edge.id);
    origins.set(id, { ...position });
    nodes.push({
      id,
      type: 'istarLinkAnchor',
      position,
      width: LINK_ANCHOR_SIZE,
      height: LINK_ANCHOR_SIZE,
      data: { linkId: edge.id },
      draggable: false,
      selectable: false,
      connectable: true,
      zIndex: 2,
      className: 'istar-node istar-link-anchor',
    });
  }
  return { nodes, edges, origins };
}

/**
 * The model's React Flow nodes and edges, laid out with `registry`: by default the one
 * `registryForMetamodel` builds for the model's metamodel, so extended kinds have their sizes.
 *
 * @deprecated Use `gmodelToFlow(modelToGModelSchema(model, { sizes: registrySizes(registry) }),
 * metamodelOf(model), registry)`, which this wraps; it will be removed in the next release.
 */
export function modelToFlow<EK extends string = ElementKind, LK extends string = LinkKind>(
  model: IstarModel<EK, LK>,
  registry: IstarRegistry<EK, LK> = registryForMetamodel(metamodelOf(model)),
): FlowGraph {
  const metamodel = metamodelOf(model) as unknown as AnyMetamodel;
  const schema = modelToGModelSchema(model, { sizes: registrySizes(registry) });
  return gmodelToFlow(schema, metamodel, registry as unknown as AnyIstarRegistry);
}
