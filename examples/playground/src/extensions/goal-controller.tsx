import type { IstarElement } from '@istar-ts/core';
import { defineProperties, prop } from '@istar-ts/core';
import type { ElementComponentProps, InspectorProps, IstarExtension } from '@istar-ts/react';
import {
  CommitText,
  CustomPropertiesEditor,
  DefaultElementComponent,
  InspectorField,
  useTypedProperties,
} from '@istar-ts/react';
import type { ReactElement } from 'react';
import { useId } from 'react';

/**
 * Example extension for goal-controller (https://github.com/vieirin/goal-controller) models,
 * where resources are variables: `type` is "bool" or "int" and `initialValue` must match it.
 * Values stay strings on disk, as piStar stores them.
 *
 * Nothing here is part of @istar-ts/*: it only uses the public extension API, the same way an
 * extension for any other modeller would.
 */
export const resourceProperties = defineProperties(
  'istar.Resource',
  {
    type: prop.enum(['bool', 'int'], { default: 'bool', label: 'Type' }),
    initialValue: prop.string({ default: 'false', label: 'Initial value' }),
  },
  {
    validate({ type, initialValue }) {
      if (initialValue === undefined) return [];
      if (type === 'bool' && initialValue !== 'true' && initialValue !== 'false') {
        return [{ key: 'initialValue', message: 'must be true or false for a bool resource' }];
      }
      if (type === 'int' && !/^-?\d+$/.test(initialValue)) {
        return [{ key: 'initialValue', message: 'must be an integer for an int resource' }];
      }
      return [];
    },
  },
);

/** The default Resource shape plus a badge showing the variable's type and initial value. */
function ResourceNode(props: ElementComponentProps): ReactElement {
  const { values, issues } = useTypedProperties(resourceProperties, props.element, props.actions);
  return (
    <div className="pg-resource">
      <DefaultElementComponent {...props} />
      <span className={`pg-resource-badge${issues.length > 0 ? ' has-issue' : ''}`}>
        {String(values.type ?? '?')} = {String(values.initialValue ?? '?')}
      </span>
    </div>
  );
}

/** Inspector that adapts the initial value input to the selected type. */
function ResourceInspector({
  target,
  actions,
  readOnly,
}: InspectorProps<IstarElement>): ReactElement {
  const ids = { name: useId(), type: useId(), value: useId() };
  const { values, issueFor } = useTypedProperties(resourceProperties, target, actions);
  const type = values.type === 'int' ? 'int' : 'bool';
  const raw = target.customProperties?.initialValue ?? '';

  const setType = (next: 'bool' | 'int'): void => {
    if (next === type) return;
    // Convert the initial value so the pair stays valid: false/true <-> 0/1.
    const converted =
      next === 'int' ? (raw === 'true' ? '1' : '0') : raw !== '' && raw !== '0' ? 'true' : 'false';
    actions.setProperties({ type: next, initialValue: converted });
  };

  return (
    <div className="istar-inspector-body">
      <h3 className="istar-inspector-title">Resource variable</h3>
      <InspectorField label="Name" htmlFor={ids.name}>
        <CommitText
          id={ids.name}
          value={target.name}
          onCommit={actions.rename}
          readOnly={readOnly}
        />
      </InspectorField>
      <InspectorField label="Type" htmlFor={ids.type} issue={issueFor('type')}>
        <select
          id={ids.type}
          value={type}
          disabled={readOnly}
          onChange={(e) => setType(e.target.value as 'bool' | 'int')}
        >
          <option value="bool">bool</option>
          <option value="int">int</option>
        </select>
      </InspectorField>
      <InspectorField label="Initial value" htmlFor={ids.value} issue={issueFor('initialValue')}>
        {type === 'bool' ? (
          <label className="pg-checkbox">
            <input
              id={ids.value}
              type="checkbox"
              checked={raw === 'true'}
              disabled={readOnly}
              onChange={(e) => actions.setProperties({ initialValue: String(e.target.checked) })}
            />
            {raw === 'true' ? 'true' : 'false'}
          </label>
        ) : (
          <CommitText
            id={ids.value}
            type="number"
            step={1}
            value={raw}
            readOnly={readOnly}
            onCommit={(v) => actions.setProperties({ initialValue: v })}
          />
        )}
      </InspectorField>
      <h4 className="istar-inspector-subtitle">Other properties</h4>
      <CustomPropertiesEditor
        properties={target.customProperties}
        exclude={['type', 'initialValue']}
        onChange={actions.setProperties}
        readOnly={readOnly}
      />
      {!readOnly && (
        <button type="button" className="istar-danger-button" onClick={actions.remove}>
          Delete resource
        </button>
      )}
    </div>
  );
}

export const goalControllerExtension: IstarExtension = {
  name: 'goal-controller',
  elements: {
    'istar.Resource': {
      properties: resourceProperties,
      component: ResourceNode,
      inspector: ResourceInspector,
      palette: {
        label: 'Variable',
        title: 'Adding Variable: click on an actor to add a bool/int resource',
      },
    },
  },
};

/** Property schemas this extension validates, for the sidebar's issue list. */
export const goalControllerSchemas = [resourceProperties];
