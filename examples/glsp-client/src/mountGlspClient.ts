/**
 * Mounts the stock `@eclipse-glsp/client` (default views, default modules) into a DOM element,
 * against an `@istar-ts/glsp` server (#74 S2). Reusable: the in-page route (#83, the default —
 * a `MessageChannel` port over the page's own `serveIstarGlsp`), the module-worker route
 * (`?server=worker`, over an already-created `Worker`) and the Node launcher route
 * (`?server=ws://...`) all just build a different `ConnectionProvider` (`./connection`) and call
 * this the same way; #85 (side by side) reuses it unchanged.
 */
import 'reflect-metadata';

import type {
  Action,
  ConnectionProvider,
  GLSPClient,
  IActionDispatcher,
  MessageAction,
} from '@eclipse-glsp/client';
import {
  BaseJsonrpcGLSPClient,
  DiagramLoader,
  FeatureModule,
  FitToScreenAction,
  MessageAction as MessageActionNS,
  STANDALONE_MODULE_CONFIG,
  TYPES,
  createDiagramOptionsModule,
  initializeDiagramContainer,
  onAction,
} from '@eclipse-glsp/client';
import { Container } from 'inversify';
import type { GlspPortLike } from './connection';
import { portConnectionProvider, websocketConnectionProvider } from './connection';
import { configureIstarModelElements } from './elementTypes';

export interface MountGlspClientOptions {
  /** The GLSP diagram type (`IstarGlspContribution.diagramType`). Default `'istar'`. */
  readonly diagramType?: string;
  /** Unique per mount; also the id this sets on `element` (GLSP's `baseDiv`). Default: generated. */
  readonly clientId?: string;
  /** `requestModel`'s `sourceUri`. Ignored once a session is shared (`@istar-ts/glsp`'s README). */
  readonly sourceUri: string;
  /** Every GModel type the model may contain (`gmodelTypes(metamodel, overrides).all`). */
  readonly types: readonly string[];
  /** The in-page `MessageChannel` port (default), or an already-created module `Worker`. */
  readonly port?: GlspPortLike;
  /** A Node launcher's WebSocket URL, instead of `port`. */
  readonly url?: string;
  /**
   * Rejections and other server messages: a standalone client's default modules only log a
   * `message` (`FallbackActionHandler`), so without this a rejected edit shows nothing (#83's
   * "gaps from b82"). `status` and `setMarkers` already surface through the default status and
   * validation modules.
   */
  readonly onMessage?: (message: MessageAction) => void;
}

export interface MountedGlspClient {
  /** Resolves once the initial model has loaded. */
  readonly ready: Promise<void>;
  /**
   * Sends an action on this client's own dispatcher, e.g. `UndoAction.create()`: the stock
   * client's default modules have no undo/redo *button*, only a keyboard shortcut
   * (`GLSPUndoRedoKeyListener`, Ctrl/Cmd+Z), so a host page that wants its own control (a
   * toolbar button, a test) dispatches directly instead.
   */
  dispatch(action: Action): Promise<void>;
  /** Disposes the container; does not close `port`/the WebSocket (the caller owns those). */
  dispose(): void;
}

/** A module binding `onMessage` as an extra `MessageAction` handler, next to the fallback one. */
function messageModule(onMessage: MountGlspClientOptions['onMessage']): FeatureModule {
  return new FeatureModule((bind, unbind, isBound, rebind) => {
    if (!onMessage) return;
    const context = { bind, unbind, isBound, rebind };
    onAction(context, MessageActionNS.KIND, (action) => {
      if (MessageActionNS.is(action)) onMessage(action);
    });
  });
}

function connectionProviderFor(options: MountGlspClientOptions): ConnectionProvider {
  if (options.port) return portConnectionProvider(options.port);
  if (options.url) return websocketConnectionProvider(options.url);
  throw new Error('mountGlspClient needs a "port" or a "url"');
}

/**
 * Builds a standalone GLSP diagram container (default modules, default views plus this
 * metamodel's concrete types), connects it and loads `sourceUri`. `element` gets its `id` set to
 * the resolved `clientId` (GLSP's `baseDiv`, where the SVG canvas renders).
 */
export function mountGlspClient(
  element: HTMLElement,
  options: MountGlspClientOptions,
): MountedGlspClient {
  const clientId = options.clientId ?? `glsp-client_${Math.random().toString(36).slice(2)}`;
  const diagramType = options.diagramType ?? 'istar';
  element.id = clientId;

  const connectionProvider = connectionProviderFor(options);
  let glspClient: GLSPClient | undefined;
  const glspClientProvider = async (): Promise<GLSPClient> => {
    glspClient ??= new BaseJsonrpcGLSPClient({ id: clientId, connectionProvider });
    return glspClient;
  };

  const container = new Container();
  initializeDiagramContainer(
    container,
    createDiagramOptionsModule({
      clientId,
      diagramType,
      sourceUri: options.sourceUri,
      glspClientProvider,
    }),
    {
      add: [
        new FeatureModule(
          (bind, _unbind, isBound) => configureIstarModelElements({ bind, isBound }, options.types),
          { featureId: Symbol('istarModelElements') },
        ),
        messageModule(options.onMessage),
      ],
    },
    STANDALONE_MODULE_CONFIG,
  );
  const dispatcher = container.get<IActionDispatcher>(TYPES.IActionDispatcher);

  // The standalone container never auto-fits the viewport to the loaded model (upstream leaves
  // that to the app, e.g. an IDE host's own "fit to screen" command); without this, a model
  // whose elements sit outside the initial 1:1 viewport at the origin renders empty.
  const ready = container
    .get(DiagramLoader)
    .load()
    .then(() => dispatcher.dispatch(FitToScreenAction.create([], { animate: false })));
  return {
    ready,
    dispatch: (action) => dispatcher.dispatch(action),
    dispose: () => void glspClient?.stop(),
  };
}
