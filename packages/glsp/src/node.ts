/**
 * `@istar-ts/glsp/node`: the GLSP server over a WebSocket, as glsp-core's
 * `examples/workflow-server/src/node/app.ts` launches it (framework-notes §3), with an opt-in MCP
 * server (`@eclipse-glsp/server-mcp`, framework-notes §5). Node only.
 */
// Inversify reads decorator metadata through `Reflect`: load the polyfill before any class.
import 'reflect-metadata';

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GLSPServer, InitializeParameters, InitializeResult } from '@eclipse-glsp/server';
import { LogLevel } from '@eclipse-glsp/server';
import { WebSocketServerLauncher, createAppModule } from '@eclipse-glsp/server/node.js';
import type { ContainerModule } from 'inversify';
import { Container, decorate, injectable } from 'inversify';
import type { PistarFiles } from './files';
import type { IstarGlspHostOptions } from './host';
import { createIstarServerModules } from './host';

/** The MCP server's options. It binds to `127.0.0.1` only and has no authentication. */
export interface IstarMcpOptions {
  /** Default 0: a free port, reported in `initialize`'s result (`mcpServer.url`). */
  readonly port?: number;
  /** Default `/mcp`. */
  readonly route?: string;
  /** The MCP server's name. Default `istar-glsp`. */
  readonly name?: string;
}

export interface IstarGlspNodeOptions extends IstarGlspHostOptions {
  /** Default 0: a free port (see `IstarGlspNodeServer.port`). */
  readonly port?: number;
  /** Default `127.0.0.1`. */
  readonly host?: string;
  /** The WebSocket's path. Default `istar`. */
  readonly path?: string;
  /** Default `LogLevel.warn`, to the console. */
  readonly logLevel?: LogLevel;
  /**
   * Also serve the diagrams over MCP (`@eclipse-glsp/server-mcp`, an optional peer dependency):
   * the MCP server starts with the first `initialize` on each connection, loopback only. Off by
   * default. `@experimental` upstream, so the peer is pinned to one version.
   */
  readonly mcp?: boolean | IstarMcpOptions;
}

/** A running Node GLSP server. */
export interface IstarGlspNodeServer {
  /** The port it listens on. */
  readonly port: number;
  /** `ws://host:port/path`, for a client's WebSocket. */
  readonly url: string;
  /** Closes the server and every connection. */
  close(): Promise<void>;
}

/**
 * Starts a GLSP server for the contributions' diagrams on a WebSocket, resolving once it
 * listens. Every connection gets its own GLSP server (as upstream's launcher does); with
 * `shared`, all of them show and edit the host's model.
 */
export async function startIstarGlspServer(
  options: IstarGlspNodeOptions = {},
): Promise<IstarGlspNodeServer> {
  const mcp = options.mcp ? await mcpModules(options.mcp === true ? {} : options.mcp) : undefined;
  const app = new Container();
  app.load(
    createAppModule({
      logLevel: options.logLevel ?? LogLevel.warn,
      consoleLog: true,
      fileLog: false,
    }),
  );
  const launcher = app.resolve(WebSocketServerLauncher);
  const { serverModule, modules } = createIstarServerModules({
    ...options,
    diagramModules: [...(options.diagramModules ?? []), ...(mcp ? [mcp.diagram] : [])],
    modules: [...(options.modules ?? []), ...(mcp ? [mcp.server] : [])],
  });
  launcher.configure(serverModule, ...modules);
  const host = options.host ?? '127.0.0.1';
  const path = options.path ?? 'istar';
  void launcher.start({ port: options.port ?? 0, host, path });
  const { port } = await launcher.listening;
  return {
    port,
    url: `ws://${host}:${port}/${path}`,
    async close() {
      await launcher.shutdown();
    },
  };
}

/**
 * The MCP server module (server scope) and diagram module (every session), from
 * `@eclipse-glsp/server-mcp`, loaded only when asked for. GLSP starts the MCP server when a
 * client's `initialize` carries `mcpServer` options; this server starts it whether or not the
 * client asks, with `options`, so opting in is the host's call.
 */
async function mcpModules(
  options: IstarMcpOptions,
): Promise<{ server: ContainerModule; diagram: ContainerModule }> {
  const mcp = await import('@eclipse-glsp/server-mcp/node.js');
  const config = {
    port: options.port ?? 0,
    route: options.route ?? '/mcp',
    name: options.name ?? 'istar-glsp',
  };
  class IstarMcpServerLauncher extends mcp.NodeMcpServerLauncher {
    override initializeServer(
      server: GLSPServer,
      params: InitializeParameters,
      result: InitializeResult,
    ): Promise<InitializeResult> {
      const mcpServer = (params as { mcpServer?: unknown }).mcpServer ?? config;
      // `mcpServer` is `McpInitializeParameters`' extension of the parameters.
      const withMcp = { ...params, mcpServer } as InitializeParameters;
      return super.initializeServer(server, withMcp, result);
    }
  }
  decorate(injectable(), IstarMcpServerLauncher);
  class IstarMcpServerModule extends mcp.NodeMcpServerModule {
    protected override bindMcpServerLauncher(): typeof IstarMcpServerLauncher {
      return IstarMcpServerLauncher;
    }
  }
  return { server: new IstarMcpServerModule(), diagram: new mcp.DefaultMcpDiagramModule() };
}

/**
 * `PistarFiles` on disk, under `root`: a URI is a path relative to it, or a `file:` URI or an
 * absolute path inside it. Anything outside `root` is refused, since any client of the server
 * can name a file.
 */
export function diskPistarFiles(root: string = process.cwd()): PistarFiles {
  const base = resolve(root);
  const pathOf = (uri: string): string => {
    const path = resolve(base, uri.startsWith('file:') ? fileURLToPath(uri) : uri);
    const inside = relative(base, path);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`"${uri}" is outside ${base}`);
    }
    return path;
  };
  return {
    read: (uri) => readFile(pathOf(uri), 'utf8'),
    write: (uri, text) => writeFile(pathOf(uri), text),
  };
}
