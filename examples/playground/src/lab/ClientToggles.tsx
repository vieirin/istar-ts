import type { ReactElement } from 'react';
import { useState } from 'react';
import type { TaggedDispatcher } from './tagClient';

/**
 * One checkbox per client. Unchecking disables that client's wrapper (`tagClient`): it rejects
 * every further dispatch with a diagnostic, model untouched, while the other clients still
 * dispatch normally.
 */
export function ClientToggles({
  dispatchers,
}: {
  readonly dispatchers: readonly TaggedDispatcher[];
}): ReactElement {
  const [, forceRender] = useState(0);
  return (
    <ul className="pg-lab-toggles">
      {dispatchers.map((dispatcher) => (
        <li key={dispatcher.client}>
          <label>
            <input
              type="checkbox"
              checked={dispatcher.isEnabled()}
              onChange={(e) => {
                dispatcher.setEnabled(e.target.checked);
                forceRender((n) => n + 1);
              }}
            />
            {dispatcher.client}
          </label>
        </li>
      ))}
    </ul>
  );
}
