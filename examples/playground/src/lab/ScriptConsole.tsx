import type {
  ActionDispatcher,
  ActionResult,
  IstarAction,
  IstarOperation,
  IstarResponseAction,
} from '@istar-ts/actions';
import type { AnyIstarModel } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { SCRIPT_OPERATION_KINDS, templateFor } from './scriptKinds';

type Outcome = ActionResult<IstarResponseAction> | { readonly ok: false; readonly error: string };

/** JSON in, one action out: dispatches it through `dispatcher` (tagged "Script" in `App.tsx`). */
export function ScriptConsole({
  dispatcher,
  model,
}: {
  readonly dispatcher: ActionDispatcher;
  readonly model: AnyIstarModel;
}): ReactElement {
  const [kind, setKind] = useState<IstarOperation['kind']>(SCRIPT_OPERATION_KINDS[0]!);
  const [text, setText] = useState<string>(() =>
    JSON.stringify(templateFor(SCRIPT_OPERATION_KINDS[0]!, model), null, 2),
  );
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const onKindChange = (next: IstarOperation['kind']): void => {
    setKind(next);
    setText(JSON.stringify(templateFor(next, model), null, 2));
    setOutcome(null);
  };

  const onDispatch = async (): Promise<void> => {
    let action: IstarAction;
    try {
      action = JSON.parse(text) as IstarAction;
    } catch (error) {
      setOutcome({ ok: false, error: (error as Error).message });
      return;
    }
    setOutcome(await dispatcher.dispatch(action));
  };

  return (
    <div className="pg-lab-console">
      <label>
        Kind
        <select
          value={kind}
          onChange={(e) => onKindChange(e.target.value as IstarOperation['kind'])}
        >
          {SCRIPT_OPERATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <textarea
        className="pg-lab-console-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        spellCheck={false}
      />
      <button type="button" onClick={() => void onDispatch()}>
        Dispatch
      </button>
      {outcome && <pre className="pg-lab-console-outcome">{JSON.stringify(outcome, null, 2)}</pre>}
    </div>
  );
}
