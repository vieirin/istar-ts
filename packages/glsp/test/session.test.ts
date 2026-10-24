/**
 * The diagram module in a real GLSP server (in process, no transport): a client initializes,
 * opens a session for a diagram type, requests a model and gets the GModel of the file, with
 * no bounds round trip. Then the model state's store is the one the dispatcher edits.
 */
import { describe, expect, test } from 'vitest';
import type { GModelRootSchema } from '@eclipse-glsp/server';
import type { DefaultGLSPServer } from '@eclipse-glsp/server';
import {
  GModelFactory,
  ModelState,
  RequestTypeHintsAction,
  SaveModelAction,
} from '@eclipse-glsp/server';
import { metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import { ISTAR_GLSP, IstarModelState } from '../src';
import { KAOS_GLSP } from '../src/kaos';
import { NFR_GLSP } from '../src/nfr';
import { files, next, open } from './server';

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
