/**
 * An OpenAI-compatible chat-completions client: `POST {baseUrl}/chat/completions` with
 * `messages` and `tools`, answered with an assistant message (text and/or `tool_calls`) and a
 * `usage` block. Nothing in it is DeepSeek's: DeepSeek is `DEEPSEEK`, a configuration
 * (`docs/agent/verification.md` §1–§3 for its models, streaming and usage fields).
 *
 * The API key lives only in `createChatClient`'s closure: the `ChatClient` it returns has no
 * field holding it, so nothing the loop records can carry it.
 */
import type { OpenAiTool } from './tools';

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    /** JSON-encoded arguments, as the model wrote them. */
    readonly arguments: string;
  };
}

export interface SystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface UserMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  /**
   * A thinking model's reasoning (DeepSeek's thinking mode). Sent back as received with the
   * rest of the message, as such APIs expect within a tool-calling turn.
   */
  readonly reasoning_content?: string;
}

export interface ToolMessage {
  readonly role: 'tool';
  readonly tool_call_id: string;
  readonly content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/**
 * The response's `usage` block. The detail fields are optional: which ones a provider sends
 * varies (DeepSeek's are in `docs/agent/verification.md` §3).
 */
export interface Usage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
    readonly prompt_cache_hit_tokens?: number;
    readonly prompt_cache_miss_tokens?: number;
  };
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  /** DeepSeek also sends the cache split at the top level. */
  readonly prompt_cache_hit_tokens?: number;
  readonly prompt_cache_miss_tokens?: number;
}

export interface ChatCompletion {
  readonly message: AssistantMessage;
  /** `stop`, `tool_calls`, `length`, …; null if the provider sent none. */
  readonly finishReason: string | null;
  readonly usage?: Usage;
}

export interface ChatDelta {
  readonly content?: string;
  readonly reasoning?: string;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly OpenAiTool[];
  readonly signal?: AbortSignal;
  /** With `stream`, called with each text fragment as it arrives. */
  readonly onDelta?: (delta: ChatDelta) => void;
}

/** A configured chat model. Holds no API key. */
export interface ChatClient {
  readonly model: string;
  readonly baseUrl: string;
  complete(request: ChatRequest): Promise<ChatCompletion>;
}

export interface ChatClientConfig {
  /** E.g. `https://api.deepseek.com`; `/chat/completions` is appended. */
  readonly baseUrl: string;
  readonly model: string;
  /** Sent as `Authorization: Bearer <apiKey>`; kept in a closure, never on the client. */
  readonly apiKey: string;
  /**
   * Stream the response (server-sent events) and assemble it: text deltas reach `onDelta`,
   * tool calls are buffered by `index` until the stream ends and run whole. Default false.
   */
  readonly stream?: boolean;
  /** Extra request-body fields, e.g. `{ thinking: { type: 'disabled' } }` or `temperature`. */
  readonly body?: Readonly<Record<string, unknown>>;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/** DeepSeek as configuration: its API and the default model (`deepseek-flash`, per D0). */
export const DEEPSEEK: { readonly baseUrl: string; readonly model: string } = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
};

/** A non-2xx answer. Its message has the status and the start of the body, never a header. */
export class ChatApiError extends Error {
  override name = 'ChatApiError';
  readonly status: number;
  constructor(status: number, body: string) {
    super(`chat API answered ${status}${body ? `: ${body.slice(0, 500)}` : ''}`);
    this.status = status;
  }
}

interface RawMessage {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface RawChoice {
  message?: RawMessage;
  delta?: RawMessage;
  finish_reason?: string | null;
}

interface RawResponse {
  choices?: RawChoice[];
  usage?: Usage | null;
}

function assistantMessage(
  content: string | null,
  reasoning: string | null,
  toolCalls: readonly ToolCall[],
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  };
}

function fromResponse(raw: RawResponse): ChatCompletion {
  const choice = raw.choices?.[0];
  const message = choice?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id ?? '',
    type: 'function' as const,
    function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' },
  }));
  return {
    message: assistantMessage(
      message.content ?? null,
      message.reasoning_content ?? null,
      toolCalls,
    ),
    finishReason: choice?.finish_reason ?? null,
    ...(raw.usage ? { usage: raw.usage } : {}),
  };
}

/** Reads a server-sent-events body into one completion, tool calls accumulated by `index`. */
async function fromStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((delta: ChatDelta) => void) | undefined,
): Promise<ChatCompletion> {
  let content = '';
  let reasoning = '';
  let sawContent = false;
  let finishReason: string | null = null;
  let usage: Usage | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  const onEvent = (data: string): void => {
    const chunk = JSON.parse(data) as RawResponse;
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content !== '') {
        content += delta.content;
        sawContent = true;
        onDelta?.({ content: delta.content });
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
        reasoning += delta.reasoning_content;
        onDelta?.({ reasoning: delta.reasoning_content });
      }
      // The first chunk of a call carries its id and name; later ones only argument fragments.
      for (const part of delta.tool_calls ?? []) {
        const index = part.index ?? 0;
        const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        calls.set(index, call);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const read = await reader.read();
    buffer += decoder.decode(read.value, { stream: !read.done });
    done = read.done;
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        done = true;
        break;
      }
      if (data) onEvent(data);
    }
  }
  await reader.cancel().catch(() => {});

  const toolCalls = [...calls.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }));
  return {
    message: assistantMessage(sawContent ? content : null, reasoning || null, toolCalls),
    finishReason,
    ...(usage ? { usage } : {}),
  };
}

/** A chat client for `config`. The key stays inside it. */
export function createChatClient(config: ChatClientConfig): ChatClient {
  const { apiKey, model, stream = false, body = {} } = config;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    model,
    baseUrl,
    async complete({ messages, tools, signal, onDelta }) {
      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...(stream ? { accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify({
          ...body,
          model,
          messages,
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        // A proxy that echoes the request must not put the key in an error message.
        const text = await response.text().catch(() => '');
        throw new ChatApiError(
          response.status,
          apiKey ? text.split(apiKey).join('[redacted]') : text,
        );
      }
      if (stream && response.body) return fromStream(response.body, onDelta);
      return fromResponse((await response.json()) as RawResponse);
    },
  };
}
