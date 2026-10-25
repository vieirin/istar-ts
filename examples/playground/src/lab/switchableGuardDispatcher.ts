/**
 * Switching the guards switch (#47) on means recreating the dispatcher with `guards: [guard]` —
 * `createActionDispatcher`'s only seat for a guard (`packages/actions/src/dispatcher.ts`). The
 * model and the undo history both live in `store`, untouched by recreating the dispatcher over
 * it; this wrapper also keeps whatever already called `subscribe` across the swap.
 */
import { createActionDispatcher } from '@istar-ts/actions';
import type {
  ActionDispatcherOptions,
  ActionGuard,
  ActionListener,
  StoreActionDispatcher,
} from '@istar-ts/actions';
import type { ModelStore } from '@istar-ts/core';

export interface SwitchableGuardDispatcher extends StoreActionDispatcher {
  guardEnabled(): boolean;
  setGuardEnabled(enabled: boolean): void;
}

export function createSwitchableGuardDispatcher(
  store: ModelStore,
  guard: ActionGuard,
  options: Omit<ActionDispatcherOptions, 'guards'> = {},
): SwitchableGuardDispatcher {
  const listeners = new Set<ActionListener>();
  let disposers = new Map<ActionListener, () => void>();
  let enabled = false;
  let current: StoreActionDispatcher = createActionDispatcher(store, options);

  const rebuild = (): void => {
    current.dispose();
    current = createActionDispatcher(store, { ...options, guards: enabled ? [guard] : [] });
    disposers = new Map([...listeners].map((listener) => [listener, current.subscribe(listener)]));
  };

  return {
    guardEnabled: () => enabled,
    setGuardEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      rebuild();
    },
    dispatch(action) {
      return current.dispatch(action);
    },
    isDirty() {
      return current.isDirty();
    },
    dispose() {
      current.dispose();
    },
    subscribe(listener) {
      listeners.add(listener);
      disposers.set(listener, current.subscribe(listener));
      return () => {
        listeners.delete(listener);
        disposers.get(listener)?.();
        disposers.delete(listener);
      };
    },
  };
}
