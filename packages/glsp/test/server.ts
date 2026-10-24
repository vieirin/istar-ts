/**
 * A GLSP server with the iStar, KAOS and NFR diagrams, in process (no transport), for tests: it
 * records every message it sends to the client.
 */
import { Container, ContainerModule } from 'inversify';
import type {
  Action,
  ActionMessage,
  ClientSession,
  DefaultGLSPServer,
  GModelRootSchema,
  GLSPServer as Server,
} from '@eclipse-glsp/server';
import {
  ClientAction,
  GLSPClientProxy,
  GLSPServer,
  LogLevel,
  ModelState,
  RequestModelAction,
  ServerModule,
} from '@eclipse-glsp/server';
import { createAppModule } from '@eclipse-glsp/server/node';
import type { IstarGlspContribution, IstarModelState } from '../src';
import { ISTAR_GLSP, PistarFiles, configureIstarDiagram, memoryPistarFiles } from '../src';
import { KAOS_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';
import { fixture } from './fixtures';

export function testFiles(): Map<string, string> {
  return new Map<string, string>([
    ['welcome.txt', fixture('pistar/welcome.txt').text],
    ['kaos.txt', fixture('dsm3/kaos-welcome.txt').text],
    ['nfr.txt', fixture('dsm3/nfr-welcome.txt').text],
  ]);
}

export const files: Map<string, string> = testFiles();

/** What a stock client handles, as far as these tests get. */
export const CLIENT_ACTION_KINDS: string[] = [
  'setModel',
  'updateModel',
  'setTypeHints',
  'setDirtyState',
  'status',
  'message',
  'startProgress',
  'updateProgress',
  'endProgress',
  'setMarkers',
  'setContextActions',
  'checkEdgeTargetResult',
  'setEditValidationResult',
  'setEditMode',
];

export async function startServer(
  fileMap: Map<string, string> = files,
): Promise<{ server: Server; sent: ActionMessage[] }> {
  const sent: ActionMessage[] = [];
  const serverModule = new ServerModule();
  for (const contribution of [ISTAR_GLSP, KAOS_GLSP, NFR_GLSP]) {
    configureIstarDiagram(serverModule, contribution);
  }
  const host = new ContainerModule((bind) => {
    bind(PistarFiles).toConstantValue(memoryPistarFiles(fileMap));
    bind(GLSPClientProxy).toConstantValue({
      process: (message: ActionMessage) => sent.push(message),
    });
  });
  const container = new Container();
  container.load(
    createAppModule({ logLevel: LogLevel.none, fileLog: false, consoleLog: false }),
    serverModule,
    host,
  );
  const server = container.get<Server>(GLSPServer);
  await server.initialize({ applicationId: 'test', protocolVersion: '1.0.0' });
  return { server, sent };
}

/** The first `kind` message sent at or after index `from`. */
export async function next(sent: ActionMessage[], kind: string, from = 0): Promise<ActionMessage> {
  for (let i = 0; i < 100; i++) {
    const found = sent.slice(from).find((m) => m.action.kind === kind);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${kind}; got ${sent.map((m) => m.action.kind).join(', ')}`);
}

export interface Session {
  readonly server: Server;
  readonly sent: ActionMessage[];
  readonly root: GModelRootSchema;
  readonly clientId: string;
  readonly session: ClientSession;
  readonly state: IstarModelState;
  /** Sends `action` as the client does (`process`), and waits until the session handled it. */
  send(action: Action): Promise<void>;
  /** The kinds of the messages sent since `from`. */
  kinds(from: number): string[];
}

export async function open(
  contribution: IstarGlspContribution,
  sourceUri: string,
  options: { clientActionKinds?: string[]; files?: Map<string, string> } = {},
): Promise<Session> {
  const { server, sent } = await startServer(options.files);
  const clientId = `client-${contribution.diagramType}`;
  await server.initializeClientSession({
    clientSessionId: clientId,
    diagramType: contribution.diagramType,
    clientActionKinds: options.clientActionKinds ?? CLIENT_ACTION_KINDS,
  });
  server.process({ clientId, action: RequestModelAction.create({ options: { sourceUri } }) });
  const message = await next(sent, 'setModel');
  const session = (server as DefaultGLSPServer).getClientSession(clientId)!;
  return {
    server,
    sent,
    clientId,
    session,
    state: session.container.get<IstarModelState>(ModelState),
    root: (message.action as unknown as { newRoot: GModelRootSchema }).newRoot,
    async send(action) {
      // What `process` does, awaited.
      ClientAction.mark(action);
      await session.actionDispatcher.dispatch(action);
    },
    kinds: (from) => sent.slice(from).map((m) => m.action.kind),
  };
}
