/**
 * The circle of an n-ary link (DSM3-goals' "split link", e.g. a KAOS refinement): the element
 * its legs point at and its end leaves from. It has no name; its properties are the link's.
 */
import type { IstarElement, IstarLink } from '@istar-ts/core';
import { hubLinkOf, hubOfLink } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useIstarEditor } from './context';
import {
  DefaultLinkInspector,
  DiagnosticList,
  ElementPropertiesSection,
  PropertiesSection,
  topDiagnostics,
} from './Inspector';
import type { AnyIstarRegistry, ElementComponentProps, InspectorProps } from './registry';

/** DSM3's hub: a white circle of radius 10 in its 20×20 box, scaled to the element. */
export function HubComponent({ width, height, element }: ElementComponentProps): ReactElement {
  const r = Math.max(1, Math.min(width, height) / 2 - 1);
  return (
    <div className="istar-element-body istar-hub" style={{ width, height }}>
      <svg
        className="istar-shape"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
      >
        <circle
          cx={width / 2}
          cy={height / 2}
          r={r}
          fill={element.display?.backgroundColor ?? 'var(--istar-canvas-bg, #fff)'}
          style={{
            stroke: 'var(--istar-node-stroke)',
            strokeWidth: 'var(--istar-stroke-width)',
            vectorEffect: 'non-scaling-stroke',
          }}
        />
      </svg>
    </div>
  );
}

/**
 * Inspector of a hub, standing for its whole n-ary link: the link's title, its sources (one per
 * leg, in link order) and target, its property fields (the hub kind's schema, else the base
 * link kind's), and deleting the whole link. No name or colour field, as DSM3 has none
 * for the circle.
 */
export function HubInspector(props: InspectorProps<IstarElement>): ReactElement {
  const { target, actions, readOnly, diagnostics } = props;
  const { registry, metamodel, model } = useIstarEditor();
  const parts = hubLinkOf(model, target.id);
  const nameOf = (id: string): string => model.elements.get(id)?.name ?? id;
  const label = registry.elements[target.kind].label;
  // The hub keeps the link's properties: the hub kind's schema, else the base link kind's.
  const of = metamodel.elements.get(target.kind)?.of;
  const schema: InspectorProps['schema'] =
    props.schema ??
    ((of ? (registry as unknown as AnyIstarRegistry).links[of]?.properties : undefined) as
      | InspectorProps['schema']
      | undefined);
  return (
    <div className="istar-inspector-body istar-hub-inspector">
      <h3 className="istar-inspector-title">{label}</h3>
      <DiagnosticList
        diagnostics={topDiagnostics(diagnostics, schema, target)}
        showKey
        className="istar-inspector-diagnostics"
      />
      <dl className="istar-hub-ends">
        <dt>Sources</dt>
        <dd>
          {parts && parts.legs.length > 0 ? (
            <ul className="istar-hub-sources">
              {parts.legs.map((leg) => (
                <li key={leg.id}>{nameOf(leg.source)}</li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </dd>
        <dt>Target</dt>
        <dd className="istar-hub-target">{parts?.end ? nameOf(parts.end.target) : '—'}</dd>
      </dl>
      <ElementPropertiesSection {...props} {...(schema ? { schema } : {})} />
      {!readOnly && (
        <button type="button" className="istar-danger-button" onClick={actions.remove}>
          Delete {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}

/**
 * Inspector of a hub link's leg or end: the hub's, since both are pieces of one n-ary link
 * (selecting either inspects the link as a whole), then the selected part's own properties
 * under its kind's schema (e.g. a probability per leg of a case-driven KAOS refinement). Falls
 * back to the default link inspector for a leg or end without a hub.
 */
export function HubPartInspector(props: InspectorProps<IstarLink>): ReactElement {
  const editor = useIstarEditor();
  const hub = hubOfLink(editor.model, props.target.id);
  if (!hub) return <DefaultLinkInspector {...props} />;
  const config = editor.registry.elements[hub.kind];
  const part = props.target;
  const partLabel = editor.registry.links[part.kind]?.label ?? part.kind;
  const from = editor.model.elements.get(part.source);
  const isLeg = part.target === hub.id;
  return (
    <>
      <HubInspector
        key={hub.id}
        target={hub}
        model={editor.model}
        actions={editor.elementActions(hub.id)}
        readOnly={props.readOnly}
        {...(config?.properties ? { schema: config.properties as InspectorProps['schema'] } : {})}
        issues={editor.issuesById.get(hub.id) ?? []}
        diagnostics={editor.diagnosticsById.get(hub.id) ?? []}
      />
      <div className="istar-inspector-body istar-hub-part">
        <h4 className="istar-inspector-subtitle">
          {partLabel}
          {isLeg && from ? `: ${from.name}` : ''}
        </h4>
        <PropertiesSection
          target={part}
          actions={props.actions}
          readOnly={props.readOnly}
          schema={props.schema}
          diagnostics={props.diagnostics}
        />
      </div>
    </>
  );
}
