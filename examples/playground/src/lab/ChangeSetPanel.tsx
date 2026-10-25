import type { ReactElement } from 'react';

/** One reviewable step: `key` identifies it for `included`/`preview` lookups, `label` is shown. */
export interface ChangeSetStepView {
  readonly key: string;
  readonly label: string;
}

export interface ChangeSetPreview {
  readonly ok: boolean;
  readonly text: string;
}

/** A dry-run or apply result's accept/reject line, from an `ActionResult`- or `ToolResult`-shaped value. */
export function resultText(result: {
  readonly ok: boolean;
  readonly createdIds?: readonly string[];
  readonly diagnostics?: readonly { readonly message: string }[];
}): string {
  if (result.ok) {
    return result.createdIds && result.createdIds.length > 0
      ? `accept → ${result.createdIds.join(', ')}`
      : 'accept';
  }
  return `reject — ${(result.diagnostics ?? []).map((d) => d.message).join('; ')}`;
}

/**
 * Review and apply a change set: checkbox steps with their dry-run outcome, an "Apply as one
 * compound" button. Driven entirely by props so a scripted pseudo-agent
 * (`PseudoAgentChangeSet.tsx`, #47, #42 item 7) and a real LLM agent's Propose mode (#126 D4) can
 * render through the same component — accept/reject-per-step behaves identically for both.
 * `onDryRun` is omitted when a caller's steps already carry their dry-run result (the LLM
 * agent's Propose mode dry-runs as part of the run itself, not as a separate UI step).
 */
export function ChangeSetPanel({
  goal,
  hint,
  steps,
  included,
  onToggleStep,
  preview,
  onDryRun,
  dryRunLabel = 'Dry run',
  onApply,
  applyLabel = 'Apply as one compound',
  canApply,
  applied,
}: {
  readonly goal?: string;
  readonly hint?: string;
  readonly steps: readonly ChangeSetStepView[];
  readonly included: readonly boolean[];
  readonly onToggleStep: (index: number) => void;
  readonly preview: ReadonlyMap<string, ChangeSetPreview> | null;
  readonly onDryRun?: () => void;
  readonly dryRunLabel?: string;
  readonly onApply: () => void;
  readonly applyLabel?: string;
  readonly canApply: boolean;
  readonly applied: ChangeSetPreview | null;
}): ReactElement {
  const selectedCount = included.filter(Boolean).length;
  return (
    <div className="pg-lab-agent">
      {goal !== undefined && <p className="pg-lab-agent-goal">Goal: {goal}</p>}
      {hint !== undefined && <p className="pg-lab-hint">{hint}</p>}
      <ol className="pg-lab-agent-steps">
        {steps.map((step, index) => {
          const entry = preview?.get(step.key);
          return (
            <li key={step.key} className="pg-lab-agent-step">
              <label>
                <input
                  type="checkbox"
                  checked={included[index] ?? false}
                  onChange={() => onToggleStep(index)}
                />
                {step.label}
              </label>
              {entry && (
                <span className={entry.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>{entry.text}</span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pg-lab-agent-actions">
        {onDryRun && (
          <button type="button" onClick={onDryRun} disabled={selectedCount === 0}>
            {dryRunLabel}
          </button>
        )}
        <button type="button" onClick={onApply} disabled={!canApply}>
          {applyLabel}
        </button>
      </div>
      {applied && <p className={applied.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>{applied.text}</p>}
    </div>
  );
}
