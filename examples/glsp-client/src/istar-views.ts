/**
 * Custom views for iStar 2.0 (and any extension) shapes (#84): goal/quality/task/resource
 * shapes, an actor's circle and dashed boundary, and link markers (refinement, contribution,
 * qualification, needed-by, the dependency "D"). `configureIstarModelElements`
 * (`elementTypes.ts`) still registers the framework's default views first
 * (`configureDefaultModelElements`); this only overrides the `node:*`/`edge:*` types this module
 * knows how to draw, so a kind with none of this (an extension with no `shape`/`line` of its
 * own, a hub, a link anchor) still renders with the plain default views (#83's "it uses only the
 * framework's default views and configuration").
 *
 * Driven by the metamodel, not by `istar.*` name comparisons, wherever the metamodel carries
 * enough information (`category`, an extension's `shape`/`line`, `behavesLike`): KAOS and NFR
 * get their own shapes and link markers this way, with no code here naming their kinds. The
 * built-in iStar 2.0 kinds are the one unavoidable exception, the same way
 * `packages/react/src/shapes.tsx`'s `DEFAULT_SHAPES`/`ACTOR_DECORATOR` and `edges.tsx`'s
 * `TARGET_MARKERS` are: the iStar 2.0 metamodel itself (`packages/core/src/metamodel.ts`)
 * declares no `shape`/`line` for its own kinds, only extensions do.
 */
import { injectable } from 'inversify';
import type { IView, Point, RenderingContext } from '@eclipse-glsp/client';
import {
  GEdge,
  GEdgeView,
  GNode,
  RectangularNodeView,
  ShapeView,
  overrideModelElement,
  svg,
} from '@eclipse-glsp/client';
import type { AnyMetamodel, KindLine, KindShape } from '@istar-ts/core';
import { effectiveElementKind, effectiveLinkKind } from '@istar-ts/core';
import type { ModelElementBindingContext } from './elementTypes';

/** Radius of the actor symbol circle; matches `@istar-ts/react`'s `ACTOR_RADIUS`. */
const ACTOR_RADIUS = 40;
/** Centre of the actor symbol, relative to the node's own box; matches `ACTOR_SYMBOL_OFFSET`. */
const ACTOR_SYMBOL_OFFSET = 20;

/**
 * Decorations that distinguish Role and Agent from a plain Actor, as
 * `packages/react/src/shapes.tsx`'s `ACTOR_DECORATOR` draws them (paths relative to the circle's
 * box, which sits at `(ACTOR_SYMBOL_OFFSET, ACTOR_SYMBOL_OFFSET)` here instead of react's
 * `(-20,-20)`-origin box, hence the `+20` offsets).
 */
const ACTOR_DECORATOR: Readonly<Record<string, string>> = {
  'istar.Role': 'm 29 85 q 30 15 62 0',
  'istar.Agent': 'm 29 35 62 0',
};

/** Mirrors `packages/react/src/shapes.tsx`'s `QUALITY_PATH` (piStar's cloud shape). */
const QUALITY_PATH =
  'm 60.637955,-4.0358 c 17.5174,2.2042 29.9953,-10.69554 41.892705,-4.7858 22.34142,10.8714 11.2203,43.7743 -2.25,47.7322 -8.276505,2.9084 -13.960205,5.1934 -46.142805,-2.1786 -6.7454,-2.2317 -28.2652,6.0799 -35.4643,4.7143 C 9.072156,39.4809 6.491756,33.7693 3.744956,28.482 c -6.3069,-15.1266 -2.5738,-28.0439 7.981099,-34.7856 10.5549,-6.74179 27.9316,-7.30796 48.9119,2.2678 z';
const QUALITY_VIEWBOX = { x: -0.5, y: -12.5, width: 117, height: 55.4 };

/** Mirrors `packages/react/src/shapes.tsx`'s `TaskShape` (piStar's hexagon). */
const TASK_PATH = 'M 0,18 15,0 115,0 130,18 115,36 15,36 Z';
const TASK_VIEWBOX = { x: -1, y: -1, width: 132, height: 38 };

/**
 * The fallback shape of the iStar 2.0 kinds that have none of their own in the metamodel
 * (`effectiveElementKind` resolves an extension that `behavesLike` one of these to it too).
 * `istar.Resource` is not here: its fallback is the plain `RectangularNodeView`.
 */
const BUILTIN_NODE_SHAPE: Readonly<Record<string, KindShape>> = {
  'istar.Quality': { path: QUALITY_PATH, viewBox: svgViewBoxString(QUALITY_VIEWBOX) },
  'istar.Task': { path: TASK_PATH, viewBox: svgViewBoxString(TASK_VIEWBOX) },
};

/** Mirrors `packages/react/src/edges.tsx`'s `OPEN_ARROW`/`TARGET_MARKERS`/`DEPENDENCY_D`. */
const OPEN_ARROW = 'm 10,-6 l -10,6 10,6';
const BUILTIN_LINK_LINE: Readonly<Record<string, KindLine>> = {
  'istar.AndRefinementLink': { marker: 'm 10,-6 l 0,12' },
  'istar.OrRefinementLink': { marker: 'm 12,-6 l -12,6 12,6 z', markerFilled: true },
  'istar.NeededByLink': { marker: 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0', markerFilled: true },
  'istar.ContributionLink': { marker: OPEN_ARROW },
  'istar.IsALink': { marker: OPEN_ARROW },
  'istar.ParticipatesInLink': { marker: OPEN_ARROW },
  'istar.QualificationLink': { dash: '10,5', marker: false },
};
/** The dependency "D", drawn at the middle of each half, facing the dependee; matches react's. */
const DEPENDENCY_D = 'm 0,-10 l 0,20 4,0 c 10,0, 10 -20, 0,-20 l -4,0';

function svgViewBoxString(box: { x: number; y: number; width: number; height: number }): string {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Cache of a path's own bounds (for a `KindShape` with no declared `viewBox`, e.g. NFR's cloud). */
const pathBoundsCache = new Map<string, ViewBox>();
let boundsHost: SVGSVGElement | undefined;

/** The bounds of an SVG path's data, computed once per distinct `d` via a hidden `<svg>`. */
function pathBounds(path: string): ViewBox {
  const cached = pathBoundsCache.get(path);
  if (cached) return cached;
  if (!boundsHost) {
    boundsHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    boundsHost.style.position = 'absolute';
    boundsHost.style.width = '0';
    boundsHost.style.height = '0';
    boundsHost.style.overflow = 'hidden';
    document.body.append(boundsHost);
  }
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  probe.setAttribute('d', path);
  boundsHost.append(probe);
  const box = probe.getBBox();
  probe.remove();
  const bounds: ViewBox = {
    x: box.x,
    y: box.y,
    width: box.width > 0 ? box.width : 1,
    height: box.height > 0 ? box.height : 1,
  };
  pathBoundsCache.set(path, bounds);
  return bounds;
}

/** The viewBox a `KindShape` is drawn with: its own, or its path's bounds plus a small margin. */
function shapeViewBox(spec: KindShape): ViewBox {
  if (spec.viewBox) {
    const [x, y, width, height] = spec.viewBox.split(/\s+/).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { x, y, width, height };
  }
  const b = pathBounds(spec.path);
  const mx = Math.max(b.width, 1) * 0.02;
  const my = Math.max(b.height, 1) * 0.02;
  return { x: b.x - mx, y: b.y - my, width: b.width + 2 * mx, height: b.height + 2 * my };
}

/**
 * Draws `spec.path`, scaled (non-uniformly, like `preserveAspectRatio="none"`) from its
 * `viewBox` onto the node's own size, as `@istar-ts/react`'s `PathShape` does. One instance is
 * registered per concrete kind, each with its own `spec` baked in at registration time: GLSP's
 * `GModel` carries no rendering hints of its own (`@istar-ts/glsp`'s README, "custom properties
 * are not copied into `args`"), so the shape has to be known when the view is built, not read
 * off the node at render time.
 */
function pathNodeView(spec: KindShape): new () => IView {
  @injectable()
  class IstarPathNodeView extends ShapeView {
    render(node: Readonly<GNode>, context: RenderingContext): ReturnType<IView['render']> {
      if (!this.isVisible(node, context)) return undefined;
      const width = Math.max(node.size.width, 0);
      const height = Math.max(node.size.height, 0);
      const box = shapeViewBox(spec);
      const scaleX = box.width > 0 ? width / box.width : 1;
      const scaleY = box.height > 0 ? height / box.height : 1;
      return svg(
        'g',
        null,
        svg('path', {
          'class-sprotty-node': true,
          'class-mouseover': node.hoverFeedback,
          'class-selected': node.selected,
          d: spec.path,
          transform: `scale(${scaleX} ${scaleY}) translate(${-box.x} ${-box.y})`,
          'style-vector-effect': 'non-scaling-stroke',
          ...(spec.dash ? { 'style-stroke-dasharray': spec.dash } : {}),
          ...(spec.strokeWidth !== undefined
            ? { 'style-stroke-width': `${spec.strokeWidth}px` }
            : {}),
          ...(spec.fill ? { 'style-fill': spec.fill } : {}),
        }),
        ...context.renderChildren(node),
      );
    }
  }
  return IstarPathNodeView;
}

/** A rounded rectangle (a pill), as `@istar-ts/react`'s `GoalShape` draws `istar.Goal`. */
@injectable()
class GoalNodeView extends ShapeView {
  render(node: Readonly<GNode>, context: RenderingContext): ReturnType<IView['render']> {
    if (!this.isVisible(node, context)) return undefined;
    const width = Math.max(node.size.width, 0);
    const height = Math.max(node.size.height, 0);
    const radius = Math.min(20, height / 2);
    return svg(
      'g',
      null,
      svg('rect', {
        'class-sprotty-node': true,
        'class-mouseover': node.hoverFeedback,
        'class-selected': node.selected,
        x: 0,
        y: 0,
        width,
        height,
        rx: radius,
        ry: radius,
      }),
      ...context.renderChildren(node),
    );
  }
}

/**
 * An actor's circle and, unless collapsed, its dashed boundary (a pill-shaped area holding its
 * elements), as `@istar-ts/react`'s `ActorNode`/`ActorSymbol` draw `istar.Actor`/`Agent`/`Role`.
 * One instance per actor kind, closing over that kind's decorator (if any; `undefined` for a
 * plain actor or an extension actor kind without one).
 */
function actorNodeView(decorator: string | undefined): new () => IView {
  @injectable()
  class IstarActorNodeView extends ShapeView {
    render(node: Readonly<GNode>, context: RenderingContext): ReturnType<IView['render']> {
      if (!this.isVisible(node, context)) return undefined;
      const width = Math.max(node.size.width, 0);
      const height = Math.max(node.size.height, 0);
      // A collapsed actor (gmodel.ts's `collapsed` class) has no children and no boundary, as
      // piStar draws it: just the symbol, at its usual fixed offset and size.
      const collapsed = node.cssClasses?.includes('collapsed') ?? false;
      return svg(
        'g',
        null,
        ...(collapsed
          ? []
          : [
              svg('rect', {
                'class-istar-glsp-actor-boundary': true,
                x: 0,
                y: 0,
                width,
                height,
                rx: 100,
                ry: 40,
              }),
            ]),
        svg('circle', {
          'class-sprotty-node': true,
          'class-mouseover': node.hoverFeedback,
          'class-selected': node.selected,
          cx: ACTOR_SYMBOL_OFFSET,
          cy: ACTOR_SYMBOL_OFFSET,
          r: ACTOR_RADIUS,
        }),
        ...(decorator
          ? [
              svg('path', {
                'class-istar-glsp-actor-decorator': true,
                d: decorator,
                'style-fill': 'none',
              }),
            ]
          : []),
        ...context.renderChildren(node),
      );
    }
  }
  return IstarActorNodeView;
}

/** The point at the polyline's middle, and the direction of travel there (degrees). */
function polylineMidpoint(points: readonly Point[]): Point & { angle: number } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = lengths[i - 1]!;
    if (remaining <= length || i === points.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    remaining -= length;
  }
  return { ...(points[0] ?? { x: 0, y: 0 }), angle: 0 };
}

interface ResolvedEdgeStyle {
  readonly dash?: string;
  readonly marker?: { readonly d: string; readonly filled: boolean };
  /** Draw the dependency "D" at the link's middle. */
  readonly dependency: boolean;
}

/**
 * The marker at the target end (JointJS convention: `(0,0)` is the link's end, `+x` points back
 * towards the source, as `@istar-ts/react`'s `TARGET_MARKERS` draws it) and, for a
 * dependency-category link, the "D" at the middle. Line dash and label text (the link's own name
 * or value, a fixed label) are left to the defaults: `@istar-ts/glsp`'s `modelToGModel` already
 * adds those as `label` children, which the default `GLabelView` renders.
 */
function edgeView(spec: ResolvedEdgeStyle): new () => IView {
  @injectable()
  class IstarEdgeView extends GEdgeView {
    protected override renderLine(
      edge: GEdge,
      segments: Point[],
      context: RenderingContext,
    ): ReturnType<GEdgeView['renderLine']> {
      if (!spec.dash) return super.renderLine(edge, segments, context);
      return svg('path', {
        d: this.createPathForSegments(segments),
        'style-stroke-dasharray': spec.dash,
      });
    }

    protected override renderAdditionals(
      edge: GEdge,
      segments: Point[],
      context: RenderingContext,
    ): ReturnType<GEdgeView['renderAdditionals']> {
      const additionals = [...super.renderAdditionals(edge, segments, context)];
      if (segments.length < 2) return additionals;
      if (spec.marker) {
        const end = segments[segments.length - 1]!;
        const before = segments[segments.length - 2]!;
        const angle = (Math.atan2(before.y - end.y, before.x - end.x) * 180) / Math.PI;
        additionals.push(
          svg('path', {
            'class-istar-glsp-marker': true,
            'class-is-filled': spec.marker.filled,
            d: spec.marker.d,
            transform: `translate(${end.x} ${end.y}) rotate(${angle})`,
          }),
        );
      }
      if (spec.dependency) {
        const middle = polylineMidpoint(segments);
        additionals.push(
          svg('path', {
            'class-istar-glsp-dependency': true,
            d: DEPENDENCY_D,
            transform: `translate(${middle.x} ${middle.y}) rotate(${middle.angle})`,
          }),
        );
      }
      return additionals;
    }
  }
  return IstarEdgeView;
}

/** The view for element kind `kind`, or `undefined` to leave the framework's default in place. */
function nodeViewFor(metamodel: AnyMetamodel, kind: string): (new () => IView) | undefined {
  const definition = metamodel.elements.get(kind);
  if (!definition) return undefined;
  if (definition.category === 'actor') {
    return actorNodeView(ACTOR_DECORATOR[effectiveElementKind(metamodel, kind)]);
  }
  const effective = effectiveElementKind(metamodel, kind);
  const shape = definition.shape ?? BUILTIN_NODE_SHAPE[effective];
  if (shape) return pathNodeView(shape);
  if (effective === 'istar.Goal') return GoalNodeView;
  if (effective === 'istar.Resource') return RectangularNodeView;
  return undefined;
}

/** The view for link kind `kind`, or `undefined` to leave the framework's default in place. */
function edgeViewFor(metamodel: AnyMetamodel, kind: string): (new () => IView) | undefined {
  const definition = metamodel.links.get(kind);
  if (!definition) return undefined;
  const line = definition.line ?? BUILTIN_LINK_LINE[effectiveLinkKind(metamodel, kind)];
  const dependency = definition.category === 'dependency';
  if (!line && !dependency) return undefined;
  const marker =
    line && line.marker !== false
      ? { d: line.marker ?? OPEN_ARROW, filled: line.markerFilled === true }
      : undefined;
  return edgeView({
    ...(line?.dash ? { dash: line.dash } : {}),
    ...(marker ? { marker } : {}),
    dependency,
  });
}

/**
 * Overrides the view of every `node:*`/`edge:*` type this module knows how to draw
 * (`nodeViewFor`/`edgeViewFor`), over the default view `configureIstarModelElements`
 * (`elementTypes.ts`) just registered for it; a type without one keeps that default view.
 * `overrideModelElement`, not `configureModelElement`: the type is already registered, and
 * registering it again would warn ("implicit overwriting is deprecated").
 */
export function configureIstarViews(
  context: ModelElementBindingContext,
  metamodel: AnyMetamodel,
  types: readonly string[],
): void {
  for (const type of types) {
    if (type.startsWith('node:')) {
      const view = nodeViewFor(metamodel, type.slice('node:'.length));
      if (view) overrideModelElement(context, type, GNode, view);
    } else if (type.startsWith('edge:')) {
      const view = edgeViewFor(metamodel, type.slice('edge:'.length));
      if (view) overrideModelElement(context, type, GEdge, view);
    }
  }
}
