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
  /** The files attached to this turn (#257), so a host can render chips from the transcript. */
  readonly attachments?: readonly Attachment[];
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
  /** The provider this client was built from, when it was built with one (#257). */
  readonly provider?: ChatProvider;
  complete(request: ChatRequest): Promise<ChatCompletion>;
}

interface ChatClientConfigCommon {
  /**
   * Stream the response (server-sent events) and assemble it: text deltas reach `onDelta`,
   * tool calls are buffered by `index` until the stream ends and run whole. Default false.
   */
  readonly stream?: boolean;
  /** Extra request-body fields, e.g. `{ thinking: { type: 'disabled' } }` or `temperature`. */
  readonly body?: Readonly<Record<string, unknown>>;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Sent as `Authorization: Bearer <apiKey>`; kept in a closure, never on the client. */
  readonly apiKey: string;
}

export interface ChatClientConfig extends ChatClientConfigCommon {
  /** E.g. `https://api.deepseek.com`; `/chat/completions` is appended. */
  readonly baseUrl: string;
  readonly model: string;
}

/** A provider by id or value; its `baseUrl` and `defaultModel` fill in what `model` omits. */
export interface ChatClientProviderConfig extends ChatClientConfigCommon {
  readonly provider: ChatProvider | ChatProviderId;
  readonly model?: string;
}

/** DeepSeek as configuration: its API and the default model (`deepseek-flash`, per D0). */
export const DEEPSEEK: { readonly baseUrl: string; readonly model: string } = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
};

/** A model a provider offers, as `listModels` or a `fallbackModels` entry describes it. */
export interface ModelInfo {
  readonly id: string;
  readonly label?: string;
}

/** A text file attached to a user turn (#257): read client-side, inlined into the prompt. */
export interface Attachment {
  readonly name: string;
  readonly mime: string;
  readonly text: string;
}

/**
 * A chat backend `createChatClient` can target by id or value: its API shape (`baseUrl`), its
 * models and how it takes file attachments (text-only APIs inline them into the prompt).
 */
export interface ChatProvider {
  readonly id: string;
  readonly label: string;
  /** E.g. `https://api.deepseek.com`; `/chat/completions` and `/models` are appended. */
  readonly baseUrl: string;
  readonly defaultModel: string;
  /** What `listModels` resolves to when it cannot reach the API. */
  readonly fallbackModels: readonly ModelInfo[];
  /** `GET {baseUrl}/models` (OpenAI-shaped); never rejects, falling back on any failure. */
  listModels(apiKey: string, fetchImpl?: typeof fetch): Promise<readonly ModelInfo[]>;
  readonly acceptedFiles: readonly { readonly extension: string; readonly mime: string }[];
  /** Renders attachments into text to append to the prompt. */
  attach(files: readonly Attachment[]): string;
}

export type ChatProviderId = 'deepseek';

/**
 * A fence longer than any backtick run in `text`, so a fenced block built from it cannot be
 * closed early by its own content (e.g. a file that itself contains a ` ``` ` block).
 */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The default (and DeepSeek's) way to inline text attachments: one fenced block per file,
 * headed by its name, each fence longer than any backtick run the file's own text contains.
 */
export function fenceAttachments(files: readonly Attachment[]): string {
  return files
    .map((file) => {
      const fence = fenceFor(file.text);
      return `${file.name}\n${fence}\n${file.text}\n${fence}`;
    })
    .join('\n\n');
}

interface OpenAiModelsResponse {
  readonly data?: readonly { readonly id?: string }[];
}

/**
 * `GET {baseUrl}/models` (OpenAI-shaped): `fallback` on any non-2xx answer, unreadable body or
 * network failure — `listModels` never rejects.
 */
async function listModelsFrom(
  baseUrl: string,
  fallback: readonly ModelInfo[],
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<readonly ModelInfo[]> {
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return fallback;
    const raw = (await response.json()) as OpenAiModelsResponse;
    const models = (raw.data ?? [])
      .map((entry) => (entry.id ? { id: entry.id } : undefined))
      .filter((entry): entry is ModelInfo => entry !== undefined);
    return models.length > 0 ? models : fallback;
  } catch {
    return fallback;
  }
}

const DEEPSEEK_FALLBACK_MODELS: readonly ModelInfo[] = [
  { id: DEEPSEEK.model },
  { id: 'deepseek-chat' },
  { id: 'deepseek-reasoner' },
];

const DEEPSEEK_ACCEPTED_FILES: readonly { readonly extension: string; readonly mime: string }[] = [
  { extension: '.txt', mime: 'text/plain' },
  { extension: '.md', mime: 'text/markdown' },
  { extension: '.json', mime: 'application/json' },
  { extension: '.csv', mime: 'text/csv' },
  { extension: '.yaml', mime: 'application/yaml' },
  { extension: '.yml', mime: 'application/yaml' },
  { extension: '.log', mime: 'text/plain' },
];

const DEEPSEEK_PROVIDER: ChatProvider = {
  id: 'deepseek',
  label: 'DeepSeek',
  baseUrl: DEEPSEEK.baseUrl,
  defaultModel: DEEPSEEK.model,
  fallbackModels: DEEPSEEK_FALLBACK_MODELS,
  listModels: (apiKey, fetchImpl) =>
    listModelsFrom(DEEPSEEK.baseUrl, DEEPSEEK_FALLBACK_MODELS, apiKey, fetchImpl),
  acceptedFiles: DEEPSEEK_ACCEPTED_FILES,
  attach: fenceAttachments,
};

/** Chat providers `createChatClient` and a host's model picker can look up by id. */
export const PROVIDERS: Record<ChatProviderId, ChatProvider> = {
  deepseek: DEEPSEEK_PROVIDER,
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
export function createChatClient(config: ChatClientConfig | ChatClientProviderConfig): ChatClient {
  const provider =
    'provider' in config
      ? typeof config.provider === 'string'
        ? PROVIDERS[config.provider]
        : config.provider
      : undefined;
  const { apiKey, stream = false, body = {} } = config;
  const model =
    'provider' in config ? (config.model ?? (provider as ChatProvider).defaultModel) : config.model;
  const baseUrl = (
    'provider' in config ? (provider as ChatProvider).baseUrl : config.baseUrl
  ).replace(/\/+$/, '');
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    model,
    baseUrl,
    ...(provider ? { provider } : {}),
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
