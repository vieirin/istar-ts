/**
 * The session's model state: GLSP's `DefaultModelState` (the GModel root, its index, the client
 * options) plus the istar-ts model it shows, held in one `ModelStore` with its action dispatcher.
 *
 * By default the store is created once per session and never replaced: loading a file `load`s it
 * (and clears its history), so whatever wraps the store (the dispatcher here; `IstarCommandStack`,
 * which maps GLSP's undo and redo onto the dispatcher's `glspUndo`/`glspRedo`, framework-notes §7
 * "The undo conflict") keeps working across loads. When the host binds an `IstarSharedModel`, the
 * session uses that store and dispatcher instead, shared with every other session and with the
 * host's own clients (a React Flow canvas). The GModel is derived from `model` by the GModel
 * factory and is never edited directly.
 *
 * While a draft is open (`beginDraft`, around an MCP tool call, #223), `model` is the draft's and
 * `edit` applies operations to it instead of the store; `endDraft` hands back what was applied,
 * for the caller to dispatch to the store as one operation.
 */
import type { AnyIstarModel, ModelStore, PistarFile } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import type {
  ActionDispatcher,
  ActionResult,
  IstarOperation,
  SaveModelAction,
  StoreActionDispatcher,
} from '@istar-ts/actions';
import {
  createActionDispatcher,
  injectCreatedIds,
  isOperation,
  isRequestAction,
} from '@istar-ts/actions';
import { DefaultModelState, GLSPServerError } from '@eclipse-glsp/server';
import { inject, injectable, optional } from 'inversify';
import { IstarGlspContribution, paletteOf } from './contribution';
import { PistarFiles } from './files';

/**
 * A model the host already has, shown and edited by every GLSP session it is bound for: the
 * host's store and the dispatcher over it (`createActionDispatcher`), which the host's other
 * clients (a React Flow canvas, a `connectDispatcher` port) use too. The dispatcher's `save`
 * option is where saves go.
 */
export interface IstarSharedModel {
  readonly store: ModelStore<string, string>;
  readonly dispatcher: StoreActionDispatcher<string, string>;
}

/**
 * A host's model as a launcher's `shared` option takes it (`serveIstarGlsp({ shared })`,
 * `bindIstarSharedModel`): an `IstarSharedModel` over any `ActionDispatcher`. One without
 * `isDirty` (a `createRemoteDispatcher` over a port) is adapted with `withDirtyState`, its dirty
 * state tracked from the `setDirtyState` notifications it relays (#249).
 */
export interface IstarSharedModelSource {
  readonly store: ModelStore<string, string>;
  readonly dispatcher: ActionDispatcher<string, string>;
}

/**
 * Service identifier of the host's `IstarSharedModel`. Bound (`bindIstarSharedModel`), sessions
 * share its store and dispatcher, `requestModel` shows its model without reading a file, and the
 * session never disposes it.
 */
export const IstarSharedModel: unique symbol = Symbol('IstarSharedModel');

/** A copy of the store's model that a grouped edit applies its operations to first (#223). */
interface Draft {
  readonly store: ModelStore<string, string>;
  readonly dispatcher: StoreActionDispatcher<string, string>;
  /** The accepted operations, with the ids they created pinned (`injectCreatedIds`). */
  readonly operations: IstarOperation<string, string>[];
}

@injectable()
export class IstarModelState extends DefaultModelState {
  readonly contribution: IstarGlspContribution;
  /**
   * The session's model. Every edit goes through it, as one undo step per operation, or per MCP
   * tool call (`beginDraft`).
   */
  readonly store: ModelStore<string, string>;
  /**
   * The istar-ts dispatcher over `store`: operations, requests, undo, redo and saving. Its
   * `isDirty` is the session's dirty state; GLSP's `saveModel` saves through it too.
   */
  readonly dispatcher: StoreActionDispatcher<string, string>;
  /** True when the store and dispatcher are the host's (`IstarSharedModel`), not the session's. */
  readonly isShared: boolean;
  protected readonly files: PistarFiles | undefined;
  private own = 0;
  private saves = 0;
  /** Whether edits go to a draft (`beginDraft`); the draft itself is made on the first edit. */
  private drafting = false;
  private draft: Draft | undefined;

  constructor(
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
    @inject(PistarFiles) @optional() files?: PistarFiles,
    @inject(IstarSharedModel) @optional() shared?: IstarSharedModel,
  ) {
    super();
    this.contribution = contribution;
    this.files = files;
    this.isShared = shared !== undefined;
    if (shared) {
      this.store = shared.store;
      this.dispatcher = shared.dispatcher;
      return;
    }
    this.store = createModelStore(undefined, { metamodel: contribution.metamodel });
    this.dispatcher = createActionDispatcher(this.store, {
      palette: paletteOf(contribution),
      ...(contribution.schemas ? { schemas: contribution.schemas } : {}),
      save: (file, action) => this.write(file, action),
    });
  }

  /** The session ended: stops the session's own dispatcher. A shared one is the host's to stop. */
  dispose(): void {
    if (!this.isShared) this.dispatcher.dispose();
  }

  /** The current model: the open draft's, if any, else the store's. */
  get model(): AnyIstarModel {
    return (this.draft?.store ?? this.store).getModel();
  }

  /**
   * Applies `operation`: to the open draft, or else through the session's dispatcher. Every
   * edit this session makes goes through here, so a grouped MCP tool call (`beginDraft`)
   * collects all of them, whichever tool handler or GLSP operation handler made it.
   */
  async edit(operation: IstarOperation<string, string>): Promise<ActionResult> {
    if (!this.drafting) return this.dispatcher.dispatch(operation);
    this.draft ??= this.openDraft();
    const { store, dispatcher, operations } = this.draft;
    const before = store.getModel();
    const result = await dispatcher.dispatch(operation);
    if (result.ok) operations.push(injectCreatedIds(operation, result.createdIds, before));
    return result;
  }

  /**
   * The dispatcher a host tool (#175) is handed: operations through `edit`, requests answered
   * on `model` (the draft's while one is open), anything else (undo, redo, save) by the
   * session's dispatcher.
   */
  readonly editor: ActionDispatcher<string, string> = {
    dispatch: ((action, options) => {
      if (isOperation(action)) return this.edit(action);
      if (isRequestAction(action) && this.draft) return this.draft.dispatcher.dispatch(action);
      return this.dispatcher.dispatch(action, options);
    }) as ActionDispatcher<string, string>['dispatch'],
    subscribe: (listener) => this.dispatcher.subscribe(listener),
  };

  /**
   * Starts collecting this session's edits (`edit`) in a draft, a copy of the store's model
   * made on the first edit, instead of applying them to the store: `endDraft` returns them.
   * The draft's dispatcher has the contribution's property schemas but none of a shared
   * dispatcher's guards: those run when the caller dispatches the collected operations.
   */
  beginDraft(): void {
    this.drafting = true;
  }

  /**
   * Stops drafting and drops the draft. Returns the operations it accepted (none when no edit
   * was made), in order, with the ids they created pinned, and whether the draft was made at
   * all (the GModel may then show it, and needs building again from the store's model).
   */
  endDraft(): {
    readonly operations: readonly IstarOperation<string, string>[];
    readonly drafted: boolean;
  } {
    const draft = this.draft;
    this.drafting = false;
    this.draft = undefined;
    draft?.dispatcher.dispose();
    return { operations: draft?.operations ?? [], drafted: draft !== undefined };
  }

  protected openDraft(): Draft {
    const store = createModelStore(this.store.getModel());
    const dispatcher = createActionDispatcher(store, {
      palette: paletteOf(this.contribution),
      ...(this.contribution.schemas ? { schemas: this.contribution.schemas } : {}),
    });
    return { store, dispatcher, operations: [] };
  }

  /**
   * Runs `fn` as this session's own change: the store changes it makes are pushed to the client
   * by the action handler that called it, not as another client's (`isOwnChange`). The
   * dispatcher applies an operation, undo or redo before its first `await`, so the synchronous
   * part of `dispatch` is the whole change. The flag is per session: on a shared store, the
   * other sessions hear the same change as another client's and push it to their clients.
   */
  ownChange<T>(fn: () => T): T {
    this.own++;
    try {
      return fn();
    } finally {
      this.own--;
    }
  }

  /** True while `ownChange` runs. */
  get isOwnChange(): boolean {
    return this.own > 0;
  }

  /**
   * Runs a save GLSP's `saveModel` asked for: GLSP's own handler then tells the client the model
   * is clean, so the dispatcher's `setDirtyState` meanwhile is not pushed again
   * (`isSavingFromGlsp`).
   */
  async savingFromGlsp<T>(fn: () => Promise<T>): Promise<T> {
    this.saves++;
    try {
      return await fn();
    } finally {
      this.saves--;
    }
  }

  /** True while `savingFromGlsp` runs. */
  get isSavingFromGlsp(): boolean {
    return this.saves > 0;
  }

  /**
   * Writes the file for the dispatcher's `saveModel`, whoever sent it: to its `fileUri`, or back
   * to the session's `sourceUri`. The text is `toPistar`'s.
   */
  protected async write(file: PistarFile, action: SaveModelAction): Promise<void> {
    const uri = action.fileUri ?? this.sourceUri;
    if (uri === undefined) throw new GLSPServerError('saveModel needs a file URI');
    if (!this.files) throw new GLSPServerError('the host binds no PistarFiles to save to');
    await this.files.write(uri, JSON.stringify(file, null, 2));
  }
}
