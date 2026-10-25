/**
 * `/both.html`: the React Flow canvas and the stock `@eclipse-glsp/client`, side by side over
 * one `ModelStore` and one dispatcher (#74 S4, #85). The GLSP server runs in this page
 * (`serveIstarGlsp`, over an in-page `MessageChannel`), on the canvas's own store and
 * dispatcher — the route `packages/glsp`'s README recommends for this exact page, since
 * the canvas renders the very store the GLSP server edits. `?server=worker` is the other route
 * (`WorkerBothApp`): the model in a worker, the canvas on a mirror of it.
 *
 * One dispatcher, wrapped twice for the protocol lab's log (`tagClient`, as `App.tsx` does for
 * "Canvas"/"Inspector"): "React" for the canvas's edits, "GLSP" for the ones the GLSP operation
 * handlers make on the shared session (`@istar-ts/glsp`'s `IstarSharedModel`). Both wrappers
 * delegate to the same underlying dispatcher, so there is exactly one undo stack — undoing
 * either client's last edit undoes the other's too, if it was more recent.
 */
import type { StoreActionDispatcher } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { createEmptyModel, metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type { AnyIstarRegistry } from '@istar-ts/react';
import {
  IstarCanvas,
  defaultRegistry,
  registryForMetamodel,
  registrySizes,
  useIstarEditor,
  useIstarStore,
} from '@istar-ts/react';
import { ISTAR_GLSP, contributionFor, gmodelTypes, paletteOf } from '@istar-ts/glsp';
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
import { mountGlspClient } from 'glsp-client';
import type { MountedGlspClient } from 'glsp-client';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import welcomeText from '../../../../fixtures/pistar/welcome.txt?raw';
import { AgentPanel } from '../agent/AgentPanel';
import { ActionLog } from '../lab/ActionLog';
import { createLogStore } from '../lab/log';
import { tagClient } from '../lab/tagClient';

const SOURCE_URI = 'welcome.txt';

function initialModel(): AnyIstarModel {
  try {
    return parsePistar(welcomeText, { metamodel: ISTAR_GLSP.metamodel });
  } catch {
    return createEmptyModel(undefined, { metamodel: ISTAR_GLSP.metamodel });
  }
}

/** The action log, inside `<IstarCanvas>`'s `aside` (its own `IstarProvider`, for `select`). */
function LogPanel({
  log,
  model,
}: {
  readonly log: ReturnType<typeof createLogStore>;
  readonly model: AnyIstarModel;
}): ReactElement {
  const { select } = useIstarEditor();
  return (
    <section className="pg-both-log">
      <h2 className="pg-aside-heading">Action log</h2>
      <ActionLog log={log} model={model} select={select} />
    </section>
  );
}

export function BothApp(): ReactElement {
  const { store, model } = useIstarStore(initialModel);
  // Shared by the React canvas and the GLSP contribution, so both draw a kind at the same size
  // even when a host overrides it independently of the metamodel (#154).
  const registry = useMemo(
    () =>
      registryForMetamodel(ISTAR_GLSP.metamodel, defaultRegistry) as unknown as AnyIstarRegistry,
    [],
  );
  const contribution = useMemo(
    () => contributionFor(ISTAR_GLSP.metamodel, { ...ISTAR_GLSP, sizes: registrySizes(registry) }),
    [registry],
  );
  const [log] = useState(() => createLogStore());
  useEffect(() => log.attachStore(store), [log, store]);

  // Matches the GLSP side's own answer (`host.ts`'s `paletteOf(contribution)`): same underlying
  // model and session, so the React canvas and the stock GLSP client offer the same tools
  // (#202: without it, the default palette follows the metamodel directly, piStar-faithful
  // short labels like "And" aside).
  const [dispatcher] = useState(() =>
    createActionDispatcher(store, { palette: paletteOf(contribution) }),
  );
  const [reactDispatcher] = useState(() => tagClient(dispatcher, 'React', log));
  // Same underlying dispatcher as `reactDispatcher`, tagged "GLSP" and reshaped to
  // `StoreActionDispatcher` (`isDirty`/`dispose` pass through), as `@istar-ts/glsp`'s
  // `IstarSharedModel` requires.
  const [glspDispatcher] = useState<StoreActionDispatcher<string, string>>(
    () =>
      Object.assign(tagClient(dispatcher, 'GLSP', log), {
        isDirty: () => dispatcher.isDirty(),
        dispose: () => dispatcher.dispose(),
      }) as StoreActionDispatcher<string, string>,
  );
  // The agent drawer's own headless GLSP+MCP session (#126 D4, #131 item 7), tagged "Agent" so
  // its applied tool calls show up as their own client in the log, same underlying dispatcher.
  // Reshaped to `StoreActionDispatcher` like `glspDispatcher`: `serveIstarGlsp`'s shared model
  // needs the full shape.
  const [agentDispatcher] = useState<StoreActionDispatcher<string, string>>(
    () =>
      Object.assign(tagClient(dispatcher, 'Agent', log), {
        isDirty: () => dispatcher.isDirty(),
        dispose: () => dispatcher.dispose(),
      }) as StoreActionDispatcher<string, string>,
  );

  const glspContainerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<MountedGlspClient | undefined>(undefined);
  const [status, setStatus] = useState<{ message: string; severity: string }>({
    message: '',
    severity: 'NONE',
  });

  useEffect(() => {
    const element = glspContainerRef.current;
    if (!element) return;
    const channel = new MessageChannel();
    const server = serveIstarGlsp(channel.port2 as never, {
      shared: { store, dispatcher: glspDispatcher },
      contributions: [contribution],
    });
    const client = mountGlspClient(element, {
      diagramType: contribution.diagramType,
      sourceUri: SOURCE_URI,
      types: gmodelTypes(contribution.metamodel).all,
      metamodel: contribution.metamodel,
      port: channel.port1,
      onMessage: (action) => setStatus({ message: action.message, severity: action.severity }),
    });
    clientRef.current = client;
    void client.ready;
    return () => {
      clientRef.current = undefined;
      client.dispose();
      server.close();
      channel.port1.close();
      channel.port2.close();
    };
    // Runs once: the shared store/dispatcher and the contribution (same registry for the page's
    // lifetime) never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = (): void => void clientRef.current?.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Both buttons act on the shared dispatcher directly (not through either client): the GLSP
  // client's own undo/redo (its keyboard shortcut) reaches the same stack through its operation
  // handler instead, so either route lands on the one stack.
  const onUndo = (): void => void dispatcher.dispatch({ kind: 'glspUndo' });
  const onRedo = (): void => void dispatcher.dispatch({ kind: 'glspRedo' });

  // For the cross-client e2e suite (#85): a `toPistar` snapshot, the same way `App.tsx`'s own
  // "Save" button does, to check the file is byte-identical after a mixed session is undone.
  const onSave = (): void => {
    const text = toPistar(model, { saveDate: new Date() });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'goalModel.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pg-both">
      <header className="pg-both-toolbar">
        <a className="pg-both-back" href="/">
          ← istar-ts examples
        </a>
        <p className="pg-both-note">
          One model, one undo stack: undo/redo act on the last edit from either client.
        </p>
        <button type="button" onClick={onUndo}>
          Undo
        </button>
        <button type="button" onClick={onRedo}>
          Redo
        </button>
        <button type="button" onClick={onSave}>
          Save
        </button>
        <span className="pg-glsp-status" data-severity={status.severity}>
          {status.message}
        </span>
      </header>
      <div className="pg-both-panes">
        <div className="pg-both-react">
          <IstarCanvas
            store={store}
            dispatcher={reactDispatcher}
            registry={registry}
            palette="left"
            aside={
              <div className="pg-both-aside">
                <LogPanel log={log} model={model} />
                <section className="pg-both-log">
                  <h2 className="pg-aside-heading">Agent</h2>
                  <AgentPanel
                    store={store}
                    dispatcher={agentDispatcher}
                    guards={[]}
                    schemas={[]}
                    metamodel={metamodelOf(model) as AnyMetamodel}
                  />
                </section>
              </div>
            }
          />
        </div>
        <div className="pg-both-glsp">
          <div ref={glspContainerRef} className="pg-both-glsp-diagram" />
        </div>
      </div>
    </div>
  );
}
