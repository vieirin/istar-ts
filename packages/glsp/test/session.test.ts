/**
 * The diagram module in a real GLSP server (in process, no transport): a client initializes,
 * opens a session for a diagram type, requests a model and gets the GModel of the file, with
 * no bounds round trip. Then the model state's store is the one the dispatcher edits.
 */
import { describe, expect, test } from 'vitest';
import { Container, ContainerModule } from 'inversify';
import type { ActionMessage, GModelRootSchema, GLSPServer as Server } from '@eclipse-glsp/server';
import type { DefaultGLSPServer } from '@eclipse-glsp/server';
import {
  LogLevel,
  GModelFactory,
  ModelState,
  GLSPClientProxy,
  GLSPServer,
  RequestModelAction,
  RequestTypeHintsAction,
  SaveModelAction,
  ServerModule,
} from '@eclipse-glsp/server';
import { createAppModule } from '@eclipse-glsp/server/node';
import { metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type { IstarGlspContribution } from '../src';
import {
  ISTAR_GLSP,
  IstarModelState,
  PistarFiles,
  configureIstarDiagram,
  memoryPistarFiles,
} from '../src';
import { KAOS_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';
import { fixture } from './fixtures';

const files = new Map<string, string>([
  ['welcome.txt', fixture('pistar/welcome.txt').text],
  ['kaos.txt', fixture('dsm3/kaos-welcome.txt').text],
  ['nfr.txt', fixture('dsm3/nfr-welcome.txt').text],
]);

/** What a stock client handles, as far as these tests get. */
const CLIENT_ACTION_KINDS = [
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
];

/** A GLSP server with the iStar, KAOS and NFR diagrams, and every message it sends. */
async function startServer(): Promise<{ server: Server; sent: ActionMessage[] }> {
  const sent: ActionMessage[] = [];
  const serverModule = new ServerModule();
  for (const contribution of [ISTAR_GLSP, KAOS_GLSP, NFR_GLSP]) {
    configureIstarDiagram(serverModule, contribution);
  }
  const host = new ContainerModule((bind) => {
    bind(PistarFiles).toConstantValue(memoryPistarFiles(files));
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
async function next(sent: ActionMessage[], kind: string, from = 0): Promise<ActionMessage> {
  for (let i = 0; i < 100; i++) {
    const found = sent.slice(from).find((m) => m.action.kind === kind);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${kind}; got ${sent.map((m) => m.action.kind).join(', ')}`);
}

async function open(
  contribution: IstarGlspContribution,
  sourceUri: string,
): Promise<{ server: Server; sent: ActionMessage[]; root: GModelRootSchema; clientId: string }> {
  const { server, sent } = await startServer();
  const clientId = `client-${contribution.diagramType}`;
  await server.initializeClientSession({
    clientSessionId: clientId,
    diagramType: contribution.diagramType,
    clientActionKinds: CLIENT_ACTION_KINDS,
  });
  server.process({ clientId, action: RequestModelAction.create({ options: { sourceUri } }) });
  const message = await next(sent, 'setModel');
  return {
    server,
    sent,
    clientId,
    root: (message.action as unknown as { newRoot: GModelRootSchema }).newRoot,
  };
}

function ids(schema: GModelRootSchema): string[] {
  const list: string[] = [];
  const walk = (element: { id: string; children?: unknown[] }) => {
    list.push(element.id);
    for (const child of (element.children ?? []) as Array<{ id: string }>) walk(child);
  };
  walk(schema);
  return list;
}

describe('a GLSP session', () => {
  test('requestModel answers with the file’s GModel, no requestBounds', async () => {
    const { root, sent } = await open(ISTAR_GLSP, 'welcome.txt');
    const model = parsePistar(files.get('welcome.txt')!);
    expect(root.type).toBe('graph');
    for (const id of model.elements.keys()) expect(ids(root)).toContain(id);
    for (const id of model.links.keys()) expect(ids(root)).toContain(id);
    expect(sent.map((m) => m.action.kind)).not.toContain('requestBounds');
  });

  test.each([
    ['kaos', KAOS_GLSP, 'kaos.txt', 'node:kaos.RefinementLinkHub'],
    ['nfr', NFR_GLSP, 'nfr.txt', 'node:link-anchor'],
  ] as const)('%s opens with its contribution', async (_, contribution, uri, type) => {
    const { root } = await open(contribution, uri);
    expect(JSON.stringify(root)).toContain(`"type":"${type}"`);
  });

  test('type hints come from the contribution’s metamodel', async () => {
    const { server, sent, clientId } = await open(NFR_GLSP, 'nfr.txt');
    server.process({ clientId, action: RequestTypeHintsAction.create() });
    const { action } = await next(sent, 'setTypeHints');
    const hints = action as unknown as { shapeHints: Array<{ elementTypeId: string }> };
    expect(hints.shapeHints.map((h) => h.elementTypeId)).toContain('node:nfr.NFR');
  });

  test('saveModel writes the store’s model with toPistar', async () => {
    const { server, sent, clientId } = await open(ISTAR_GLSP, 'welcome.txt');
    const from = sent.length;
    server.process({ clientId, action: SaveModelAction.create({ fileUri: 'saved.txt' }) });
    await next(sent, 'setDirtyState', from);
    const saved = parsePistar(files.get('saved.txt')!);
    const original = parsePistar(files.get('welcome.txt')!);
    expect(toPistar(saved, { saveDate: 'x' })).toBe(toPistar(original, { saveDate: 'x' }));
  });

  test('the session’s model state holds the store the dispatcher edits', async () => {
    const { server, clientId } = await open(ISTAR_GLSP, 'welcome.txt');
    const container = (server as DefaultGLSPServer).getClientSession(clientId)!.container;
    const state = container.get<IstarModelState>(ModelState);
    expect(state).toBeInstanceOf(IstarModelState);
    expect(container.get(IstarModelState)).toBe(state);
    const meta = metamodelOf(state.model);
    const actor = [...state.model.elements.values()].find(
      (e) => meta.elements.get(e.kind)?.category === 'actor',
    )!;
    const result = await state.dispatcher.dispatch({
      kind: 'createNode',
      elementTypeId: 'istar.Goal',
      containerId: actor.id,
      location: { x: actor.x + 20, y: actor.y + 20 },
    });
    expect(result.ok).toBe(true);
    const created = result.ok ? result.createdIds?.[0] : undefined;
    expect(state.store.getModel().elements.has(created!)).toBe(true);
    container.get<GModelFactory>(GModelFactory).createModel();
    expect(state.index.get(created!).type).toBe('node:istar.Goal');
  });
});
