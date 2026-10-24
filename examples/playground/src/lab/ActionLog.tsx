import type { AnyIstarModel } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { LogEntry, LogStore } from './log';
import type { Selection } from '@istar-ts/react';

/** The element or link a row is about: the first created id, else the action's own target id. */
function subjectOf(entry: LogEntry): string | undefined {
  if (entry.result.ok && entry.result.createdIds.length > 0) return entry.result.createdIds[0];
  const { action } = entry;
  if ('elementId' in action) return action.elementId;
  if ('edgeElementId' in action) return action.edgeElementId;
  if ('hubId' in action) return action.hubId;
  if ('legId' in action) return action.legId;
  if ('elementIds' in action) return action.elementIds[0];
  if ('labelId' in action) return action.labelId.split('#')[0];
  return undefined;
}

function selectionFor(id: string, model: AnyIstarModel): Selection {
  if (model.elements.has(id)) return { type: 'element', id };
  if (model.links.has(id)) return { type: 'link', id };
  return null;
}

function payloadOf(action: LogEntry['action']): string {
  const text = JSON.stringify(action);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function resultOf(result: LogEntry['result']): string {
  if (result.ok)
    return result.createdIds.length > 0 ? `ok → ${result.createdIds.join(', ')}` : 'ok';
  return result.diagnostics.map((d) => d.message).join('; ');
}

export function ActionLog({
  log,
  model,
  select,
}: {
  readonly log: LogStore;
  readonly model: AnyIstarModel;
  readonly select: (selection: Selection) => void;
}): ReactElement {
  const entries = useSyncExternalStore(log.subscribe, log.getEntries, log.getEntries);
  const [clientFilter, setClientFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<string>('');

  const clients = useMemo(() => [...new Set(entries.map((e) => e.client))], [entries]);
  const kinds = useMemo(() => [...new Set(entries.map((e) => e.action.kind))], [entries]);
  const filtered = entries.filter(
    (e) =>
      (!clientFilter || e.client === clientFilter) && (!kindFilter || e.action.kind === kindFilter),
  );

  return (
    <div className="pg-lab-log">
      <div className="pg-lab-log-filters">
        <label>
          Client
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={log.clear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      {filtered.length === 0 ? (
        <p className="pg-aside-empty">No actions yet</p>
      ) : (
        <ul className="pg-lab-log-list">
          {filtered.map((entry) => {
            const subject = subjectOf(entry);
            return (
              <li
                key={entry.id}
                className={
                  entry.result.ok ? 'pg-lab-log-row' : 'pg-lab-log-row pg-lab-log-row-rejected'
                }
                onClick={subject ? () => select(selectionFor(subject, model)) : undefined}
              >
                <span className="pg-lab-log-client">{entry.client}</span>
                <span className="pg-lab-log-kind">{entry.action.kind}</span>
                <span className="pg-lab-log-payload">{payloadOf(entry.action)}</span>
                <span className="pg-lab-log-result">{resultOf(entry.result)}</span>
                <span className="pg-lab-log-duration">{entry.durationMs}ms</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
