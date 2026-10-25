/**
 * `/glsp.html`: the stock `@eclipse-glsp/client`, over `@istar-ts/glsp` (#74 S2, #83). Default
 * connection is in-page (`serveIstarGlsp` over this page's own store and dispatcher, shared with
 * the stock client through a `MessageChannel`); `?server=worker` uses the Vite module worker
 * (`./worker.ts`), `?server=ws://host:port/path` connects to the Node launcher
 * (`pnpm --filter @istar-ts/glsp serve <fixture>`). `?debug=actions` logs the client ↔ server
 * action traffic to the console. Kept out of `/react.html`'s bundle: nothing here is imported
 * from `main.tsx`/`App.tsx`.
 */
import type { AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import type { IstarGlspContribution } from '@istar-ts/glsp';
import { ISTAR_GLSP, createIstarSharedModel, gmodelTypes } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { KAOS_GLSP } from '@istar-ts/glsp/kaos';
import { NFR_GLSP } from '@istar-ts/glsp/nfr';
import { connectWorkerMcp } from '@istar-ts/glsp/page';
import { mountGlspClient, redoAction, undoAction } from 'glsp-client';
import type { MountedGlspClient } from 'glsp-client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import istar2Welcome from '../../../../fixtures/pistar/welcome.txt?raw';
import kaosWelcome from '../../../../fixtures/dsm3/kaos-welcome.txt?raw';
import nfrWelcome from '../../../../fixtures/dsm3/nfr-welcome.txt?raw';
import fileMetamodel from '../../../../fixtures/extensions/fileMetamodel.txt?raw';

interface FixtureEntry {
  readonly label: string;
  readonly text: string;
  readonly sourceUri: string;
  readonly contribution: IstarGlspContribution;
}

/** One fixture per contribution (#83's "iStar plus one KAOS and one NFR"), plus one (#97) whose
 * own `"metamodel"` block extends iStar 2.0 with kinds (`ra4.Plan`, …) the contribution itself
 * never declares. */
const FIXTURES: readonly FixtureEntry[] = [
  {
    label: 'iStar 2.0 — welcome',
    text: istar2Welcome,
    sourceUri: 'welcome.txt',
    contribution: ISTAR_GLSP,
  },
  {
    label: 'KAOS — welcome',
    text: kaosWelcome,
    sourceUri: 'kaos-welcome.txt',
    contribution: KAOS_GLSP,
  },
  {
    label: 'NFR — welcome',
    text: nfrWelcome,
    sourceUri: 'nfr-welcome.txt',
    contribution: NFR_GLSP,
  },
  {
    label: 'iStar 2.0 — file metamodel',
    text: fileMetamodel,
    sourceUri: 'fileMetamodel.txt',
    contribution: ISTAR_GLSP,
  },
];

const params = new URLSearchParams(location.search);
/** `?debug=actions` logs the client ↔ server action traffic to the console. */
const logActions = params.get('debug') === 'actions';

// Cast, not just narrow: a `function` declaration below loses an enclosing `if`'s narrowing of
// these (TS doesn't track that they're only ever called afterwards), so the guard below is a
// runtime check only.
const canvas = document.getElementById('pg-glsp-canvas') as HTMLElement;
const select = document.getElementById('pg-glsp-fixture') as HTMLSelectElement;
const status = document.getElementById('pg-glsp-status') as HTMLElement;
const undoButton = document.getElementById('pg-glsp-undo') as HTMLButtonElement;
const redoButton = document.getElementById('pg-glsp-redo') as HTMLButtonElement;
if (!canvas || !(select instanceof HTMLSelectElement) || !status || !undoButton || !redoButton) {
  throw new Error('glsp.html is missing its canvas, fixture select, status or undo/redo elements');
}

function showMessage(message: string, severity: string): void {
  status.textContent = message;
  status.dataset.severity = severity;
}

function freshDiagramElement(): HTMLDivElement {
  canvas.replaceChildren();
  const element = document.createElement('div');
  element.className = 'pg-glsp-diagram';
  canvas.append(element);
  return element;
}

interface MountedFixture {
  close(): void;
}

let current: MountedFixture | undefined;
let currentClient: MountedGlspClient | undefined;

undoButton.addEventListener('click', () => void currentClient?.dispatch(undoAction()));
redoButton.addEventListener('click', () => void currentClient?.dispatch(redoAction()));

// The standalone container never re-fits on its own (#103): a window resize leaves the old
// viewport framing, now wrong relative to `.pg-glsp-diagram`'s new size. A fixture switch
// already gets a fresh fit from `mountGlspClient`'s own `ready` (every `mountFixture` call
// mounts a new client), so only resize needs handling here.
window.addEventListener('resize', () => void currentClient?.fit());

/**
 * Each fixture is a different contribution (metamodel, diagram type), so switching fixtures
 * tears down the previous session's store, server and client and builds a fresh one for the
 * selection, rather than reconnecting an existing session: `requestModel`'s `sourceUri` is
 * ignored once a session is shared (`@istar-ts/glsp`'s README "Hosting"), so there is nothing a
 * stock client could ask for a second fixture on the same session.
 */
async function mountFixture(fixture: FixtureEntry): Promise<void> {
  current?.close();
  const element = freshDiagramElement();

  const shared = createIstarSharedModel(fixture.contribution, {
    model: fixture.text,
    sourceModelName: fixture.sourceUri,
  });
  // The loaded model's own metamodel, not the contribution's fixed one: a fixture's own
  // `"metamodel"` block (#97) extends it before the client's view types are registered, so a
  // file-declared kind gets a view too, not just a server-side GModel type.
  const metamodel = metamodelOf(shared.store.getModel()) as unknown as AnyMetamodel;
  const channel = new MessageChannel();
  // `serveIstarGlsp`'s own `GlspPortLike` (packages/glsp/src/browser.ts) is structurally
  // narrower than DOM's `MessagePort`, the same mismatch `startIstarGlspWorker` works around.
  const server = serveIstarGlsp(channel.port2 as never, {
    shared,
    contributions: [fixture.contribution],
  });
  const client = mountGlspClient(element, {
    diagramType: fixture.contribution.diagramType,
    sourceUri: fixture.sourceUri,
    types: gmodelTypes(metamodel, fixture.contribution.types).all,
    metamodel,
    port: channel.port1,
    onMessage: (action) => showMessage(action.message, action.severity),
    logActions,
  });
  currentClient = client;
  current = {
    close: () => {
      client.dispose();
      server.close();
      channel.port1.close();
      channel.port2.close();
    },
  };
  showMessage(`Opening "${fixture.label}"…`, 'INFO');
  await client.ready;
  showMessage('', 'NONE');
}

/** The stock client's own session id on `?server=worker`, also the MCP tools' `sessionId`. */
const WORKER_CLIENT_ID = 'glsp-worker';

declare global {
  interface Window {
    /** `?server=worker&mcp=1`'s MCP SDK client, for the e2e suite to drive (#134). */
    glspWorkerMcp?: Client;
  }
}

/**
 * `?server=worker&mcp=1`: on top of the stock client, an MCP SDK client over the worker's
 * `McpWorkerBridge` (`connectWorkerMcp`, #134), exposed on `window` for the e2e suite to drive —
 * out of scope here is wiring the agent drawer itself to the worker (it uses in-page MCP).
 */
async function mountWorkerMcp(worker: Worker): Promise<void> {
  const mcp = connectWorkerMcp(worker);
  const client = new Client({ name: 'istar-ts-playground-worker', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcp.url, { fetch: mcp.fetch }));
  window.glspWorkerMcp = client;
}

async function mountWorker(): Promise<void> {
  select.disabled = true;
  const element = freshDiagramElement();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const client = mountGlspClient(element, {
    clientId: WORKER_CLIENT_ID,
    sourceUri: 'welcome.txt',
    types: gmodelTypes(ISTAR_GLSP.metamodel).all,
    metamodel: ISTAR_GLSP.metamodel,
    port: worker,
    onMessage: (action) => showMessage(action.message, action.severity),
    logActions,
  });
  currentClient = client;
  await client.ready;
  if (params.get('mcp') === '1') await mountWorkerMcp(worker);
  showMessage('', 'NONE');
}

async function mountWebSocket(url: string, sourceUri: string): Promise<void> {
  select.disabled = true;
  const element = freshDiagramElement();
  const client = mountGlspClient(element, {
    sourceUri,
    types: gmodelTypes(ISTAR_GLSP.metamodel).all,
    metamodel: ISTAR_GLSP.metamodel,
    url,
    onMessage: (action) => showMessage(action.message, action.severity),
    logActions,
  });
  currentClient = client;
  await client.ready;
  showMessage('', 'NONE');
}

for (const [index, fixture] of FIXTURES.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = fixture.label;
  select.append(option);
}

const server = params.get('server');

if (server === 'worker') {
  select.disabled = true;
  void mountWorker();
} else if (server?.startsWith('ws://') || server?.startsWith('wss://')) {
  select.disabled = true;
  void mountWebSocket(server, params.get('sourceUri') ?? 'model.txt');
} else {
  select.addEventListener('change', () => {
    const fixture = FIXTURES[Number(select.value)];
    if (fixture) void mountFixture(fixture);
  });
  void mountFixture(FIXTURES[0]!);
}
