import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ElementKind } from '@istar-ts/core';
import { useOptionalIstarEditor } from './context';
import type { AnyIstarRegistry, ElementComponentProps } from './registry';
import { ElementIssuesBadge } from './ElementIssuesBadge';
import { FULL_TEXT_BOX, FittedLabel } from './label-fit';
import { ActorSymbol, DEFAULT_SHAPES, DefaultNodeShape, PathShape } from './shapes';

export interface EditableLabelProps {
  readonly value: string;
  readonly editing: boolean;
  onCommit(value: string): void;
  onDone(): void;
  readonly className?: string;
}

/**
 * Element name that turns into a textarea while editing. Enter commits, Shift+Enter inserts a
 * line break, Escape cancels.
 */
export function EditableLabel(props: EditableLabelProps): ReactElement {
  if (!props.editing) {
    return <div className={`istar-label ${props.className ?? ''}`}>{props.value}</div>;
  }
  return <LabelEditor {...props} />;
}

function LabelEditor({ value, onCommit, onDone, className }: EditableLabelProps): ReactElement {
  // Mounted fresh for each edit, so the draft starts from the current value.
  const [draft, setDraft] = useState(value);
  const finish = (commit: boolean): void => {
    if (commit && draft !== value) onCommit(draft);
    onDone();
  };
  return (
    <textarea
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- editing starts on explicit user action
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      className={`istar-label-input nodrag nopan nowheel ${className ?? ''}`}
      value={draft}
      aria-label="Element name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

/**
 * piStar-like intentional element: the kind's shape with the name centred on it.
 *
 * The shape is the kind's registry `shape` (SVG path data) if it has one, else its piStar
 * shape; an extended kind with neither is drawn as piStar's default node, a dashed box with
 * the kind's «stereotype» above the name.
 */
export function DefaultElementComponent(props: ElementComponentProps): ReactElement {
  const { element, width, height, editing, setEditing, actions } = props;
  const editor = useOptionalIstarEditor();
  const config = (editor?.registry as AnyIstarRegistry | undefined)?.elements[element.kind];
  const fill = element.display?.backgroundColor;
  const builtIn = DEFAULT_SHAPES[element.kind as ElementKind];
  const stereotype =
    config?.stereotype === false
      ? undefined
      : (config?.stereotype ??
        (!config?.shape && !builtIn ? (config?.label ?? element.kind) : undefined));
  const header = [
    ...(stereotype ? [`«${stereotype}»`] : []),
    ...(config?.labelHeader?.(element) ?? []),
  ];
  return (
    <div className="istar-element-body" style={{ width, height }}>
      {config?.shape ? (
        <PathShape {...config.shape} width={width} height={height} fill={fill} />
      ) : builtIn ? (
        builtIn({ width, height, fill })
      ) : (
        <DefaultNodeShape width={width} height={height} fill={fill} />
      )}
      <FittedLabel
        name={element.name}
        header={header}
        {...(stereotype ? { firstHeaderClass: 'istar-stereotype' } : {})}
        textBox={config?.textBox ?? FULL_TEXT_BOX}
        fit={config?.labelFit ?? {}}
        editing={editing}
        height={height}
        onCommit={actions.rename}
        onDone={() => setEditing(false)}
        onGrow={(needed) => actions.setDisplay({ height: needed })}
      />
      <DiagnosticsBadge {...props} />
    </div>
  );
}

/**
 * piStar-like actor symbol: a circle (with Role/Agent decoration) holding the name. An
 * extended actor kind is drawn like the kind it behaves like, or as piStar's default
 * container: a dashed circle with its «stereotype».
 */
export function DefaultActorComponent(props: ElementComponentProps): ReactElement {
  const { element, editing, setEditing, actions } = props;
  const editor = useOptionalIstarEditor();
  const definition = editor?.metamodel.elements.get(element.kind);
  let symbolKind: string = element.kind;
  for (
    let current = definition;
    current?.behavesLike !== undefined;
    current = editor?.metamodel.elements.get(current.behavesLike)
  ) {
    symbolKind = current.behavesLike;
  }
  const extended = definition?.extension !== undefined;
  const config = (editor?.registry as AnyIstarRegistry | undefined)?.elements[element.kind];
  const stereotype =
    config?.stereotype === false
      ? undefined
      : (config?.stereotype ??
        (extended && !definition?.behavesLike ? definition?.label : undefined));
  const header = [
    ...(stereotype ? [`«${stereotype}»`] : []),
    ...(config?.labelHeader?.(element) ?? []),
  ];
  return (
    <div className="istar-actor-symbol-body">
      <ActorSymbol
        kind={symbolKind}
        fill={element.display?.backgroundColor}
        dashed={extended && !definition?.behavesLike}
      />
      <FittedLabel
        name={element.name}
        header={header}
        {...(stereotype ? { firstHeaderClass: 'istar-stereotype' } : {})}
        textBox={config?.textBox ?? FULL_TEXT_BOX}
        // The actor symbol has a fixed size: it can shrink its text, never grow.
        fit={config?.labelFit?.mode === 'grow' ? {} : (config?.labelFit ?? {})}
        editing={editing}
        height={props.height}
        onCommit={actions.rename}
        onDone={() => setEditing(false)}
      />
      <DiagnosticsBadge {...props} />
    </div>
  );
}

/**
 * The severity badge default components draw, unless the host turned badges off. A badge the
 * host draws in the same node (e.g. a component wrapping this one) hides it (see styles.css).
 */
function DiagnosticsBadge({ diagnostics, issues }: ElementComponentProps): ReactElement | null {
  const editor = useOptionalIstarEditor();
  if (editor?.diagnosticBadges === false) return null;
  return diagnostics ? (
    <ElementIssuesBadge diagnostics={diagnostics} className="istar-default-badge" />
  ) : (
    <ElementIssuesBadge issues={issues} className="istar-default-badge" />
  );
}
