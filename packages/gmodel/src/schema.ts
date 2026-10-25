/**
 * The GModel's schema: GLSP's wire shape (`GModelElementSchema` and its node, edge and label
 * forms, framework-notes §2), declared here so this package needs no `@eclipse-glsp/*` import.
 * The fields are the ones GLSP's server sends for the classes it builds (`GGraph`, `GNode`,
 * `GEdge`, `GLabel`): a schema `modelToGModelSchema` returns is what a GLSP server built from it
 * puts on the wire, plus the root's `revision`.
 */
import type {
  CustomProperties,
  ElementDisplay,
  Extra,
  LinkDisplay,
  Point,
  Size,
} from '@istar-ts/core';

/** Fields every GModel element has. */
export interface GModelElementSchema {
  id: string;
  type: string;
  children: GModelChildSchema[];
  cssClasses: string[];
}

/**
 * The `args` of a node or edge that stands for a model element or link. GLSP types `args` as
 * flat primitives; `customProperties`, `display` and `extra` are objects, which the wire carries
 * as they are (the server's serializer and the client's model factory copy fields unchanged).
 */
export interface GModelElementArgs {
  /** The element's or link's kind, verbatim, whatever the GModel type (`types.ts`). */
  kind: string;
  /** The element's or link's custom properties, verbatim: values are strings, as on disk. */
  customProperties?: CustomProperties;
  /** The file's `display` entry, verbatim (sizes, `collapsed`, colours, vertices, …). */
  display?: ElementDisplay | LinkDisplay;
  /** JSON keys the file holds that istar-ts doesn't model, verbatim. */
  extra?: Extra;
  /**
   * An actor's own `x`/`y`, absolute model coordinates, regardless of its node's `position`
   * (the boundary box's corner, which can differ when a frameless actor — registry
   * `boundary: false` — has an element above or left of it; #194).
   */
  position?: Point;
}

/** The root, `graph`. */
export interface GGraphSchema extends GModelElementSchema {
  position: Point;
}

/** An element, an n-ary hub or a link anchor. Positions are relative to the parent node. */
export interface GNodeSchema extends GModelElementSchema {
  position: Point;
  size: Size;
  /** Absent on a link anchor, which stands for no model element. */
  args?: GModelElementArgs;
}

/** A link, an n-ary leg or an n-ary end. Routing points are absolute. */
export interface GEdgeSchema extends GModelElementSchema {
  sourceId: string;
  targetId: string;
  routingPoints: Point[];
  args: GModelElementArgs;
}

/** Where a label sits on its edge (GLSP's `EdgePlacement`). */
export interface GEdgePlacement {
  position: number;
  side: 'on' | 'left' | 'right' | 'top' | 'bottom';
  rotate: boolean;
  offset: number;
}

/** A name or a link's value. A node's label is placed by `position`, an edge's by placement. */
export interface GLabelSchema extends GModelElementSchema {
  text: string;
  alignment: Point;
  position?: Point;
  edgePlacement?: GEdgePlacement;
}

export type GModelChildSchema = GNodeSchema | GEdgeSchema | GLabelSchema;

/** A node: an element, a hub or an anchor. */
export function isGNodeSchema(element: GModelElementSchema): element is GNodeSchema {
  return 'size' in element && !('text' in element);
}

/** An edge: a link, a leg or an end. */
export function isGEdgeSchema(element: GModelElementSchema): element is GEdgeSchema {
  return 'sourceId' in element;
}

/** A label: a name or a link's value. */
export function isGLabelSchema(element: GModelElementSchema): element is GLabelSchema {
  return 'text' in element;
}
