/**
 * BYOK key handling (#126 §7, #131 item 2): in memory by default, an explicit opt-in checkbox
 * before anything touches `localStorage`. The key only ever lives in this module's React state
 * and, if remembered, in `localStorage` under its own key — never in the action log, the agent
 * transcript (`@istar-ts/agent`'s `ChatClient` keeps it in a closure, per its README), an
 * exported log, or a URL.
 */
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'istar-ts-playground:deepseekApiKey';

function loadRememberedKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export interface ApiKeyState {
  readonly apiKey: string;
  readonly remember: boolean;
  setApiKey(key: string): void;
  setRemember(remember: boolean): void;
}

/** The pasted key's state: in memory, and in `localStorage` only while `remember` is checked. */
export function useApiKey(): ApiKeyState {
  const [remember, setRememberState] = useState(() => loadRememberedKey() !== '');
  const [apiKey, setApiKeyState] = useState(loadRememberedKey);

  const setApiKey = useCallback(
    (key: string) => {
      setApiKeyState(key);
      if (remember) {
        try {
          if (key) localStorage.setItem(STORAGE_KEY, key);
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Storage may be unavailable (private browsing); the key still works in memory.
        }
      }
    },
    [remember],
  );

  const setRemember = useCallback(
    (next: boolean) => {
      setRememberState(next);
      try {
        if (next && apiKey) localStorage.setItem(STORAGE_KEY, apiKey);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore: the checkbox still reflects the user's intent for this session.
      }
    },
    [apiKey],
  );

  return { apiKey, remember, setApiKey, setRemember };
}
