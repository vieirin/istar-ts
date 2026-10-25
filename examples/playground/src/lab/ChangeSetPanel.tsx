import type { ReactElement } from 'react';

/** One reviewable step: `key` identifies it for `included`/`preview` lookups, `label` is shown;
 * `detail` (e.g. the raw tool call as JSON) sits behind a disclosure. */
export interface ChangeSetStepView {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
}

/** A call the run made that is not a step (a read, a refusal), with its outcome. */
export interface ChangeSetContextView extends ChangeSetStepView {
  readonly outcome: ChangeSetPreview;
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
 * `context` lists the run's other calls (read-only, refused) in a collapsed section after the
 * steps: they are not part of the compound (#156).
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
  context,
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
  readonly context?: readonly ChangeSetContextView[];
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
              {step.detail !== undefined && <Detail text={step.detail} />}
            </li>
          );
        })}
      </ol>
      {context && context.length > 0 && (
        <details className="pg-lab-agent-context">
          <summary>
            Context: {context.length} {context.length === 1 ? 'call' : 'calls'} that changed nothing
            (reads, refusals), not part of the change set
          </summary>
          <ul>
            {context.map((item) => (
              <li key={item.key} className="pg-lab-agent-context-item">
                {item.label}{' '}
                <span className={item.outcome.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>
                  {item.outcome.text}
                </span>
                {item.detail !== undefined && <Detail text={item.detail} />}
              </li>
            ))}
          </ul>
        </details>
      )}
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

function Detail({ text }: { readonly text: string }): ReactElement {
  return (
    <details className="pg-lab-agent-detail">
      <summary>JSON</summary>
      <pre>{text}</pre>
    </details>
  );
}
