import type { ModelStore } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { LogEntry, LogStore } from './log';
import { exportLog, parseLogExport } from './log';
import { replayableEntries, replayLog } from './replayLog';
import type { ReplayOutcome } from './replayLog';

/** A replayable source: the live log, or a log imported from a file (#46's export/import). */
interface Source {
  readonly label: string;
  readonly initialModel: ReturnType<ModelStore<string, string>['getModel']>;
  readonly entries: readonly LogEntry[];
}

function resultLabel(step: ReplayOutcome['steps'][number]): string {
  if (step.skipped) return 'skipped';
  if (!step.result) return '';
  return step.result.ok
    ? 'ok'
    : `rejected: ${step.result.diagnostics.map((d) => d.message).join('; ')}`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The time-travel slider and export/import of #46 (#42 items 4–5): a preview store, replayed
 * from a `Source`'s initial model through a prefix of its entries, skipping whichever the user
 * toggled off. "Apply to canvas" loads the preview's model into the live editor's `store`
 * (a `load`, so `log.attachStore` starts the live log fresh from it — see lab/log.ts).
 */
export function Replay({
  log,
  store,
}: {
  readonly log: LogStore;
  readonly store: ModelStore<string, string>;
}): ReactElement {
  const liveEntries = useSyncExternalStore(log.subscribe, log.getEntries, log.getEntries);
  const [imported, setImported] = useState<Source | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Memoized: a fresh object every render would change identity even when nothing did, and the
  // effect below depends on it — an infinite render loop (fires, sets `outcome`, re-renders,
  // fires again), not just a wasted recompute.
  const initialModel = log.getInitialModel();
  const source: Source | null = useMemo(
    () =>
      imported ?? (initialModel ? { label: 'live log', initialModel, entries: liveEntries } : null),
    [imported, initialModel, liveEntries],
  );

  const entries = source ? replayableEntries(source.entries) : [];
  const [limit, setLimit] = useState(entries.length);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const clampedLimit = Math.min(limit, entries.length);
  const prefix = entries.slice(0, clampedLimit);

  const [outcome, setOutcome] = useState<ReplayOutcome | null>(null);
  useEffect(() => {
    if (!source) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    void replayLog(source.initialModel, prefix, skipped).then((result) => {
      if (!cancelled) setOutcome(result);
    });
    return () => {
      cancelled = true;
    };
    // `prefix` and `skipped` are recomputed above on every render that changes `limit`/`skipped`/`source`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, clampedLimit, skipped]);

  const toggleSkip = (id: number): void => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onExport = (): void => {
    download(`protocol-lab-log-${Date.now()}.json`, JSON.stringify(exportLog(log), null, 2));
  };

  const onImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const metamodel = metamodelOf(store.getModel());
      const parsed = parseLogExport(JSON.parse(await file.text()), metamodel);
      setImported({ label: file.name, initialModel: parsed.initialModel, entries: parsed.entries });
      setSkipped(new Set());
      setLimit(replayableEntries(parsed.entries).length);
    } catch (error) {
      setImportError((error as Error).message);
    }
  };

  const onApply = (): void => {
    if (outcome) store.load(outcome.model);
  };

  return (
    <div className="pg-lab-replay">
      <div className="pg-lab-replay-source">
        <span>Source: {source?.label ?? 'no initial model yet'}</span>
        {imported && (
          <button type="button" onClick={() => setImported(null)}>
            Back to live log
          </button>
        )}
      </div>
      <div className="pg-lab-replay-io">
        <button type="button" onClick={onExport} disabled={!log.getInitialModel()}>
          Export log…
        </button>
        <label className="pg-file-label">
          Import log…
          <input type="file" accept="application/json" onChange={(e) => void onImport(e)} />
        </label>
      </div>
      {importError !== null && <p className="pg-lab-replay-error">{importError}</p>}
      {entries.length === 0 ? (
        <p className="pg-aside-empty">No actions to replay</p>
      ) : (
        <>
          <label className="pg-lab-replay-slider">
            Replay up to {clampedLimit} / {entries.length}
            <input
              type="range"
              min={0}
              max={entries.length}
              value={clampedLimit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>
          <ul className="pg-lab-log-list">
            {prefix.map((entry) => {
              const step = outcome?.steps.find((s) => s.entry.id === entry.id);
              const rejected = step !== undefined && !step.skipped && step.result?.ok === false;
              return (
                <li
                  key={entry.id}
                  className={rejected ? 'pg-lab-log-row pg-lab-log-row-rejected' : 'pg-lab-log-row'}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={skipped.has(entry.id)}
                      onChange={() => toggleSkip(entry.id)}
                    />
                    Skip
                  </label>
                  <span className="pg-lab-log-kind">{entry.action.kind}</span>
                  <span className="pg-lab-log-result">{step ? resultLabel(step) : '…'}</span>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={onApply} disabled={!outcome}>
            Apply to canvas
          </button>
        </>
      )}
    </div>
  );
}
