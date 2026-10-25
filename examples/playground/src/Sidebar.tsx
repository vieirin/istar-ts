import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type {
  AnyIstarModel,
  AnyMetamodel,
  AnyPaletteDescription,
  ModelStore,
  PropertySchema,
} from '@istar-ts/core';
import { validateModel, validateModelProperties } from '@istar-ts/core';
import { IstarInspector, useIstarEditor } from '@istar-ts/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { AgentPanel } from './agent/AgentPanel';
import { ProtocolLab } from './lab/ProtocolLab';
import type { LogStore } from './lab/log';
import type { TaggedDispatcher } from './lab/tagClient';

const INSPECTOR_WIDTH_STORAGE_KEY = 'istar-ts-playground:inspectorWidth';

function loadInspectorWidth(): number | undefined {
  const stored = Number(localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : undefined;
}

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
  store,
  agentMetamodel,
  agentPalette,
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
  readonly store: ModelStore<string, string>;
  /** The active model's own metamodel, for the agent drawer's backend A contribution. */
  readonly agentMetamodel: AnyMetamodel;
  /** The active extension's own palette, if it has one. */
  readonly agentPalette?: AnyPaletteDescription;
}): ReactElement {
  const issues = validateModel(model);
  const propertyIssues = validateModelProperties(model, schemas);
  const nameOf = (id: string): string => model.elements.get(id)?.name ?? id;
  const { select } = useIstarEditor();
  const [inspectorWidth, setInspectorWidth] = useState(loadInspectorWidth);
  const onInspectorWidthChange = (width: number): void => {
    setInspectorWidth(width);
    localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(width));
  };

  return (
    <div className="pg-aside">
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Inspector</h2>
        <IstarInspector
          className="pg-inspector"
          inspectorWidth={inspectorWidth}
          onInspectorWidthChange={onInspectorWidthChange}
        />
      </section>
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Protocol lab</h2>
        <ProtocolLab
          log={log}
          dispatchers={dispatchers}
          scriptDispatcher={scriptDispatcher}
          model={model}
          store={store}
          select={select}
          guardsEnabled={guardsEnabled}
          onToggleGuards={onToggleGuards}
          guardDescription={guardDescription}
          guards={guards}
          agentDispatcher={agentDispatcher}
        />
      </section>
      <section className="pg-aside-section">
        <h2 className="pg-aside-heading">Agent</h2>
        <AgentPanel
          store={store}
          dispatcher={agentDispatcher as ActionDispatcher<string, string>}
          guards={guards as readonly ActionGuard<string, string>[]}
          schemas={schemas}
          metamodel={agentMetamodel}
          palette={agentPalette}
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
