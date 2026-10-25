/**
 * Backend A: the tools of an MCP server (in istar-ts, `@eclipse-glsp/server-mcp`'s diagram tools
 * served by `@istar-ts/glsp`), through an MCP client's `tools/list` and `tools/call`.
 *
 * `McpToolClient` is the slice of `@modelcontextprotocol/sdk`'s `Client` this needs, typed
 * structurally so this package does not depend on the SDK: a connected `Client` is one.
 */
import type { GoalDiagnostic } from '@istar-ts/core';
import { errorToToolResult, toolRefusal } from './tools';
import type { JsonSchema, JsonValue, ToolRegistry, ToolResult, ToolSpec } from './tools';

/** A tool as `tools/list` returns it. */
export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchema;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

/** What `tools/call` returns (the SDK's `CallToolResult`, loosely, or the legacy `toolResult`). */
export interface McpCallToolResult {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly isError?: unknown;
  readonly [key: string]: unknown;
}

/** The part of an MCP client the registry uses; `@modelcontextprotocol/sdk`'s `Client` fits. */
export interface McpToolClient {
  listTools(params?: {
    cursor?: string;
  }): Promise<{ readonly tools: readonly McpTool[]; readonly nextCursor?: string }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpCallToolResult>;
}

/**
 * server-mcp's tools that only read the diagram, as #130 lists them: `query-*`, `count-*`,
 * `diagram-model`, `element-types`, `validate-diagram`.
 */
export function isReadOnlyMcpTool(tool: McpTool): boolean {
  return (
    tool.name.startsWith('query-') ||
    tool.name.startsWith('count-') ||
    tool.name === 'diagram-model' ||
    tool.name === 'element-types' ||
    tool.name === 'validate-diagram'
  );
}

export interface McpToolRegistryOptions {
  /** Default `isReadOnlyMcpTool`. */
  readonly isReadOnly?: (tool: McpTool) => boolean;
  /** Tools to leave out (e.g. `save-model` in a demo). Default: none. */
  readonly exclude?: readonly string[];
  /**
   * Arguments sent with every call and hidden from the model's schemas, e.g.
   * `{ sessionId: server.sessionId }` for `@istar-ts/glsp`'s `serveIstarGlsp({ mcp: true })`.
   */
  readonly boundArgs?: Readonly<Record<string, JsonValue>>;
}

/** `schema` without the `keys` properties (nor in `required`). */
function withoutProperties(schema: JsonSchema, keys: readonly string[]): JsonSchema {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (keys.length === 0 || !properties) return schema;
  const required = schema.required;
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(properties).filter(([k]) => !keys.includes(k))),
    ...(Array.isArray(required)
      ? { required: required.filter((k: unknown) => !keys.includes(k as string)) }
      : {}),
  };
}

/** An MCP tool name as OpenAI-compatible APIs accept one. */
function functionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function isDiagnostic(value: unknown): value is GoalDiagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.message === 'string' && typeof d.severity === 'string';
}

function parseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** The result's content blocks as one JSON value: text (parsed when it is JSON), others named. */
function contentValue(content: unknown): JsonValue {
  if (!Array.isArray(content)) return null;
  const parts: JsonValue[] = content.map((block: unknown) => {
    const b = (block ?? {}) as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') return parseJson(b.text) ?? b.text;
    // Images and resources are no use to a text-only model (#126 §4).
    return { type: typeof b.type === 'string' ? b.type : 'unknown', omitted: true };
  });
  return parts.length === 1 ? parts[0]! : parts;
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string')
    .join('\n');
}

/**
 * A tool error as a refusal. A result that carries `{ diagnostics: GoalDiagnostic[] }`, in its
 * structured content or as a JSON text block (`@istar-ts/glsp`'s rejections, #129's tools), keeps
 * them; anything else becomes one `tool-error` diagnostic
 * with the result's text.
 */
function errorResult(result: McpCallToolResult): ToolResult {
  const blocks = Array.isArray(result.content) ? result.content : [];
  for (const value of [
    result.structuredContent,
    ...blocks.map((b: unknown) => contentValue([b])),
  ]) {
    const diagnostics = (value as { diagnostics?: unknown } | null)?.diagnostics;
    if (Array.isArray(diagnostics) && diagnostics.length > 0 && diagnostics.every(isDiagnostic)) {
      return { ok: false, diagnostics };
    }
  }
  return toolRefusal(contentText(result.content) || 'the tool reported an error', 'tool-error');
}

/**
 * A registry over `client`'s tools, listed once now (`tools/list`, every page). A call is
 * `tools/call`; `isError` results and thrown errors become refusals (`@istar-ts/glsp`'s
 * `{ code: 'rejected', diagnostics }` for an operation the dispatcher refused keeps its
 * diagnostics).
 */
export async function createMcpToolRegistry(
  client: McpToolClient,
  options: McpToolRegistryOptions = {},
): Promise<ToolRegistry> {
  const isReadOnly = options.isReadOnly ?? isReadOnlyMcpTool;
  const exclude = new Set(options.exclude ?? []);
  const bound = options.boundArgs ?? {};
  const boundKeys = Object.keys(bound);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  const byName = new Map<string, McpTool>();
  const specs: ToolSpec[] = [];
  for (const tool of tools) {
    if (exclude.has(tool.name)) continue;
    const name = functionName(tool.name);
    byName.set(name, tool);
    specs.push({
      name,
      description: tool.description ?? '',
      parameters: withoutProperties(tool.inputSchema, boundKeys),
      ...(isReadOnly(tool) ? { readOnly: true } : {}),
    });
  }

  return {
    list: () => specs,
    async call(name, args, callOptions) {
      const tool = byName.get(name);
      if (!tool) return toolRefusal(`unknown tool "${name}"`, 'unknown-tool');
      if (args !== null && (typeof args !== 'object' || Array.isArray(args))) {
        return toolRefusal('the arguments must be a JSON object', 'invalid-arguments');
      }
      try {
        const result = await client.callTool(
          { name: tool.name, arguments: { ...(args as Record<string, unknown> | null), ...bound } },
          undefined,
          callOptions?.signal ? { signal: callOptions.signal } : {},
        );
        if (result.isError === true) return errorResult(result);
        let content: JsonValue;
        if (result.structuredContent !== undefined) content = result.structuredContent as JsonValue;
        else if (result.content === undefined && 'toolResult' in result) {
          content = (result.toolResult ?? null) as JsonValue;
        } else content = contentValue(result.content);
        return { ok: true, content };
      } catch (error) {
        return errorToToolResult(error);
      }
    },
  };
}
