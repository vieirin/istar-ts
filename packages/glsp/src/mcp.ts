/**
 * What the Node and browser launchers' MCP opt-ins share (`@eclipse-glsp/server-mcp`,
 * framework-notes §5). Type imports only: the launchers load the optional peer themselves, and
 * hand its classes in.
 */
import type { GoalDiagnostic } from '@istar-ts/core';
import type { InitializeParameters } from '@eclipse-glsp/server';
import type {
  AbstractMcpDiagramResourceHandler,
  DefaultMcpDiagramHandlerDispatcher,
  GLSPMcpServer,
  McpDiagramScopedInput,
  McpDiagramHandlerDispatcher,
} from '@eclipse-glsp/server-mcp/browser.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { interfaces } from 'inversify';
import { decorate, injectable } from 'inversify';
import { IstarOperationRunner } from './operations';

/**
 * `initialize`'s parameters with `mcpServer` (`McpInitializeParameters`' extension) set to
 * `config` unless the client sent its own: the server starts MCP whether or not the client asks,
 * so opting in is the host's call.
 */
export function withMcpServer(params: InitializeParameters, config: object): InitializeParameters {
  const mcpServer = (params as { mcpServer?: unknown }).mcpServer ?? config;
  return { ...params, mcpServer } as InitializeParameters;
}

/**
 * A rejection as a tool error: `{ code: 'rejected', diagnostics }` as a JSON text block, not
 * `structuredContent`. A tool with a declared output schema (`create-nodes`, ours too) would
 * fail the MCP SDK client's schema check even on an `isError: true` result once the client has
 * called `tools/list` and cached the schema (`Client.callTool` validates `structuredContent`
 * unconditionally) — #136. `@istar-ts/agent`'s `createMcpToolRegistry` reads a JSON text block
 * carrying `diagnostics` the same way it would have read `structuredContent`.
 */
export function rejectedToolResult(
  diagnostics: readonly GoalDiagnostic[],
  content: CallToolResult['content'] = [],
): CallToolResult {
  const text = `Rejected: ${diagnostics.map((d) => d.message).join('; ')}`;
  return {
    isError: true,
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify({ code: 'rejected', diagnostics }) },
      ...content,
    ],
  };
}

/**
 * server-mcp's diagram handler dispatcher, with each diagram tool call run as one edit
 * (`IstarOperationRunner.group`, #223): one undo step, all or nothing, whichever tool it is and
 * however many operations it dispatches. A call whose operations the session's dispatcher
 * rejected (a guard, `canLink`, a property schema) is answered as a tool error, with nothing
 * applied. Without it the call succeeds: GLSP has no failure answer to an operation, and
 * server-mcp's handlers only infer one (`create-nodes` lists "likely failed" under `errors`,
 * `modify-nodes` nothing). The error's text is the rejection's diagnostics; the tool's own
 * answer, describing changes that were then dropped, is not passed on.
 */
export function istarMcpDispatcher(base: {
  DefaultMcpDiagramHandlerDispatcher: typeof DefaultMcpDiagramHandlerDispatcher;
}): interfaces.Newable<McpDiagramHandlerDispatcher> {
  class IstarMcpDiagramHandlerDispatcher extends base.DefaultMcpDiagramHandlerDispatcher {
    protected override async dispatchDiagramTool(
      name: string,
      params: unknown,
    ): Promise<CallToolResult> {
      const sessionId = this.extractSessionId(params);
      const container = sessionId
        ? this.clientSessionManager.getSession(sessionId)?.container
        : undefined;
      if (!container?.isBound(IstarOperationRunner)) return super.dispatchDiagramTool(name, params);
      const runner = container.get(IstarOperationRunner);
      const rejections: GoalDiagnostic[] = [];
      const stop = runner.onRejected((d) => rejections.push(...d));
      let result: CallToolResult;
      try {
        result = await runner.group(
          () => super.dispatchDiagramTool(name, params),
          (answer) => !answer.isError,
        );
      } finally {
        stop();
      }
      if (rejections.length === 0) return result;
      return rejectedToolResult(rejections);
    }

    /**
     * A resource served as a tool (server-mcp's default `dataMode: 'tools'`) is a read, but
     * server-mcp registers it without annotations, so a harness that goes by `readOnlyHint`
     * (`@istar-ts/agent`'s, in Propose mode) would take a host's context provider (#175) for an
     * edit. Marked read-only here.
     */
    protected override registerOneDiagramResourceAsTool(
      server: GLSPMcpServer,
      probe: AbstractMcpDiagramResourceHandler<McpDiagramScopedInput>,
    ): void {
      const readOnly = new Proxy(server, {
        get: (target, key, receiver) =>
          key === 'registerTool'
            ? (name: string, config: { annotations?: object }, callback: unknown) =>
                (target.registerTool as (...args: unknown[]) => unknown)(
                  name,
                  { ...config, annotations: { ...config.annotations, readOnlyHint: true } },
                  callback,
                )
            : Reflect.get(target, key, receiver),
      });
      super.registerOneDiagramResourceAsTool(readOnly, probe);
    }
  }
  decorate(injectable(), IstarMcpDiagramHandlerDispatcher);
  return IstarMcpDiagramHandlerDispatcher;
}
