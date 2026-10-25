/**
 * The agent drawer's toggle (#131 item 1): `AgentDrawer` and everything it imports
 * (`@istar-ts/agent`, `@istar-ts/glsp`'s MCP path, the MCP SDK) are only fetched once the user
 * opens it — a `React.lazy` boundary that never renders, not even in `Suspense`, until then, so
 * `/react.html`'s first-load bundle is unaffected (verified in the PR description).
 */
import type { ActionDispatcher, ActionGuard } from '@istar-ts/actions';
import type { ModelStore, PropertySchema } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { Suspense, lazy, useState } from 'react';
import type { GlspFramework } from './glspMcpBackend';

const AgentDrawer = lazy(() => import('./AgentDrawer'));

export function AgentPanel({
  store,
  dispatcher,
  guards,
  schemas,
  framework,
}: {
  readonly store: ModelStore<string, string>;
  /** The "Agent"-tagged dispatcher every applied edit goes through. */
  readonly dispatcher: ActionDispatcher<string, string>;
  readonly guards: readonly ActionGuard<string, string>[];
  readonly schemas: readonly PropertySchema[];
  readonly framework: GlspFramework;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="pg-agent-panel">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Close agent drawer' : 'Open agent drawer'}
      </button>
      {open && (
        <Suspense fallback={<p className="pg-lab-hint">Loading the agent drawer…</p>}>
          <AgentDrawer
            store={store}
            dispatcher={dispatcher}
            guards={guards}
            schemas={schemas}
            framework={framework}
          />
        </Suspense>
      )}
    </div>
  );
}
