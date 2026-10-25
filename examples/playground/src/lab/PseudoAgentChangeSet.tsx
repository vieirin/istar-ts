import type { ActionDispatcher, ActionGuard, ActionResult } from '@istar-ts/actions';
import type { AnyIstarModel } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import type { ChangeSetEntry } from './agent';
import { dryRun, planFor } from './agent';
import { ChangeSetPanel, resultText } from './ChangeSetPanel';
import type { ChangeSetPreview } from './ChangeSetPanel';

/**
 * The protocol lab's pseudo-agent change set (#47, #42 item 7): a scripted plan toward a stated
 * goal (`agent.ts`'s `planFor`), dry-run through the same guards the live dispatcher would use,
 * shown step by step as accept or reject through `ChangeSetPanel`. The user can drop steps
 * before applying the rest as one `compound` to `dispatcher` — one undo step.
 */
export function PseudoAgentChangeSet({
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
  const previewMap = useMemo(() => {
    const map = new Map<string, ChangeSetPreview>();
    for (const entry of preview ?? []) {
      map.set(entry.step.label, { ok: entry.result.ok, text: resultText(entry.result) });
    }
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
    <ChangeSetPanel
      goal={plan.goal}
      hint="The plan's steps use fixed ids, so applying it a second time is rejected as a whole — a good demo of a refused compound."
      steps={plan.steps.map((step) => ({ key: step.label, label: step.label }))}
      included={included}
      onToggleStep={toggleStep}
      preview={preview ? previewMap : null}
      onDryRun={onDryRun}
      onApply={onApply}
      canApply={preview !== null}
      applied={
        applied
          ? {
              ok: applied.ok,
              text: applied.ok
                ? 'Applied.'
                : `Rejected — ${applied.diagnostics.map((d) => d.message).join('; ')}`,
            }
          : null
      }
    />
  );
}
