import type { ReactElement } from 'react';

/**
 * The protocol lab's guards switch (#47, #42 item 6): one checkbox over a demo `ActionGuard`
 * (`guards.ts`). `App.tsx` owns the toggle's state and the dispatcher it switches
 * (`switchableGuardDispatcher.ts`); this component is just the control.
 */
export function GuardsSwitch({
  enabled,
  onToggle,
  description,
}: {
  readonly enabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly description: string;
}): ReactElement {
  return (
    <div className="pg-lab-guards">
      <label className="pg-lab-guards-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        {description}
      </label>
      <p className="pg-lab-hint">
        {enabled
          ? 'On — a dispatch that breaks the guard is rejected with its diagnostic, from every client.'
          : 'Off — every client dispatches freely.'}
      </p>
    </div>
  );
}
