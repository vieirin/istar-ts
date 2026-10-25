/**
 * The tool contract between the loop and a backend: a `ToolRegistry` lists `ToolSpec`s (OpenAI's
 * `function` object: a name, a description and a JSON Schema for the arguments) and calls them.
 * A backend is either an MCP client (`createMcpToolRegistry`) or the `@istar-ts/actions`
 * dispatcher (`createActionToolRegistry`); the loop does not care which.
 */
import { ModelOperationError } from '@istar-ts/core';
import type { GoalDiagnostic } from '@istar-ts/core';

/** A JSON value, as a tool's arguments and results are. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON Schema object (draft 2020-12 or 7, whatever the backend emits), passed through as is. */
export type JsonSchema = { readonly [key: string]: unknown };

/** A tool, as OpenAI's `tools[].function` describes one. */
export interface ToolSpec {
  /** `^[a-zA-Z0-9_-]{1,64}$`, as OpenAI-compatible APIs require. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the arguments object. */
  readonly parameters: JsonSchema;
  /**
   * True for a tool that only reads the model. In Propose mode such a call runs straight away
   * and is not collected into the change set.
   */
  readonly readOnly?: boolean;
}

/**
 * What a tool call did, in the shape of `@istar-ts/actions`' `ActionResult`: a refusal carries
 * typed `GoalDiagnostic`s (code, message, elementId) the model can repair against.
 */
export type ToolResult =
  | {
      readonly ok: true;
      /** What the model reads back. */
      readonly content: JsonValue;
      /** Ids of the elements and links the call added, when the backend knows them. */
      readonly createdIds?: readonly string[];
      /** Non-error diagnostics (warnings from guards) for a call that was applied anyway. */
      readonly diagnostics?: readonly GoalDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly GoalDiagnostic[] };

export interface ToolCallOptions {
  readonly signal?: AbortSignal;
}

/** The tools a run can call. */
export interface ToolRegistry {
  list(): readonly ToolSpec[];
  call(name: string, args: JsonValue, options?: ToolCallOptions): Promise<ToolResult>;
  /**
   * The arguments a call should be made, and recorded, with. A backend that leaves ids to the
   * store (backend B) pins them here, so a dry run and the change set applied after it create
   * the same ids. Default: the arguments as given.
   */
  prepare?(name: string, args: JsonValue): JsonValue;
}

/** A refused call's result, with one error diagnostic. */
export function toolRefusal(message: string, code: string, elementId = ''): ToolResult {
  return { ok: false, diagnostics: [{ elementId, severity: 'error', message, code }] };
}

/**
 * A thrown error as a refusal: a `ModelOperationError` through its `toDiagnostic`, anything else
 * as a `tool-error` diagnostic with the error's message.
 */
export function errorToToolResult(error: unknown): ToolResult {
  if (error instanceof ModelOperationError) {
    return { ok: false, diagnostics: [{ ...error.toDiagnostic(), code: 'operation-error' }] };
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolRefusal(message, 'tool-error');
}

/** The `tools` array of an OpenAI-compatible chat request. */
export function toOpenAiTools(specs: readonly ToolSpec[]): OpenAiTool[] {
  return specs.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters },
  }));
}

export interface OpenAiTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}
