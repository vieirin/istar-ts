/**
 * `/both.html?server=worker`: the React Flow canvas and the stock GLSP client on one model that
 * lives in a Web Worker (`../glsp/worker.ts`, `startIstarGlspWorker`), not in this page (#99).
 * The GLSP client connects to the worker itself; the canvas renders a mirror store
 * (`createMirrorStore`) that follows the worker's dispatcher (`connectWorkerDispatcher`), and
 * every edit it makes is an action to that dispatcher. One model, one undo stack: the worker's.
 *
 * The worker, its dispatcher port and the mirror are made once per page load, outside React, so
 * StrictMode's double mount doesn't start a second worker or a second GLSP connection.
 */
import { createMirrorStore } from '@istar-ts/actions';
import type { AnyIstarRegistry } from '@istar-ts/react';
import {
  IstarCanvas,
  IstarInspector,
  defaultRegistry,
  registryForMetamodel,
} from '@istar-ts/react';
import { ISTAR_GLSP, gmodelTypes } from '@istar-ts/glsp';
import { connectWorkerDispatcher } from '@istar-ts/glsp/page';
import { mountGlspClient } from 'glsp-client';
import type { MountedGlspClient } from 'glsp-client';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

const SOURCE_URI = 'welcome.txt';

const worker = new Worker(new URL('../glsp/worker.ts', import.meta.url), { type: 'module' });
const remote = connectWorkerDispatcher(worker);
// The worker reads its file with the contribution's metamodel and the file's own block.
const mirror = createMirrorStore(remote, {
  metamodel: ISTAR_GLSP.metamodel,
  fileMetamodel: ISTAR_GLSP.fileMetamodel ?? true,
  onError: (error) => console.error('mirror store:', error),
});
const registry = registryForMetamodel(
  ISTAR_GLSP.metamodel,
  defaultRegistry,
) as unknown as AnyIstarRegistry;

let glspClient: MountedGlspClient | undefined;

const onUndo = (): void => void mirror.dispatcher.dispatch({ kind: 'glspUndo' });
const onRedo = (): void => void mirror.dispatcher.dispatch({ kind: 'glspRedo' });

// Saves the worker's model as the worker has it, asked for through its dispatcher: what the
// e2e suite checks a canvas edit against.
const onSave = async (): Promise<void> => {
  const result = await remote.dispatch({ kind: 'requestModel', requestId: 'save' });
  if (!result.ok || !result.response) return;
  const text = JSON.stringify(result.response.newRoot, null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = SOURCE_URI;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function WorkerBothApp(): ReactElement {
  const glspContainerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<{ message: string; severity: string }>({
    message: 'Starting the worker…',
    severity: 'INFO',
  });

  useEffect(() => {
    mirror.ready.then(
      () => {
        setReady(true);
        setStatus({ message: '', severity: 'NONE' });
      },
      (error: unknown) => setStatus({ message: String(error), severity: 'ERROR' }),
    );
  }, []);

  useEffect(() => {
    const element = glspContainerRef.current;
    // Once per page: the worker serves one GLSP connection, on itself.
    if (!element || glspClient) return;
    glspClient = mountGlspClient(element, {
      diagramType: ISTAR_GLSP.diagramType,
      sourceUri: SOURCE_URI,
      types: gmodelTypes(ISTAR_GLSP.metamodel).all,
      metamodel: ISTAR_GLSP.metamodel,
      port: worker,
      onMessage: (action) => setStatus({ message: action.message, severity: action.severity }),
    });
    const onResize = (): void => void glspClient?.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="pg-both">
      <header className="pg-both-toolbar">
        <a className="pg-both-back" href="/">
          ← istar-ts examples
        </a>
        <p className="pg-both-note">
          The model lives in a Web Worker: the canvas renders a mirror of it, the GLSP client
          connects to it. One model, one undo stack.
        </p>
        <button type="button" onClick={onUndo}>
          Undo
        </button>
        <button type="button" onClick={onRedo}>
          Redo
        </button>
        <button type="button" onClick={() => void onSave()}>
          Save
        </button>
        <span className="pg-glsp-status" data-severity={status.severity}>
          {status.message}
        </span>
      </header>
      <div className="pg-both-panes">
        <div className="pg-both-react">
          {ready && (
            <IstarCanvas
              store={mirror}
              dispatcher={mirror.dispatcher}
              registry={registry}
              palette="left"
              aside={<IstarInspector />}
            />
          )}
        </div>
        <div className="pg-both-glsp">
          <div ref={glspContainerRef} className="pg-both-glsp-diagram" />
        </div>
      </div>
    </div>
  );
}
