/**
 * Converts an `IstarModel` into React Flow nodes and edges.
 *
 * Model coordinates are absolute (as in piStar files). React Flow child nodes are positioned
 * relative to their parent, so each actor's boundary is computed first and inner elements are
 * offset from its top-left corner.
 */
import type { IstarElement, IstarLink, IstarModel } from '@istar-ts/core';
import { isActorKind } from '@istar-ts/core';
import type { Edge, Node } from '@xyflow/react';
import type { IstarRegistry } from './registry';
import { elementSize } from './registry';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Space kept between inner elements and the actor boundary (upstream adds 10px). */
export const ACTOR_PADDING = 10;

/** Actor symbol circle: centred at (20, 20) from the boundary's top-left, radius 40. */
export const ACTOR_SYMBOL_OFFSET = 20;

export type ActorNodeData = { elementId: string; collapsed: boolean };
export type ElementNodeData = { elementId: string };
export type ActorFlowNode = Node<ActorNodeData, 'istarActor'>;
export type ElementFlowNode = Node<ElementNodeData, 'istarElement'>;
export type IstarFlowNode = ActorFlowNode | ElementFlowNode;

export type IstarEdgeData = { linkId: string };
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
 */
export function actorBoundary(
  model: IstarModel,
  registry: IstarRegistry,
  actor: IstarElement,
  children: readonly IstarElement[],
): Box {
  const size = registry.elements[actor.kind].size;
  let minX = actor.x;
  let minY = actor.y;
  let maxX = actor.x + size.width;
  let maxY = actor.y + size.height;
  for (const child of children) {
    const s = elementSize(registry, child);
    minX = Math.min(minX, child.x - ACTOR_PADDING);
    minY = Math.min(minY, child.y - ACTOR_PADDING);
    maxX = Math.max(maxX, child.x + s.width + ACTOR_PADDING);
    maxY = Math.max(maxY, child.y + s.height + ACTOR_PADDING);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface FlowGraph {
  nodes: IstarFlowNode[];
  edges: IstarFlowEdge[];
  /** Absolute top-left of each node as laid out (for converting drags back to the model). */
  origins: Map<string, { x: number; y: number }>;
}

export function modelToFlow(model: IstarModel, registry: IstarRegistry): FlowGraph {
  const nodes: IstarFlowNode[] = [];
  const origins = new Map<string, { x: number; y: number }>();
  const children = new Map<string, IstarElement[]>();
  for (const element of model.elements.values()) {
    if (element.parent !== undefined && !isActorKind(element.kind)) {
      const list = children.get(element.parent) ?? [];
      list.push(element);
      children.set(element.parent, list);
    }
  }

  /** Hidden element id → the collapsed actor standing in for it. */
  const collapsedInto = new Map<string, string>();

  // Parents must precede their children in React Flow's node array.
  for (const actor of model.elements.values()) {
    if (!isActorKind(actor.kind)) continue;
    const inner = children.get(actor.id) ?? [];
    const collapsed = actor.display?.collapsed === true;
    const box = collapsed
      ? { x: actor.x, y: actor.y, width: 60, height: 60 }
      : actorBoundary(model, registry, actor, inner);
    origins.set(actor.id, { x: box.x, y: box.y });
    nodes.push({
      id: actor.id,
      type: 'istarActor',
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: { elementId: actor.id, collapsed },
      zIndex: 0,
      className: 'istar-node istar-node-actor',
    });
    for (const child of inner) {
      if (collapsed) collapsedInto.set(child.id, actor.id);
      const size = elementSize(registry, child);
      origins.set(child.id, { x: child.x, y: child.y });
      nodes.push({
        id: child.id,
        type: 'istarElement',
        parentId: actor.id,
        position: { x: child.x - box.x, y: child.y - box.y },
        width: size.width,
        height: size.height,
        hidden: collapsed,
        data: { elementId: child.id },
        zIndex: 1,
        className: 'istar-node istar-node-element',
      });
    }
  }

  for (const element of model.elements.values()) {
    if (isActorKind(element.kind)) continue;
    if (element.parent !== undefined && model.elements.has(element.parent)) continue;
    const size = elementSize(registry, element);
    origins.set(element.id, { x: element.x, y: element.y });
    nodes.push({
      id: element.id,
      type: 'istarElement',
      position: { x: element.x, y: element.y },
      width: size.width,
      height: size.height,
      data: { elementId: element.id },
      zIndex: 1,
      className: `istar-node istar-node-element${element.isDependum ? ' istar-node-dependum' : ''}`,
    });
  }

  const edges: IstarFlowEdge[] = [];
  for (const link of model.links.values()) {
    const edge = linkToEdge(link, collapsedInto);
    if (edge) edges.push(edge);
  }
  return { nodes, edges, origins };
}

function linkToEdge(link: IstarLink, collapsedInto: Map<string, string>): IstarFlowEdge | null {
  let { source, target } = link;
  const hiddenSource = collapsedInto.get(source);
  const hiddenTarget = collapsedInto.get(target);
  if (hiddenSource || hiddenTarget) {
    // Like piStar's collapse: dependency links are re-anchored on the actor, others are hidden.
    if (link.kind !== 'istar.DependencyLink') return null;
    source = hiddenSource ?? source;
    target = hiddenTarget ?? target;
  }
  return {
    id: link.id,
    type: 'istar',
    source,
    target,
    data: { linkId: link.id },
    zIndex: 1,
    className: `istar-edge istar-edge-${link.kind.slice(6)}`,
  };
}
