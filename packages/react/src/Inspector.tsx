import type {
  CustomProperties,
  IstarElement,
  IstarLink,
  PropertyIssue,
  PropertySchema,
  PropertyType,
} from '@istar-ts/core';
import { CONTRIBUTION_LABELS } from '@istar-ts/core';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useId, useState } from 'react';
import { useIstarEditor } from './context';
import type { InspectorProps } from './registry';

export interface IstarInspectorProps {
  readonly className?: string;
  /** Shown when nothing is selected. */
  readonly empty?: ReactNode;
}

/**
 * Side panel for the selected element or link. Uses the kind's registry `inspector` if set,
 * the default inspector otherwise, and nothing when the registry sets `inspector: false`.
 */
export function IstarInspector({ className, empty }: IstarInspectorProps): ReactElement {
  const editor = useIstarEditor();
  const { selection, model, registry, readOnly } = editor;
  const classes = `istar-inspector${className ? ` ${className}` : ''}`;

  const element = selection?.type === 'element' ? model.elements.get(selection.id) : undefined;
  const link = selection?.type === 'link' ? model.links.get(selection.id) : undefined;

  let content: ReactNode = empty ?? (
    <p className="istar-inspector-empty">Select an element or link to edit it.</p>
  );
  if (element) {
    const config = registry.elements[element.kind];
    const Custom = config.inspector === undefined ? DefaultElementInspector : config.inspector;
    content = Custom ? (
      <Custom
        key={element.id}
        target={element}
        model={model}
        actions={editor.elementActions(element.id)}
        readOnly={readOnly}
        schema={config.properties as PropertySchema | undefined}
        issues={editor.issuesById.get(element.id) ?? []}
      />
    ) : null;
  } else if (link) {
    const config = registry.links[link.kind];
    const Custom = config.inspector === undefined ? DefaultLinkInspector : config.inspector;
    content = Custom ? (
      <Custom
        key={link.id}
        target={link}
        model={model}
        actions={editor.linkActions(link.id)}
        readOnly={readOnly}
        schema={config.properties as PropertySchema | undefined}
        issues={editor.issuesById.get(link.id) ?? []}
      />
    ) : null;
  }
  return (
    <aside className={classes} aria-label="Inspector">
      {content}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Building blocks for custom inspectors

export interface CommitTextProps {
  readonly id?: string;
  readonly value: string;
  onCommit(value: string): void;
  readonly multiline?: boolean;
  readonly type?: 'text' | 'number';
  readonly readOnly?: boolean;
  readonly placeholder?: string;
  readonly step?: number | 'any';
  readonly min?: number;
  readonly max?: number;
  readonly 'aria-label'?: string;
}

/**
 * A text input that commits on blur or Enter (Shift+Enter for a newline when multiline), so
 * typing produces one undo step instead of one per keystroke. It resets when `value` changes
 * from outside.
 */
export function CommitText(props: CommitTextProps): ReactElement {
  return <CommitTextInner key={props.value} {...props} />;
}

function CommitTextInner({
  value,
  onCommit,
  multiline,
  type,
  ...rest
}: CommitTextProps): ReactElement {
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  const common = {
    ...rest,
    value: draft,
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        setDraft(value);
      }
    },
  };
  return multiline ? (
    <textarea
      {...common}
      rows={draft.includes('\n') ? 3 : 2}
      onChange={(e) => setDraft(e.target.value)}
    />
  ) : (
    <input {...common} type={type ?? 'text'} onChange={(e) => setDraft(e.target.value)} />
  );
}

/** A labelled row in the inspector. */
export function InspectorField({
  label,
  htmlFor,
  issue,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  issue?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={`istar-field${issue ? ' has-issue' : ''}`}>
      <label className="istar-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {issue && <div className="istar-field-issue">{issue}</div>}
    </div>
  );
}

export interface PropertyFieldProps {
  readonly name: string;
  readonly type: PropertyType<unknown>;
  /** The raw (string) value from customProperties. */
  readonly value: string | undefined;
  onChange(raw: string | undefined): void;
  readonly issue?: string;
  readonly readOnly?: boolean;
}

/**
 * Edits one customProperties entry according to its schema type: a select for enums, a
 * checkbox for booleans, a number input for numbers, a text input otherwise. Values are always
 * written back as strings, as piStar stores them.
 */
export function PropertyField({
  name,
  type,
  value,
  onChange,
  issue,
  readOnly,
}: PropertyFieldProps): ReactElement {
  const id = useId();
  const label = type.options.label ?? name;
  const optional = type.options.optional === true || type.options.default !== undefined;
  let input: ReactElement;
  if (type.type === 'boolean') {
    input = (
      <input
        id={id}
        type="checkbox"
        checked={value === 'true'}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
      />
    );
  } else if (type.type === 'enum') {
    input = (
      <select
        id={id}
        value={value ?? ''}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        {(value === undefined || optional) && <option value="">—</option>}
        {type.values?.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {value !== undefined && value !== '' && !type.values?.includes(value) && (
          <option value={value}>{value} (invalid)</option>
        )}
      </select>
    );
  } else {
    input = (
      <CommitText
        id={id}
        type={type.type === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        step={type.integer ? 1 : 'any'}
        min={type.min}
        max={type.max}
        readOnly={readOnly}
        placeholder={type.options.default !== undefined ? String(type.options.default) : undefined}
        onCommit={(raw) => onChange(raw === '' && optional ? undefined : raw)}
      />
    );
  }
  return (
    <InspectorField label={label} htmlFor={id} issue={issue}>
      {input}
      {type.options.description && (
        <div className="istar-field-description">{type.options.description}</div>
      )}
    </InspectorField>
  );
}

/**
 * Typed view of an element's or link's customProperties for a schema: parsed values, issues
 * (including cross-field rules) and a setter that writes strings back.
 */
export function useTypedProperties(
  schema: PropertySchema | undefined,
  target: IstarElement | IstarLink,
  actions: { setProperties(patch: Readonly<Record<string, string | undefined>>): void },
): {
  values: Readonly<Record<string, unknown>>;
  issues: readonly PropertyIssue[];
  issueFor(key: string): string | undefined;
  setRaw(key: string, raw: string | undefined): void;
} {
  const read = schema ? schema.read(target.customProperties) : { values: {}, issues: [] };
  const issues = schema ? schema.validate(target.customProperties) : [];
  return {
    values: read.values,
    issues,
    issueFor: (key) =>
      issues
        .filter((i) => i.key === key)
        .map((i) => i.message)
        .join('; ') || undefined,
    setRaw: (key, raw) => actions.setProperties({ [key]: raw }),
  };
}

/** Free-form editor for the custom properties not covered by a schema. */
export function CustomPropertiesEditor({
  properties,
  exclude = [],
  onChange,
  readOnly,
}: {
  properties: CustomProperties | undefined;
  exclude?: readonly string[];
  onChange(patch: Readonly<Record<string, string | undefined>>): void;
  readOnly?: boolean;
}): ReactElement {
  const [newKey, setNewKey] = useState('');
  const entries = Object.entries(properties ?? {}).filter(([key]) => !exclude.includes(key));
  const keyTaken = newKey in (properties ?? {});
  return (
    <div className="istar-custom-properties">
      {entries.map(([key, value]) => (
        <div className="istar-custom-property" key={key}>
          <label className="istar-field-label" htmlFor={`prop-${key}`}>
            {key}
          </label>
          <CommitText
            id={`prop-${key}`}
            multiline
            value={value}
            readOnly={readOnly}
            onCommit={(next) => onChange({ [key]: next })}
          />
          {!readOnly && (
            <button
              type="button"
              className="istar-icon-button"
              aria-label={`Remove property ${key}`}
              onClick={() => onChange({ [key]: undefined })}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <form
          className="istar-custom-property-add"
          onSubmit={(e) => {
            e.preventDefault();
            const key = newKey.trim();
            if (!key || keyTaken) return;
            onChange({ [key]: '' });
            setNewKey('');
          }}
        >
          <input
            aria-label="New property name"
            placeholder="New property"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <button type="submit" disabled={!newKey.trim() || keyTaken}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Default inspectors

export function DefaultElementInspector({
  target,
  actions,
  readOnly,
  schema,
}: InspectorProps<IstarElement>): ReactElement {
  const { registry, metamodel } = useIstarEditor();
  const nameId = useId();
  const colorId = useId();
  const typed = useTypedProperties(schema, target, actions);
  const schemaKeys = schema ? Object.keys(schema.shape) : [];
  const crossIssues = typed.issues.filter((i) => !schemaKeys.includes(i.key));
  const kindLabel = registry.elements[target.kind].label;
  return (
    <div className="istar-inspector-body">
      <h3 className="istar-inspector-title">
        {kindLabel}
        {target.isDependum ? ' (dependum)' : ''}
      </h3>
      <InspectorField label="Name" htmlFor={nameId}>
        <CommitText
          id={nameId}
          multiline
          value={target.name}
          readOnly={readOnly}
          onCommit={actions.rename}
        />
      </InspectorField>
      {schemaKeys.map((key) => (
        <PropertyField
          key={key}
          name={key}
          type={schema!.shape[key]!}
          value={target.customProperties?.[key]}
          issue={typed.issueFor(key)}
          readOnly={readOnly}
          onChange={(raw) => typed.setRaw(key, raw)}
        />
      ))}
      {crossIssues.map((issue) => (
        <div className="istar-field-issue" key={`${issue.key}:${issue.message}`}>
          {issue.key}: {issue.message}
        </div>
      ))}
      <h4 className="istar-inspector-subtitle">
        {schemaKeys.length > 0 ? 'Other properties' : 'Properties'}
      </h4>
      <CustomPropertiesEditor
        properties={target.customProperties}
        exclude={schemaKeys}
        onChange={actions.setProperties}
        readOnly={readOnly}
      />
      <InspectorField label="Color" htmlFor={colorId}>
        <div className="istar-color-field">
          <input
            id={colorId}
            type="color"
            value={normalizeColor(
              target.display?.backgroundColor,
              metamodel.elements.get(target.kind)?.category === 'actor',
            )}
            disabled={readOnly}
            onChange={(e) => actions.setDisplay({ backgroundColor: e.target.value })}
          />
          {target.display?.backgroundColor !== undefined && !readOnly && (
            // Like piStar, the default colour is stored as no colour at all.
            <button
              type="button"
              className="istar-icon-button"
              onClick={() => actions.setDisplay({ backgroundColor: undefined })}
            >
              Reset to default
            </button>
          )}
        </div>
      </InspectorField>
      {!readOnly && (
        <button type="button" className="istar-danger-button" onClick={actions.remove}>
          Delete {kindLabel.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function normalizeColor(color: string | undefined, actor: boolean): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
  return actor ? '#f2f2f2' : '#cdfecd';
}

export function DefaultLinkInspector({
  target,
  actions,
  readOnly,
  schema,
}: InspectorProps<IstarLink>): ReactElement {
  const { registry, model, metamodel } = useIstarEditor();
  // A kind with a selectable value (Contribution, or an extended kind with possibleLabels).
  const info = metamodel.links.get(target.kind)?.info;
  const values = info?.changeableLabel ? (info.possibleLabels ?? CONTRIBUTION_LABELS) : undefined;
  const labelId = useId();
  const nameId = useId();
  const typed = useTypedProperties(schema, target, actions);
  const schemaKeys = schema ? Object.keys(schema.shape) : [];
  const source = model.elements.get(target.source)?.name ?? target.source;
  const destination = model.elements.get(target.target)?.name ?? target.target;
  return (
    <div className="istar-inspector-body">
      <h3 className="istar-inspector-title">{registry.links[target.kind].label}</h3>
      <p className="istar-inspector-endpoints">
        {source} → {destination}
      </p>
      {/* piStar's properties panel shows a Name for links too (it isn't drawn on the canvas). */}
      <InspectorField label="Name" htmlFor={nameId}>
        <CommitText
          id={nameId}
          value={target.name ?? ''}
          readOnly={readOnly}
          onCommit={(name) => actions.setName(name === '' ? undefined : name)}
        />
      </InspectorField>
      {values && (
        <InspectorField
          label={metamodel.links.get(target.kind)?.label ?? 'Value'}
          htmlFor={labelId}
        >
          <select
            id={labelId}
            value={target.label ?? ''}
            disabled={readOnly}
            onChange={(e) => actions.setLabel(e.target.value || undefined)}
          >
            <option value="">—</option>
            {values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </InspectorField>
      )}
      {schemaKeys.map((key) => (
        <PropertyField
          key={key}
          name={key}
          type={schema!.shape[key]!}
          value={target.customProperties?.[key]}
          issue={typed.issueFor(key)}
          readOnly={readOnly}
          onChange={(raw) => typed.setRaw(key, raw)}
        />
      ))}
      <h4 className="istar-inspector-subtitle">Properties</h4>
      <CustomPropertiesEditor
        properties={target.customProperties}
        exclude={schemaKeys}
        onChange={actions.setProperties}
        readOnly={readOnly}
      />
      {!readOnly && (
        <button type="button" className="istar-danger-button" onClick={actions.remove}>
          Delete link
        </button>
      )}
    </div>
  );
}
