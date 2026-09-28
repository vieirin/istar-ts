import type { IstarModel } from '@istar-ts/core';
import { validateModel } from '@istar-ts/core';
import type { ReactElement } from 'react';

export function Sidebar({ model }: { readonly model: IstarModel }): ReactElement {
  const issues = validateModel(model);

  return (
    <aside className="pg-aside">
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Validation</h2>
        {issues.length === 0 ? (
          <p className="pg-aside-empty">No constraint issues</p>
        ) : (
          <ul className="pg-issue-list">
            {issues.map((issue) => (
              <li key={issue.linkId}>{issue.message}</li>
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
    </aside>
  );
}
