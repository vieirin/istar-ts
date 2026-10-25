import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type { AnyIstarModel, ModelStore } from '@istar-ts/core';
import type { Selection } from '@istar-ts/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { ActionLog } from './ActionLog';
import { ClientToggles } from './ClientToggles';
import { GuardsSwitch } from './GuardsSwitch';
import { PseudoAgentChangeSet } from './PseudoAgentChangeSet';
import { Replay } from './Replay';
import { ScriptConsole } from './ScriptConsole';
import type { LogStore } from './log';
import type { TaggedDispatcher } from './tagClient';

type Tab = 'log' | 'toggles' | 'console' | 'guards' | 'agent' | 'replay';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'log', label: 'Action log' },
  { id: 'toggles', label: 'Client toggles' },
  { id: 'console', label: 'Script console' },
  { id: 'guards', label: 'Guards' },
  { id: 'agent', label: 'Change set' },
  { id: 'replay', label: 'Replay' },
];

/**
 * The protocol lab's tabs (#42 items 1–3 from #45, 4–5 from #46, 6–7 from #47): the action log,
 * client toggles, script console, time-travel replay and log export/import, guards switch and
 * pseudo-agent change set, over the same `log`/`dispatchers`/`scriptDispatcher`/`store`
 * `App.tsx` wires up, plus the guards switch's own state and the dispatcher the change set
 * applies to.
 */
export function ProtocolLab({
  log,
  dispatchers,
  scriptDispatcher,
  model,
  store,
  select,
  guardsEnabled,
  onToggleGuards,
  guardDescription,
  guards,
  agentDispatcher,
}: {
  readonly log: LogStore;
  readonly dispatchers: readonly TaggedDispatcher[];
  readonly scriptDispatcher: ActionDispatcher;
  readonly model: AnyIstarModel;
  readonly store: ModelStore<string, string>;
  readonly select: (selection: Selection) => void;
  readonly guardsEnabled: boolean;
  readonly onToggleGuards: (enabled: boolean) => void;
  readonly guardDescription: string;
  readonly guards: readonly ActionGuard[];
  readonly agentDispatcher: ActionDispatcher;
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
      {tab === 'guards' && (
        <GuardsSwitch
          enabled={guardsEnabled}
          onToggle={onToggleGuards}
          description={guardDescription}
        />
      )}
      {tab === 'agent' && (
        <PseudoAgentChangeSet model={model} guards={guards} dispatcher={agentDispatcher} />
      )}
      {tab === 'replay' && <Replay log={log} store={store} />}
    </div>
  );
}
