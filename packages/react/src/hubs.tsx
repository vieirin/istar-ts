/**
 * The circle of an n-ary link (DSM3-goals' "split link", e.g. a KAOS refinement): the element
 * its legs point at and its end leaves from. It has no name; its properties are the link's.
 */
import type { IstarElement } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useIstarEditor } from './context';
import { DiagnosticList, ElementPropertiesSection, topDiagnostics } from './Inspector';
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
 * Inspector of a hub: the link's title, its property fields (the hub kind's schema, else the
 * base link kind's), and deleting the whole link. No name or colour field, as DSM3 has none
 * for the circle.
 */
export function HubInspector(props: InspectorProps<IstarElement>): ReactElement {
  const { target, actions, readOnly, diagnostics } = props;
  const { registry, metamodel } = useIstarEditor();
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
      <ElementPropertiesSection {...props} {...(schema ? { schema } : {})} />
      {!readOnly && (
        <button type="button" className="istar-danger-button" onClick={actions.remove}>
          Delete {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
