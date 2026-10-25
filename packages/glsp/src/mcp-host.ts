/**
 * A host's tools and context providers (`@istar-ts/actions`' `HostTool`, `HostContextProvider`,
 * #175) as server-mcp diagram handlers: one tool handler class per tool and one resource handler
 * class per provider, which `istarMcpDiagramModule` adds to every session's multi-bindings next
 * to the istar tools (the `configureToolHandlers`/`configureResourceHandlers` extension point,
 * framework-notes §5). Nothing here knows what a tool does; it only carries it. Type imports
 * only, like `mcp-tools.ts`.
 */
import type { GoalDiagnostic } from '@istar-ts/core';
import type { HostContextProvider, HostTool } from '@istar-ts/actions';
import { contextText, hostToolContext, metamodelContextProvider } from '@istar-ts/actions';
import type { ModelState } from '@eclipse-glsp/server';
import type {
  AbstractMcpDiagramResourceHandler,
  AbstractMcpDiagramToolHandler,
  McpDiagramResourceHandlerConstructor,
  McpDiagramScopedInput,
  McpDiagramScopedInputSchema,
  McpDiagramToolHandlerConstructor,
  McpResourceContent,
  McpResourceUri,
  McpToolResult,
  OperationMcpDiagramToolHandler,
} from '@eclipse-glsp/server-mcp/browser.js';
import type { Role } from '@modelcontextprotocol/sdk/types.js';
import type * as ZodV4 from 'zod/v4';
import { decorate, injectable } from 'inversify';
import type { IstarModelState } from './model-state';
import { rejectedToolResult } from './mcp';

/** A host's additions to every diagram session's MCP tools and resources. */
export interface IstarMcpHostExtensions {
  /** Tools served next to the istar ones, as session-scoped diagram tools. */
  readonly hostTools?: readonly HostTool[];
  /**
   * Context providers served as session-scoped resources (`glsp://diagrams/{sessionId}/context/
   * <name>`), unless `resource: false`. With server-mcp's default `dataMode: 'tools'` each is
   * listed as a read-only tool of its name instead. The built-in metamodel context provider
   * (#240, `@istar-ts/actions`' `metamodelContextProvider`) is prepended automatically, unless
   * `metamodelContext: false`.
   */
  readonly context?: readonly HostContextProvider[];
  /** Opts out of the built-in metamodel context provider (#240). Default true. */
  readonly metamodelContext?: boolean;
}

/** `host.context`, with the built-in metamodel context provider (#240) prepended by default. */
export function contextWithMetamodel(host: IstarMcpHostExtensions): readonly HostContextProvider[] {
  const context = host.context ?? [];
  return host.metamodelContext === false ? context : [metamodelContextProvider(), ...context];
}

/** The server-mcp and zod pieces the handlers build on. */
export interface IstarMcpHostBase {
  readonly AbstractMcpDiagramToolHandler: typeof AbstractMcpDiagramToolHandler;
  readonly OperationMcpDiagramToolHandler: typeof OperationMcpDiagramToolHandler;
  readonly AbstractMcpDiagramResourceHandler: typeof AbstractMcpDiagramResourceHandler;
  readonly McpDiagramScopedInputSchema: typeof McpDiagramScopedInputSchema;
}

function istarStateOf(state: ModelState): IstarModelState {
  return state as unknown as IstarModelState;
}

/** A tool's JSON Schema as the zod object server-mcp registers (and validates calls with). */
function argumentsSchema(tool: HostTool, z: typeof ZodV4): ZodV4.ZodObject {
  if (typeof z.fromJSONSchema !== 'function') {
    throw new TypeError(`host tool "${tool.name}" needs zod 4.2 or later (z.fromJSONSchema)`);
  }
  const schema = z.fromJSONSchema(tool.inputSchema as ZodV4.core.JSONSchema.JSONSchema);
  if (!(schema instanceof z.ZodObject)) {
    throw new TypeError(`host tool "${tool.name}": inputSchema must be an object schema`);
  }
  return schema;
}

/** One diagram tool handler class per host tool: read-only ones skip the read-only-model gate. */
export function hostToolHandlers(
  mcp: IstarMcpHostBase,
  z: typeof ZodV4,
  tools: readonly HostTool[],
): McpDiagramToolHandlerConstructor[] {
  return tools.map((tool) => {
    const inputSchema = mcp.McpDiagramScopedInputSchema.extend(argumentsSchema(tool, z).shape);
    // Both bases share the abstract surface; the operation one adds the read-only-model gate.
    const Base = tool.readOnly
      ? mcp.AbstractMcpDiagramToolHandler
      : (mcp.OperationMcpDiagramToolHandler as unknown as typeof AbstractMcpDiagramToolHandler);
    class HostMcpToolHandler extends Base {
      readonly name = tool.name;
      override readonly title = tool.title ?? tool.name;
      readonly description = tool.description;
      readonly inputSchema = inputSchema;
      override readonly readOnlyHint = tool.readOnly === true;

      protected async createResult(params: McpDiagramScopedInput): Promise<McpToolResult> {
        const { sessionId: _sessionId, ...args } = params as McpDiagramScopedInput &
          Record<string, unknown>;
        const state = istarStateOf(this.modelState);
        const result = await tool.handler(
          args,
          hostToolContext(tool, state.editor, () => state.model),
        );
        if (!result.ok) return rejectedToolResult(result.diagnostics as readonly GoalDiagnostic[]);
        const { content } = result;
        return this.success(typeof content === 'string' ? content : JSON.stringify(content));
      }
    }
    decorate(injectable(), HostMcpToolHandler);
    return HostMcpToolHandler as unknown as McpDiagramToolHandlerConstructor;
  });
}

/** One diagram resource handler class per provider that is a resource. */
export function hostContextHandlers(
  mcp: IstarMcpHostBase,
  providers: readonly HostContextProvider[],
): McpDiagramResourceHandlerConstructor[] {
  return providers
    .filter((provider) => provider.resource !== false)
    .map((provider) => {
      const title = provider.title ?? provider.name;
      class HostContextResourceHandler extends mcp.AbstractMcpDiagramResourceHandler {
        readonly name = provider.name;
        override readonly title = title;
        readonly description = provider.description ?? title;
        readonly mimeType = 'text/markdown';
        readonly uri: McpResourceUri = {
          template: `glsp://diagrams/{sessionId}/context/${encodeURIComponent(provider.name)}`,
        };
        override readonly audience: Role[] = ['assistant'];
        override readonly toolAlternativeInputSchema = mcp.McpDiagramScopedInputSchema;

        protected async createResult(): Promise<McpResourceContent> {
          return { text: await contextText(provider, istarStateOf(this.modelState).model) };
        }
      }
      decorate(injectable(), HostContextResourceHandler);
      return HostContextResourceHandler as unknown as McpDiagramResourceHandlerConstructor;
    });
}
