// Links that target links (NFR's Argument): an anchor node on the middle of the target link,
// and the arguing link drawn to it.
import {
  ISTAR_2_0,
  createEmptyModel,
  createModelStore,
  extendMetamodel,
  parsePistar,
} from '@istar-ts/core';
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import { NFR } from '../../core/test/dsm3-roots';
import type { AnyIstarRegistry, IstarEditor } from '../src';
import {
  IstarCanvas,
  IstarProvider,
  modelToFlow,
  registryForMetamodel,
  useIstarEditor,
} from '../src';
import { LINK_ANCHOR_SIZE, linkAnchorId, linkIdOfAnchor } from '../src/layout';

const nfrWelcome = readFileSync(
  join(import.meta.dirname, '../../../fixtures/dsm3/nfr-welcome.txt'),
  'utf8',
);
const CONTRIBUTION = '3a57f4d9-a905-4b55-9d17-82e951a79558';
const ARGUMENT_SOURCE = '77371218-ae0f-4043-b500-9c75894788ee';

function nfrGraph() {
  const model = parsePistar(nfrWelcome, { metamodel: NFR });
  const registry = registryForMetamodel(NFR) as unknown as AnyIstarRegistry;
  return { model, graph: modelToFlow(model, registry) };
}

describe('link anchor ids', () => {
  test('round-trip a link id, and reject other node ids', () => {
    expect(linkIdOfAnchor(linkAnchorId('abc'))).toBe('abc');
    expect(linkIdOfAnchor('abc')).toBeUndefined();
  });
});

describe('modelToFlow with links that target links', () => {
  test('places one anchor on the middle of the contribution the argument points at', () => {
    const { model, graph } = nfrGraph();
    const anchors = graph.nodes.filter((n) => n.type === 'istarLinkAnchor');
    expect(anchors.map((n) => n.id)).toEqual([linkAnchorId(CONTRIBUTION)]);
    const anchor = anchors[0]!;
    expect(anchor).toMatchObject({
      width: LINK_ANCHOR_SIZE,
      height: LINK_ANCHOR_SIZE,
      draggable: false,
      selectable: false,
      connectable: true,
      data: { linkId: CONTRIBUTION },
    });
    // The contribution is straight: its middle is halfway between where it leaves and enters
    // its nodes, which lies on the segment between the two nodes' centres.
    const link = model.links.get(CONTRIBUTION)!;
    const centre = (id: string) => {
      const node = graph.nodes.find((n) => n.id === id)!;
      return { x: node.position.x + node.width! / 2, y: node.position.y + node.height! / 2 };
    };
    const a = centre(link.source);
    const b = centre(link.target);
    const m = {
      x: anchor.position.x + LINK_ANCHOR_SIZE / 2,
      y: anchor.position.y + LINK_ANCHOR_SIZE / 2,
    };
    const cross = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x);
    expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-6);
    expect(m.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x));
    expect(m.x).toBeLessThanOrEqual(Math.max(a.x, b.x));
  });

  test('draws the argument to the anchor, remembering the link it targets', () => {
    const { model, graph } = nfrGraph();
    const argument = [...model.links.values()].find((l) => l.kind === 'nfr.ArgumentLink')!;
    const edge = graph.edges.find((e) => e.id === argument.id)!;
    expect(edge).toMatchObject({
      source: ARGUMENT_SOURCE,
      target: linkAnchorId(CONTRIBUTION),
      data: { linkId: argument.id, targetLinkId: CONTRIBUTION },
    });
    // Every other edge is as before: element to element.
    expect(graph.edges.filter((e) => e.target.startsWith('istar-link-anchor:'))).toHaveLength(1);
  });

  test('hides a link whose target link is hidden in a collapsed actor, and emits no anchor', () => {
    const metamodel = extendMetamodel(ISTAR_2_0, {
      name: 'notes',
      links: [
        {
          kind: 'notes.About',
          rules: { sources: ['node'], targets: ['link'], sameActor: false },
        },
      ],
    });
    const store = createModelStore(createEmptyModel(undefined, { metamodel }));
    const inner = store.addElement({ kind: 'istar.Actor', x: 0, y: 0 });
    const a = store.addElement({ kind: 'istar.Goal', x: 20, y: 20, parent: inner.id });
    const b = store.addElement({ kind: 'istar.Goal', x: 20, y: 120, parent: inner.id });
    const outer = store.addElement({ kind: 'istar.Actor', x: 400, y: 0 });
    const note = store.addElement({ kind: 'istar.Goal', x: 420, y: 20, parent: outer.id });
    const refinement = store.connect({
      kind: 'istar.AndRefinementLink',
      source: a.id,
      target: b.id,
    });
    if (!refinement.ok) throw new Error(refinement.reason);
    const about = store.connect({
      kind: 'notes.About',
      source: note.id,
      target: refinement.link.id,
    });
    if (!about.ok) throw new Error(about.reason);
    const registry = registryForMetamodel(metamodel) as unknown as AnyIstarRegistry;

    const open = modelToFlow(store.getModel(), registry);
    expect(open.nodes.some((n) => n.type === 'istarLinkAnchor')).toBe(true);

    store.setCollapsed(inner.id, true);
    const collapsed = modelToFlow(store.getModel(), registry);
    expect(collapsed.nodes.some((n) => n.type === 'istarLinkAnchor')).toBe(false);
    expect(collapsed.edges.some((e) => e.id === about.link.id)).toBe(false);
  });
});

function renderNfr() {
  const store = createModelStore(parsePistar(nfrWelcome, { metamodel: NFR }));
  let editor: IstarEditor | undefined;
  function Grab(): null {
    const e = useIstarEditor();
    useEffect(() => {
      editor = e;
    });
    return null;
  }
  const utils = render(
    <IstarProvider store={store}>
      <Grab />
      <div style={{ width: 1200, height: 800 }}>
        <IstarCanvas />
      </div>
    </IstarProvider>,
  );
  return { ...utils, store, editor: () => editor! };
}
describe('IstarCanvas with links that target links', () => {
  test('shows anchors only while a tool whose links target links is active', () => {
    const { container, editor } = renderNfr();
    const flow = () => container.querySelector('.istar-canvas-flow')!;
    expect(container.querySelector(`[data-id="${linkAnchorId(CONTRIBUTION)}"]`)).toBeTruthy();
    expect(flow().classList.contains('is-linking-to-links')).toBe(false);
    act(() => editor().setTool({ type: 'link', kind: 'nfr.ArgumentLink' } as never));
    expect(flow().classList.contains('is-linking-to-links')).toBe(true);
    act(() =>
      editor().setTool({ type: 'link', kind: 'nfr.ContributionLink', value: '+' } as never),
    );
    expect(flow().classList.contains('is-linking-to-links')).toBe(false);
  });

  test('a connection dropped on an anchor is checked against the link itself', () => {
    const { editor, store } = renderNfr();
    act(() => editor().setTool({ type: 'link', kind: 'nfr.ArgumentLink' } as never));
    const claim = [...store.getModel().elements.values()].find((e) => e.kind === 'nfr.Claim')!;
    const other = [...store.getModel().links.values()].find(
      (l) => l.kind === 'nfr.ContributionLink' && l.id !== CONTRIBUTION,
    )!;
    expect(editor().checkConnection(claim.id, linkAnchorId(other.id))).toEqual({ ok: true });
    // One argument per pair: the claim already argues about CONTRIBUTION.
    expect(editor().checkConnection(claim.id, linkAnchorId(CONTRIBUTION))).toMatchObject({
      ok: false,
    });
  });

  test('draws the argument to the middle of its contribution', () => {
    const { container, store } = renderNfr();
    const argument = [...store.getModel().links.values()].find(
      (l) => l.kind === 'nfr.ArgumentLink',
    )!;
    const anchor = container.querySelector(`[data-id="${linkAnchorId(CONTRIBUTION)}"]`)!;
    const path = container
      .querySelector(`.react-flow__edge[data-id="${argument.id}"] .istar-link-line`)!
      .getAttribute('d')!;
    const numbers = path.match(/-?[\d.]+/g)!.map(Number);
    const [endX, endY] = numbers.slice(-2);
    const transform = (anchor as HTMLElement).style.transform;
    const [, x, y] = transform.match(/translate\((-?[\d.]+)px, *(-?[\d.]+)px\)/)!.map(Number);
    expect(endX).toBeCloseTo(x! + LINK_ANCHOR_SIZE / 2, 6);
    expect(endY).toBeCloseTo(y! + LINK_ANCHOR_SIZE / 2, 6);
  });
});
