/**
 * `/glsp.html`: the stock `@eclipse-glsp/client`, over `@istar-ts/glsp` (#74 S2, #83). Default
 * connection is in-page (`serveIstarGlsp` over this page's own store and dispatcher, shared with
 * the stock client through a `MessageChannel`); `?server=worker` uses the Vite module worker
 * (`./worker.ts`), `?server=ws://host:port/path` connects to the Node launcher
 * (`pnpm --filter @istar-ts/glsp serve <fixture>`). Kept out of `/react.html`'s bundle: nothing
 * here is imported from `main.tsx`/`App.tsx`.
 */
import type { IstarGlspContribution } from '@istar-ts/glsp';
import { ISTAR_GLSP, createIstarSharedModel, gmodelTypes } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { KAOS_GLSP } from '@istar-ts/glsp/kaos';
import { NFR_GLSP } from '@istar-ts/glsp/nfr';
import { mountGlspClient, redoAction, undoAction } from 'glsp-client';
import type { MountedGlspClient } from 'glsp-client';
import istar2Welcome from '../../../../fixtures/pistar/welcome.txt?raw';
import kaosWelcome from '../../../../fixtures/dsm3/kaos-welcome.txt?raw';
import nfrWelcome from '../../../../fixtures/dsm3/nfr-welcome.txt?raw';

interface FixtureEntry {
  readonly label: string;
  readonly text: string;
  readonly sourceUri: string;
  readonly contribution: IstarGlspContribution;
}

/** One fixture per contribution (#83's "iStar plus one KAOS and one NFR"). */
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
];

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
    types: gmodelTypes(fixture.contribution.metamodel, fixture.contribution.types).all,
    port: channel.port1,
    onMessage: (action) => showMessage(action.message, action.severity),
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

async function mountWorker(): Promise<void> {
  select.disabled = true;
  const element = freshDiagramElement();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const client = mountGlspClient(element, {
    sourceUri: 'welcome.txt',
    types: gmodelTypes(ISTAR_GLSP.metamodel).all,
    port: worker,
    onMessage: (action) => showMessage(action.message, action.severity),
  });
  currentClient = client;
  await client.ready;
  showMessage('', 'NONE');
}

async function mountWebSocket(url: string, sourceUri: string): Promise<void> {
  select.disabled = true;
  const element = freshDiagramElement();
  const client = mountGlspClient(element, {
    sourceUri,
    types: gmodelTypes(ISTAR_GLSP.metamodel).all,
    url,
    onMessage: (action) => showMessage(action.message, action.severity),
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

const params = new URLSearchParams(location.search);
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
