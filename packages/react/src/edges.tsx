/**
 * Link rendering, after piStar's link shapes in `tool/language/shapes.js`.
 *
 * Edges float: they connect the borders of the two nodes (the actor circle for actors) along
 * the line between their centres, passing through any saved vertices.
 */
import type { IstarLink } from '@istar-ts/core';
import type { AnyMetamodel, LinkKind } from '@istar-ts/core';
import { LINK_KINDS, effectiveLinkKind, worstDiagnosticSeverity } from '@istar-ts/core';
import type { AnyIstarRegistry, IstarRegistry } from './registry';
import type { EdgeProps, EdgeTypes, InternalNode } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
import type { ComponentType, ReactElement } from 'react';
import { memo } from 'react';
import { useCanvasOptions } from './canvas-options';
import { useIstarEditor } from './context';
import { ElementIssuesBadge } from './ElementIssuesBadge';
import type { IstarFlowEdge } from './layout';
import { ACTOR_SYMBOL_OFFSET } from './layout';
import { ACTOR_RADIUS } from './shapes';
import type { Anchor, Point } from './link-geometry';
import { linkMidpoint, linkPath, pointAlong } from './link-geometry';

function anchorOf(node: InternalNode): Anchor {
  const pos = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  // A link anchor is a point: links that target a link end exactly on its middle.
  if (node.type === 'istarLinkAnchor') {
    return { center: { x: pos.x + width / 2, y: pos.y + height / 2 }, width: 0, height: 0 };
  }
  if (node.type === 'istarActor' && !(node.data as { frameless?: boolean }).frameless) {
    return {
      center: { x: pos.x + ACTOR_SYMBOL_OFFSET, y: pos.y + ACTOR_SYMBOL_OFFSET },
      radius: ACTOR_RADIUS,
      width,
      height,
    };
  }
  return { center: { x: pos.x + width / 2, y: pos.y + height / 2 }, width, height };
}

/**
 * Target markers in JointJS convention: (0,0) is the link end and +x points back along the
 * link towards the source.
 */
export const TARGET_MARKERS: Partial<Record<IstarLink['kind'], { d: string; filled: boolean }>> = {
  'istar.AndRefinementLink': { d: 'm 10,-6 l 0,12', filled: false },
  'istar.OrRefinementLink': { d: 'm 12,-6 l -12,6 12,6 z', filled: true },
  'istar.NeededByLink': { d: 'm 1,0 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0', filled: true },
  'istar.ContributionLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.IsALink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
  'istar.ParticipatesInLink': { d: 'm 10,-6 l -10,6 10,6', filled: false },
};

/** The marker of link kinds that have no style of their own: an open arrow. */
export const OPEN_ARROW = 'm 10,-6 l -10,6 10,6';

export interface ResolvedLinkStyle {
  readonly dash?: string;
  readonly marker?: { readonly d: string; readonly filled: boolean };
  /** Draw the dependency "D" (dependency-category kinds). */
  readonly dependency: boolean;
  /** The kind carries a selectable value (contribution), drawn near the source. */
  readonly changeableLabel: boolean;
  /** Fixed text at the middle (e.g. "is-a"). */
  readonly label?: string;
}

/**
 * How a link kind is drawn: its registry `line` if any; else the iStar 2.0 style of the kind
 * it behaves like; else (an extension kind with its own rules) a continuous line with an open
 * arrow, as piStar-ext draws new links by default.
 */
export function resolveLinkStyle(
  metamodel: AnyMetamodel,
  registry: IstarRegistry | AnyIstarRegistry,
  kind: string,
): ResolvedLinkStyle {
  const definition = metamodel.links.get(kind);
  const line = (registry as unknown as AnyIstarRegistry).links[kind]?.line;
  // An n-ary link's end draws like the link itself; its legs are plain lines into the hub.
  if (!line && definition?.role === 'end' && definition.of) {
    return resolveLinkStyle(metamodel, registry, definition.of);
  }
  if (!line && definition?.role === 'leg') {
    return { dependency: false, changeableLabel: false };
  }
  const effective = effectiveLinkKind(metamodel, kind) as LinkKind;
  const builtIn = (LINK_KINDS as readonly string[]).includes(effective);
  let dash: string | undefined;
  let marker: ResolvedLinkStyle['marker'];
  if (line) {
    dash = line.dash;
    marker =
      line.marker === false
        ? undefined
        : { d: line.marker ?? OPEN_ARROW, filled: line.markerFilled === true };
  } else if (builtIn) {
    dash = effective === 'istar.QualificationLink' ? '10,5' : undefined;
    marker = TARGET_MARKERS[effective];
  } else {
    marker = { d: OPEN_ARROW, filled: false };
  }
  return {
    ...(dash ? { dash } : {}),
    ...(marker ? { marker } : {}),
    dependency: definition?.category === 'dependency',
    changeableLabel: definition?.info.changeableLabel === true,
    ...(definition?.info.label ? { label: definition.info.label } : {}),
  };
}

/** The dependency "D", drawn at the middle of each half and facing the dependee. */
export const DEPENDENCY_D = 'm 0,-10 l 0,20 4,0 c 10,0, 10 -20, 0,-20 l -4,0';

export const IstarEdge: ComponentType<EdgeProps<IstarFlowEdge>> = memo(function IstarEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<IstarFlowEdge>): ReactElement | null {
  const { model, metamodel, registry, diagnosticsById, diagnosticBadges } = useIstarEditor();
  const { linkShape, linkNames } = useCanvasOptions();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // A link that targets a link ends on that link's live middle, so it follows while the
  // target link's nodes are dragged (the anchor node only moves once the drag is committed).
  const targetLink = data?.targetLinkEnds;
  const targetLinkSource = useInternalNode(targetLink?.source ?? '');
  const targetLinkTarget = useInternalNode(targetLink?.target ?? '');
  // The link as the GModel carries it (see `layout.ts`), not the model's.
  const link = data?.link;
  if (!sourceNode || !targetNode || !link) return null;

  const vertices = link.display?.vertices ?? [];
  const targetAnchor: Anchor =
    targetLink && targetLinkSource && targetLinkTarget
      ? {
          center: linkMidpoint(
            anchorOf(targetLinkSource),
            anchorOf(targetLinkTarget),
            targetLink.vertices,
            linkShape,
          ),
          width: 0,
          height: 0,
        }
      : anchorOf(targetNode);
  const { d: path, points } = linkPath(anchorOf(sourceNode), targetAnchor, vertices, linkShape);
  const end = points[points.length - 1]!;
  const beforeEnd = points[points.length - 2]!;
  const backAngle = (Math.atan2(beforeEnd.y - end.y, beforeEnd.x - end.x) * 180) / Math.PI;
  const style = resolveLinkStyle(metamodel, registry, link.kind);
  const linkConfig = (registry as unknown as AnyIstarRegistry).links[link.kind];
  const LabelComponent = linkConfig?.labelComponent;
  const header = linkConfig?.labelHeader?.(link) ?? [];
  const marker = style.marker;
  const middle = pointAlong(points, 0.5);
  const diagnostics = diagnosticsById.get(link.id);
  const severity = worstDiagnosticSeverity(diagnostics);
  const badge =
    diagnosticBadges && diagnostics ? (
      <ElementIssuesBadge diagnostics={diagnostics} className="istar-default-badge" />
    ) : null;

  return (
    <g
      className={`istar-link${selected ? ' is-selected' : ''}`}
      data-kind={link.kind}
      data-severity={severity}
    >
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        className="istar-link-line"
        style={style.dash ? { strokeDasharray: style.dash } : undefined}
      />
      {marker && (
        <path
          className={`istar-link-marker${marker.filled ? ' is-filled' : ''}`}
          d={marker.d}
          transform={`translate(${end.x} ${end.y}) rotate(${backAngle})`}
        />
      )}
      {style.dependency && (
        <path
          className="istar-link-dependency"
          d={DEPENDENCY_D}
          transform={`translate(${middle.x} ${middle.y}) rotate(${middle.angle})`}
        />
      )}
      {!LabelComponent && style.changeableLabel && link.label && (
        <LinkLabel at={pointAlong(points, 0.4)} text={link.label} className="is-contribution" />
      )}
      {!LabelComponent &&
        header.map((line, i) => (
          <LinkLabel
            key={`header-${i}`}
            // Stacked upwards above the middle label (or the middle, without one).
            at={{
              x: middle.x,
              y: (style.label ? middle.y - 14 : middle.y) - (header.length - 1 - i) * 13,
            }}
            text={line}
            className="is-header"
          />
        ))}
      {!LabelComponent && style.label && (
        <LinkLabel at={middle} text={style.label} className="is-actor-link" />
      )}
      {!LabelComponent && linkNames && link.name && (
        <LinkLabel
          // Below a fixed label at the middle, so both stay readable.
          at={style.label ? { x: middle.x, y: middle.y + 15 } : middle}
          text={link.name}
          className="is-name"
        />
      )}
      {LabelComponent && (
        <EdgeLabelRenderer>
          <div
            className="istar-link-label-slot nodrag nopan"
            data-link={link.id}
            style={{ transform: `translate(-50%, -50%) translate(${middle.x}px, ${middle.y}px)` }}
          >
            <LabelComponent
              link={link}
              model={model}
              metamodel={metamodel}
              selected={selected === true}
              labels={{
                ...(style.label ? { fixed: style.label } : {}),
                ...(style.changeableLabel && link.label ? { value: link.label } : {}),
                ...(link.name ? { name: link.name } : {}),
                ...(header.length > 0 ? { header } : {}),
              }}
              {...(diagnostics ? { diagnostics } : {})}
            />
            {badge}
          </div>
        </EdgeLabelRenderer>
      )}
      {!LabelComponent && badge && (
        <EdgeLabelRenderer>
          <div
            className="istar-link-diagnostics nodrag nopan"
            data-link={link.id}
            // Beside the middle label, up and to the right, so the label stays readable.
            style={{ transform: `translate(${middle.x + 6}px, ${middle.y - 22}px)` }}
          >
            {badge}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
});

function LinkLabel({
  at,
  text,
  className,
}: {
  at: Point;
  text: string;
  className: string;
}): ReactElement {
  return (
    <text
      className={`istar-link-label ${className}`}
      x={at.x}
      y={at.y}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {text}
    </text>
  );
}

export const edgeTypes: EdgeTypes = { istar: IstarEdge };
