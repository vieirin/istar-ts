import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ElementComponentProps } from './registry';
import { ActorSymbol, DEFAULT_SHAPES, GoalShape } from './shapes';

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
      ref={(el) => {
        el?.focus();
        el?.select();
      }}
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

/** piStar-like intentional element: the kind's shape with the name centred on it. */
export function DefaultElementComponent(props: ElementComponentProps): ReactElement {
  const { element, width, height, editing, setEditing, actions } = props;
  const Shape = DEFAULT_SHAPES[element.kind] ?? GoalShape;
  const fill = element.display?.backgroundColor;
  return (
    <div className="istar-element-body" style={{ width, height }}>
      <Shape width={width} height={height} fill={fill} />
      <EditableLabel
        value={element.name}
        editing={editing}
        onCommit={actions.rename}
        onDone={() => setEditing(false)}
      />
    </div>
  );
}

/** piStar-like actor symbol: a circle (with Role/Agent decoration) holding the name. */
export function DefaultActorComponent(props: ElementComponentProps): ReactElement {
  const { element, editing, setEditing, actions } = props;
  return (
    <div className="istar-actor-symbol-body">
      <ActorSymbol kind={element.kind} fill={element.display?.backgroundColor} />
      <EditableLabel
        value={element.name}
        editing={editing}
        onCommit={actions.rename}
        onDone={() => setEditing(false)}
      />
    </div>
  );
}
