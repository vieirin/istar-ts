import type { IstarModel, PropertySchema } from '@istar-ts/core';
import { validateModel, validateModelProperties } from '@istar-ts/core';
import { IstarInspector } from '@istar-ts/react';
import type { ReactElement } from 'react';

export function Sidebar({
  model,
  schemas,
}: {
  readonly model: IstarModel;
  /** Property schemas contributed by the active extension, if any. */
  readonly schemas: readonly PropertySchema[];
}): ReactElement {
  const issues = validateModel(model);
  const propertyIssues = validateModelProperties(model, schemas);
  const nameOf = (id: string): string => model.elements.get(id)?.name ?? id;

  return (
    <div className="pg-aside">
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Inspector</h2>
        <IstarInspector className="pg-inspector" />
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
