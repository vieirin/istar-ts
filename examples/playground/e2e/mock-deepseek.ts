/**
 * The agent drawer's e2e suite mocks DeepSeek's chat-completions endpoint by intercepting the
 * browser's own `fetch` (`page.route`), with the same OpenAI-compatible JSON shape
 * `packages/agent/test/mock-model.ts` uses for `@istar-ts/agent`'s own tests — but as route
 * interception, not a second server: the playground's CSP (#131 item 2) restricts `connect-src`
 * to `https://api.deepseek.com` only, and a real mock server would need its own origin to loosen
 * that for. The browser still "calls" `https://api.deepseek.com/chat/completions` (so the CSP
 * check passes); Playwright answers it instead of the network.
 */
import type { Page, Route } from '@playwright/test';

export interface RecordedChat {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
  readonly tools?: readonly { readonly function: { readonly name: string } }[];
}

const USAGE = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

/** A completion with tool calls (`[name, args]` pairs), same shape as `createChatClient` reads. */
export function toolCalls(...calls: readonly (readonly [string, unknown])[]): unknown {
  return {
    id: 'cmpl',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map(([name, args], i) => ({
            id: `call-${name}-${i}`,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          })),
        },
      },
    ],
    usage: USAGE,
  };
}

/** A final answer, no tool calls. */
export function answer(text: string): unknown {
  return {
    id: 'cmpl',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
    usage: USAGE,
  };
}

/** `reply` returns this to leave a request pending (for a Stop/`AbortSignal` test). */
export const HANG = Symbol('hang');

/**
 * Routes every `POST https://api.deepseek.com/chat/completions` on `page` to `reply`, called
 * with the parsed request body and this mock's call index (0-based). No real network request is
 * made; the key the drawer sends is never read.
 */
export async function mockDeepSeek(
  page: Page,
  reply: (request: RecordedChat, index: number) => unknown,
): Promise<void> {
  let index = 0;
  await page.route('https://api.deepseek.com/chat/completions', async (route: Route) => {
    const body = route.request().postDataJSON() as RecordedChat;
    const json = reply(body, index);
    index += 1;
    if (json === HANG) return; // never resolves; the test aborts it client-side.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
}
