/**
 * The agent drawer's e2e suite mocks DeepSeek's chat-completions endpoint by overriding the
 * page's own `window.fetch` for that one URL, the same OpenAI-compatible JSON shape
 * `packages/agent/test/mock-model.ts` uses for `@istar-ts/agent`'s own tests. The drawer always
 * streams (#152), so every reply is delivered as server-sent events, each chunk a real
 * `setTimeout` tick apart — long enough that a test can observe the UI mid-stream (partial text,
 * a live budget update) before the reply finishes, and that Stop can abort between chunks.
 *
 * The browser still "calls" `https://api.deepseek.com/chat/completions` as a URL string (so the
 * playground's CSP, which restricts `connect-src` to that origin, #131 item 2, is never actually
 * exercised against a real network layer): overriding `fetch` means no request ever reaches the
 * browser's own network stack, so CSP is not in play either way, but the call still only answers
 * that one path — nothing here widens what the page can really fetch.
 */
import type { Page } from '@playwright/test';

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

/** `reply` returns this to leave a request pending (for a Stop/`AbortSignal` test). No chunk is
 * ever sent: the fetch itself hangs, as if DeepSeek never answered. */
export const HANG = Symbol('hang');

interface ScriptedChunk {
  readonly choices: readonly {
    readonly index: 0;
    readonly delta: Record<string, unknown>;
    readonly finish_reason: string | null;
  }[];
  readonly usage?: unknown;
}

/**
 * Turns a full completion (`toolCalls(...)` / `answer(...)` shape) into the SSE delta chunks
 * DeepSeek would send for it (`docs/agent/verification.md` §2-3): a role-only opener, the text
 * split into small pieces so it visibly streams in, each tool call's first chunk carrying only
 * `id`/`type`/`function.name` with its `arguments` fragments split across two further chunks, and
 * `usage` on the closing chunk.
 */
function toDeltaChunks(completion: unknown): readonly ScriptedChunk[] {
  const full = completion as {
    readonly choices: readonly {
      readonly finish_reason: string;
      readonly message: {
        readonly content: string | null;
        readonly tool_calls?: readonly {
          readonly id: string;
          readonly function: { readonly name: string; readonly arguments: string };
        }[];
      };
    }[];
    readonly usage?: unknown;
  };
  const choice = full.choices[0]!;
  const chunks: ScriptedChunk[] = [
    { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
  ];
  if (typeof choice.message.content === 'string') {
    for (const piece of choice.message.content.match(/.{1,6}/gs) ?? [choice.message.content]) {
      chunks.push({ choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    }
  }
  for (const [index, call] of (choice.message.tool_calls ?? []).entries()) {
    chunks.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index, id: call.id, type: 'function', function: { name: call.function.name } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const args = call.function.arguments;
    const mid = Math.ceil(args.length / 2);
    for (const fragment of [args.slice(0, mid), args.slice(mid)]) {
      chunks.push({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index, function: { arguments: fragment } }] },
            finish_reason: null,
          },
        ],
      });
    }
  }
  chunks.push({
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
    usage: full.usage,
  });
  return chunks;
}

/**
 * Routes every `POST https://api.deepseek.com/chat/completions` on `page` to `reply`, called
 * with the parsed request body and this mock's call index (0-based), streamed as SSE. No real
 * network request is made; the key the drawer sends is never read.
 */
export async function mockDeepSeek(
  page: Page,
  reply: (request: RecordedChat, index: number) => unknown,
): Promise<void> {
  let callIndex = 0;
  await page.exposeFunction('mockDeepSeekReply', (body: RecordedChat) => {
    const index = callIndex;
    callIndex += 1;
    const result = reply(body, index);
    return result === HANG
      ? { hang: true, chunks: [] }
      : { hang: false, chunks: toDeltaChunks(result) };
  });
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes('api.deepseek.com/chat/completions')) return realFetch(input, init);
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      const script = (await (
        window as unknown as {
          mockDeepSeekReply: (b: unknown) => Promise<{ hang: boolean; chunks: unknown[] }>;
        }
      ).mockDeepSeekReply(body)) as { hang: boolean; chunks: unknown[] };
      const signal = init?.signal;
      const encoder = new TextEncoder();
      let aborted = signal?.aborted === true;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          signal?.addEventListener('abort', () => {
            aborted = true;
            try {
              controller.error(new DOMException('aborted', 'AbortError'));
            } catch {
              /* already closed/errored */
            }
          });
          for (const chunk of script.chunks) {
            if (aborted) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!script.hang && !aborted) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
  });
}
