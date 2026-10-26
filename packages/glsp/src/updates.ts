/**
 * Model updates for changes this session did not make. The store may have other clients (a
 * React Flow canvas, a script, a second protocol endpoint on the same dispatcher); whatever they
 * change, undo, redo or save, the GLSP client gets the new GModel (`updateModel`) or dirty state
 * (`setDirtyState`), as it does after its own operations. That is what lets two clients share
 * one model.
 *
 * Also here: the quiet forwarder, so actions GLSP sends to a client that never asked for them
 * are dropped instead of failing.
 */
import type { AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import {
  ActionDispatcher,
  CenterAction,
  CheckEdgeResultAction,
  ClientAction,
  ClientActionForwarder,
  ClientActionKinds,
  ClientId,
  ClientSessionManager,
  DeleteMarkersAction,
  EndProgressAction,
  ExportSvgAction,
  FitToScreenAction,
  GModelFactory,
  Logger,
  MessageAction,
  ModelState,
  ModelSubmissionHandler,
  NavigateToExternalTargetAction,
  NavigateToTargetAction,
  SelectAction,
  SelectAllAction,
  SetClipboardDataAction,
  SetContextActions,
  SetDirtyStateAction,
  SetEditModeAction,
  SetEditValidationResultAction,
  SetMarkersAction,
  SetModelAction,
  SetNavigationTargetsAction,
  SetPopupModelAction,
  SetResolvedNavigationTargetAction,
  SetTypeHintsAction,
  SourceModelChangedAction,
  StartProgressAction,
  StatusAction,
  TriggerEdgeCreationAction,
  TriggerNodeCreationAction,
  UpdateModelAction,
  UpdateProgressAction,
} from '@eclipse-glsp/server';
import type {
  Action,
  ActionHandler,
  ClientSessionInitializer,
  ClientSessionListener,
  ModelValidator,
} from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { liveTypeHints } from './diagram-configuration';
import type { IstarModelState } from './model-state';

/**
 * Server-internal: the store changed, and not through this session. `IstarStoreListener`
 * dispatches it to the session's own action queue, so the update is ordered with the session's
 * other actions; `IstarStoreChangedHandler` answers it with the update.
 */
export const ISTAR_STORE_CHANGED = 'istar.storeChanged';

/**
 * `ModelSubmissionHandler` debounces live validation by 100ms (`liveValidationDelay`) after
 * every submission, with no public hook to cancel the pending timer. A session disposed inside
 * that window still fires the debounced validation into its now-stopped `ActionQueue`
 * (`DefaultActionDispatcher.dispatch` rejects with "ActionQueue is stopped"), an unhandled
 * rejection — not just a test-teardown race, real clients closing mid-debounce hit this too
 * (#116). `cancelPendingLiveValidation` reaches the (protected, but same-module) timer so a
 * session's dispose can stop it before it fires, or drop what it finds if it already started.
 */
@injectable()
export class IstarModelSubmissionHandler extends ModelSubmissionHandler {
  private cancelled = false;

  /**
   * Stops the debounced live validation, and one already running: its markers, which would be
   * dispatched after the validator's own round trip to the model's dispatcher (an async one, a
   * `createRemoteDispatcher` over a port), are dropped instead (#249).
   */
  cancelPendingLiveValidation(): void {
    this.cancelled = true;
    this.debouncedLiveValidation?.cancel();
  }

  protected override async performLiveValidation(validator: ModelValidator): Promise<void> {
    if (this.cancelled) return;
    try {
      await super.performLiveValidation(validator);
    } catch (error) {
      // The session was disposed while the validator waited: its `ActionQueue` is stopped.
      if (!this.cancelled) throw error;
    }
  }
}

/**
 * Hears the session's dispatcher and queues an update for every change this session did not
 * make (`IstarModelState.ownChange`): `updateModel` after an edit, undo, redo or load, and
 * `setDirtyState` after a save. Changes that come before the queued update is sent share it.
 *
 * It unsubscribes when its session is disposed, cancels any live validation still debouncing
 * (`IstarModelSubmissionHandler`), and disposes the model state then (which stops a dispatcher
 * the session owns): on a shared store (`IstarSharedModel`) the dispatcher outlives every
 * session.
 *
 * On a shared store the host's model is already there when the session is created — before any
 * client sends `requestModel` (#225: an MCP tool call can arrive first, e.g. a slow viewer, and
 * needs the GModel/index to act on the model that's already loaded). So `initialize` builds the
 * GModel root right away on a shared session, instead of waiting for the client's own
 * `requestModel` to do it (`RequestModelActionHandler` → `ModelSubmissionHandler.submitModel` →
 * `GModelFactory.createModel`, which still runs again, harmlessly, once the client does ask).
 */
@injectable()
export class IstarStoreListener implements ClientSessionInitializer {
  protected readonly state: IstarModelState;
  protected readonly actions: ActionDispatcher;
  protected readonly logger: Logger;
  protected readonly sessions: ClientSessionManager;
  protected readonly clientId: string;
  protected readonly submission: IstarModelSubmissionHandler;
  protected readonly gmodelFactory: GModelFactory;
  private pending: 'model' | 'dirty' | undefined;
  /** Whether the pending `'model'` update also needs a fresh `setTypeHints` (the metamodel
   * changed since the last one was sent — #97, a load extended it with a file's own kinds). */
  private pendingHints = false;
  private lastMetamodel: AnyMetamodel;

  constructor(
    @inject(ModelState) state: IstarModelState,
    @inject(ActionDispatcher) actions: ActionDispatcher,
    @inject(Logger) logger: Logger,
    @inject(ClientSessionManager) sessions: ClientSessionManager,
    @inject(ClientId) clientId: string,
    @inject(ModelSubmissionHandler) submission: IstarModelSubmissionHandler,
    @inject(GModelFactory) gmodelFactory: GModelFactory,
  ) {
    this.state = state;
    this.actions = actions;
    this.logger = logger;
    this.sessions = sessions;
    this.clientId = clientId;
    this.submission = submission;
    this.gmodelFactory = gmodelFactory;
    this.lastMetamodel = metamodelOf(state.model) as unknown as AnyMetamodel;
  }

  initialize(): void {
    if (this.state.isShared && !this.state.root) this.gmodelFactory.createModel();
    const unsubscribe = this.state.dispatcher.subscribe((action) => {
      if (this.state.isOwnChange) return;
      if (action.kind === 'sourceModelChanged') {
        const metamodel = metamodelOf(this.state.model) as unknown as AnyMetamodel;
        if (metamodel !== this.lastMetamodel) {
          this.lastMetamodel = metamodel;
          this.pendingHints = true;
        }
        this.schedule('model');
      }
      // A save made through GLSP is reported by GLSP's own save handler.
      else if (
        action.kind === 'setDirtyState' &&
        action.reason === 'save' &&
        !this.state.isSavingFromGlsp
      ) {
        this.schedule('dirty');
      }
    });
    const listener: ClientSessionListener = {
      sessionDisposed: () => {
        unsubscribe();
        this.submission.cancelPendingLiveValidation();
        this.state.dispose();
        this.sessions.removeListener(listener);
      },
    };
    this.sessions.addListener(listener, this.clientId);
  }

  /**
   * Pushes the model again, as after another client's change: the session's GModel showed a
   * draft that was then dropped (`IstarOperationRunner.group`).
   */
  refresh(): void {
    this.schedule('model');
  }

  /** What the queued update has to send; clears it. */
  take(): 'model' | 'dirty' | undefined {
    const pending = this.pending;
    this.pending = undefined;
    return pending;
  }

  /** Whether the update just taken also needs a fresh `setTypeHints`; clears it. */
  takeHints(): boolean {
    const pending = this.pendingHints;
    this.pendingHints = false;
    return pending;
  }

  protected schedule(what: 'model' | 'dirty'): void {
    const queued = this.pending !== undefined;
    if (this.pending !== 'model') this.pending = what;
    if (queued) return;
    this.actions.dispatch({ kind: ISTAR_STORE_CHANGED }).catch((error: unknown) => {
      this.logger.error('Could not push a change made by another client', error);
    });
  }
}

/** Answers `ISTAR_STORE_CHANGED` with the new GModel (`updateModel`) or dirty state. */
@injectable()
export class IstarStoreChangedHandler implements ActionHandler {
  readonly actionKinds: string[] = [ISTAR_STORE_CHANGED];
  protected readonly state: IstarModelState;
  protected readonly listener: IstarStoreListener;
  protected readonly submission: ModelSubmissionHandler;

  constructor(
    @inject(ModelState) state: IstarModelState,
    @inject(IstarStoreListener) listener: IstarStoreListener,
    @inject(ModelSubmissionHandler) submission: ModelSubmissionHandler,
  ) {
    this.state = state;
    this.listener = listener;
    this.submission = submission;
  }

  async execute(_action: Action): Promise<Action[]> {
    const pending = this.listener.take();
    // Before the client's `requestModel` there is no GModel to update.
    if (pending === undefined || !this.state.root) return [];
    if (pending === 'dirty') {
      return [SetDirtyStateAction.create(this.state.dispatcher.isDirty(), { reason: 'save' })];
    }
    const update = await this.submission.submitModel('external');
    // Another client's load extended the metamodel (#97): the file-declared kinds' type hints,
    // sent again as `IstarRequestTypeHintsActionHandler` would answer them now.
    if (!this.listener.takeHints()) return update;
    const hints = liveTypeHints(this.state.contribution, this.state.model);
    return [
      ...update,
      SetTypeHintsAction.create({
        shapeHints: hints.shapeTypeHints,
        edgeHints: hints.edgeTypeHints,
      }),
    ];
  }
}

/**
 * The actions a GLSP server sends to its client, from `@eclipse-glsp/protocol`'s action
 * definitions: notifications, responses and client commands. A client lists the ones it handles
 * in `clientActionKinds` (`initializeClientSession`).
 */
export const CLIENT_BOUND_ACTION_KINDS: ReadonlySet<string> = new Set([
  SetModelAction.KIND,
  UpdateModelAction.KIND,
  SourceModelChangedAction.KIND,
  SetDirtyStateAction.KIND,
  StatusAction.KIND,
  MessageAction.KIND,
  StartProgressAction.KIND,
  UpdateProgressAction.KIND,
  EndProgressAction.KIND,
  SetMarkersAction.KIND,
  DeleteMarkersAction.KIND,
  SetTypeHintsAction.KIND,
  SetContextActions.KIND,
  CheckEdgeResultAction.KIND,
  SetPopupModelAction.KIND,
  SetEditValidationResultAction.KIND,
  SetEditModeAction.KIND,
  SetNavigationTargetsAction.KIND,
  SetResolvedNavigationTargetAction.KIND,
  NavigateToTargetAction.KIND,
  NavigateToExternalTargetAction.KIND,
  SetClipboardDataAction.KIND,
  ExportSvgAction.KIND,
  SelectAction.KIND,
  SelectAllAction.KIND,
  CenterAction.KIND,
  FitToScreenAction.KIND,
  TriggerNodeCreationAction.KIND,
  TriggerEdgeCreationAction.KIND,
]);

/**
 * GLSP's forwarder, quiet about client-bound actions the client did not list: a `status` from
 * live validation, a `message` about a rejection, to a client that shows neither, is dropped
 * (GLSP would fail with "No handler registered"). Any other unhandled kind still fails.
 */
@injectable()
export class IstarClientActionForwarder extends ClientActionForwarder {
  constructor(@inject(ClientActionKinds) actionKinds: Set<string>) {
    super(actionKinds);
  }

  override handle(action: Action): boolean {
    if (super.handle(action)) return true;
    return !ClientAction.is(action) && CLIENT_BOUND_ACTION_KINDS.has(action.kind);
  }
}
