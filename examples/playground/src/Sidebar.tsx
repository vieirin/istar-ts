import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type { AnyIstarModel, PropertySchema } from '@istar-ts/core';
import { validateModel, validateModelProperties } from '@istar-ts/core';
import { IstarInspector, useIstarEditor } from '@istar-ts/react';
import type { ReactElement } from 'react';
import { ProtocolLab } from './lab/ProtocolLab';
import type { LogStore } from './lab/log';
import type { TaggedDispatcher } from './lab/tagClient';

export function Sidebar({
  model,
  schemas,
  log,
  dispatchers,
  scriptDispatcher,
  guardsEnabled,
  onToggleGuards,
  guardDescription,
  guards,
  agentDispatcher,
}: {
  readonly model: AnyIstarModel;
  /** Property schemas contributed by the active extension, if any. */
  readonly schemas: readonly PropertySchema[];
  readonly log: LogStore;
  readonly dispatchers: readonly TaggedDispatcher[];
  readonly scriptDispatcher: ActionDispatcher;
  readonly guardsEnabled: boolean;
  readonly onToggleGuards: (enabled: boolean) => void;
  readonly guardDescription: string;
  readonly guards: readonly ActionGuard[];
  readonly agentDispatcher: ActionDispatcher;
}): ReactElement {
  const issues = validateModel(model);
  const propertyIssues = validateModelProperties(model, schemas);
  const nameOf = (id: string): string => model.elements.get(id)?.name ?? id;
  const { select } = useIstarEditor();

  return (
    <div className="pg-aside">
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Inspector</h2>
        <IstarInspector className="pg-inspector" />
      </section>
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Protocol lab</h2>
        <ProtocolLab
          log={log}
          dispatchers={dispatchers}
          scriptDispatcher={scriptDispatcher}
          model={model}
          select={select}
          guardsEnabled={guardsEnabled}
          onToggleGuards={onToggleGuards}
          guardDescription={guardDescription}
          guards={guards}
          agentDispatcher={agentDispatcher}
        />
      </section>
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Validation</h2>
        {issues.length === 0 && propertyIssues.length === 0 ? (
          <p className="pg-aside-empty">No issues</p>
        ) : (
          <ul className="pg-issue-list">
            {issues.map((issue) => (
              <li key={issue.linkId}>{issue.message}</li>
            ))}
            {propertyIssues.map((issue) => (
              <li key={`${issue.id}:${issue.key}`}>
                {nameOf(issue.id)}: {issue.key} {issue.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Model</h2>
        <dl className="pg-stats">
          <div>
            <dt>Elements</dt>
            <dd>{model.elements.size}</dd>
          </div>
          <div>
            <dt>Links</dt>
            <dd>{model.links.size}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
