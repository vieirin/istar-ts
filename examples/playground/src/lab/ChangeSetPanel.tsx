import type { ActionDispatcher, ActionGuard, ActionResult } from '@istar-ts/actions';
import type { AnyIstarModel } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import type { AgentStep, ChangeSetEntry } from './agent';
import { dryRun, planFor } from './agent';

function resultText(result: ActionResult<never>): string {
  if (result.ok)
    return result.createdIds.length > 0 ? `accept → ${result.createdIds.join(', ')}` : 'accept';
  return `reject — ${result.diagnostics.map((d) => d.message).join('; ')}`;
}

/**
 * The protocol lab's pseudo-agent change set (#47, #42 item 7): a scripted plan toward a
 * stated goal (`agent.ts`'s `planFor`), dry-run through the same guards the live dispatcher
 * would use, shown step by step as accept or reject. The user can drop steps before applying
 * the rest as one `compound` to `dispatcher` — one undo step.
 */
export function ChangeSetPanel({
  model,
  guards,
  dispatcher,
}: {
  readonly model: AnyIstarModel;
  readonly guards: readonly ActionGuard[];
  readonly dispatcher: ActionDispatcher;
}): ReactElement {
  const [plan] = useState(() => planFor());
  const [included, setIncluded] = useState<readonly boolean[]>(() => plan.steps.map(() => true));
  const [preview, setPreview] = useState<readonly ChangeSetEntry[] | null>(null);
  const [applied, setApplied] = useState<ActionResult<never> | null>(null);

  const selectedSteps = useMemo(
    () => plan.steps.filter((_, index) => included[index]),
    [plan, included],
  );
  const previewByStep = useMemo(() => {
    const map = new Map<AgentStep, ChangeSetEntry>();
    for (const entry of preview ?? []) map.set(entry.step, entry);
    return map;
  }, [preview]);

  const toggleStep = (index: number): void => {
    setIncluded((prev) => prev.map((value, i) => (i === index ? !value : value)));
    setPreview(null);
    setApplied(null);
  };

  const onDryRun = (): void => {
    setApplied(null);
    void dryRun(model, selectedSteps, guards).then(setPreview);
  };

  const onApply = (): void => {
    void dispatcher
      .dispatch({ kind: 'compound', operationList: selectedSteps.map((step) => step.operation) })
      .then((result) => {
        setApplied(result as ActionResult<never>);
        setPreview(null);
      });
  };

  return (
    <div className="pg-lab-agent">
      <p className="pg-lab-agent-goal">Goal: {plan.goal}</p>
      <ol className="pg-lab-agent-steps">
        {plan.steps.map((step, index) => {
          const entry = previewByStep.get(step);
          return (
            <li key={step.label} className="pg-lab-agent-step">
              <label>
                <input
                  type="checkbox"
                  checked={included[index]}
                  onChange={() => toggleStep(index)}
                />
                {step.label}
              </label>
              {entry && (
                <span className={entry.result.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>
                  {resultText(entry.result)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="pg-lab-agent-actions">
        <button type="button" onClick={onDryRun} disabled={selectedSteps.length === 0}>
          Dry run
        </button>
        <button type="button" onClick={onApply} disabled={preview === null}>
          Apply as one compound
        </button>
      </div>
      {applied && (
        <p className={applied.ok ? 'pg-lab-accept' : 'pg-lab-reject'}>
          {applied.ok
            ? 'Applied.'
            : `Rejected — ${applied.diagnostics.map((d) => d.message).join('; ')}`}
        </p>
      )}
    </div>
  );
}
