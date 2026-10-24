import type { ActionDispatcher } from '@istar-ts/actions';
import type { AnyIstarModel } from '@istar-ts/core';
import type { Selection } from '@istar-ts/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { ActionLog } from './ActionLog';
import { ClientToggles } from './ClientToggles';
import { ScriptConsole } from './ScriptConsole';
import type { LogStore } from './log';
import type { TaggedDispatcher } from './tagClient';

type Tab = 'log' | 'toggles' | 'console';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'log', label: 'Action log' },
  { id: 'toggles', label: 'Client toggles' },
  { id: 'console', label: 'Script console' },
];

/**
 * #45's three parts of the protocol lab (#42 items 1–3): the action log, client toggles and
 * script console, as tabs over the same `log`/`dispatchers`/`scriptDispatcher` `App.tsx` wires up.
 */
export function ProtocolLab({
  log,
  dispatchers,
  scriptDispatcher,
  model,
  select,
}: {
  readonly log: LogStore;
  readonly dispatchers: readonly TaggedDispatcher[];
  readonly scriptDispatcher: ActionDispatcher;
  readonly model: AnyIstarModel;
  readonly select: (selection: Selection) => void;
}): ReactElement {
  const [tab, setTab] = useState<Tab>('log');
  return (
    <div className="pg-lab">
      <div className="pg-lab-tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'pg-lab-tab pg-lab-tab-active' : 'pg-lab-tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'log' && <ActionLog log={log} model={model} select={select} />}
      {tab === 'toggles' && <ClientToggles dispatchers={dispatchers} />}
      {tab === 'console' && <ScriptConsole dispatcher={scriptDispatcher} model={model} />}
    </div>
  );
}
