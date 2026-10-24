/**
 * Tags an `ActionDispatcher` with a client name for the protocol lab's log, and lets the lab
 * disable it (the client toggles tab): a disabled wrapper rejects every dispatch with a
 * diagnostic instead of delegating, so the model never sees it, while the other clients keep
 * working.
 *
 * The canvas and the inspector (`@istar-ts/react`'s `IstarInspector`) share whatever dispatcher
 * the provider is given — there's nothing in the actions or in `@istar-ts/react` to tell their
 * calls apart without changing that package (out of scope here), so both are tagged "UI". The
 * worker demo and the script console get their own wrapper over the same underlying dispatcher,
 * tagged at the one call site each already goes through in `App.tsx`.
 */
import type {
  ActionDispatcher,
  ActionListener,
  ActionResult,
  IstarAction,
  ResponseFor,
} from '@istar-ts/actions';
import type { ElementKind, LinkKind } from '@istar-ts/core';
import type { LogStore } from './log';

export interface TaggedDispatcher<
  EK extends string = ElementKind,
  LK extends string = LinkKind,
> extends ActionDispatcher<EK, LK> {
  readonly client: string;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

function disabledResult(client: string): ActionResult<never> {
  return {
    ok: false,
    diagnostics: [
      {
        elementId: '',
        severity: 'error',
        message: `${client} is disabled`,
        code: 'client-disabled',
      },
    ],
  };
}

export function tagClient<EK extends string = ElementKind, LK extends string = LinkKind>(
  dispatcher: ActionDispatcher<EK, LK>,
  client: string,
  log: LogStore,
): TaggedDispatcher<EK, LK> {
  let enabled = true;
  return {
    client,
    isEnabled: () => enabled,
    setEnabled: (next) => {
      enabled = next;
    },
    async dispatch<A extends IstarAction<EK, LK>>(action: A) {
      const startedAt = Date.now();
      if (!enabled) {
        const result = disabledResult(client);
        log.append({ client, action, result, startedAt, durationMs: 0 });
        return result as ActionResult<ResponseFor<A>>;
      }
      const result = await dispatcher.dispatch(action);
      log.append({ client, action, result, startedAt, durationMs: Date.now() - startedAt });
      return result;
    },
    subscribe(listener: ActionListener<EK, LK>) {
      return dispatcher.subscribe(listener);
    },
  };
}
