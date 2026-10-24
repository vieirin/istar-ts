/**
 * The session's model state: GLSP's `DefaultModelState` (the GModel root, its index, the client
 * options) plus the istar-ts model it shows, held in one `ModelStore` with its action dispatcher.
 *
 * By default the store is created once per session and never replaced: loading a file `load`s it
 * (and clears its history), so whatever wraps the store (the dispatcher here; `IstarCommandStack`,
 * which maps GLSP's undo and redo onto the dispatcher's `glspUndo`/`glspRedo`, framework-notes §7
 * "The undo conflict") keeps working across loads. When the host binds an `IstarSharedModel`, the
 * session uses that store and dispatcher instead, shared with every other session and with the
 * host's own clients (a React Flow canvas). The GModel is derived from `store.getModel()` by the
 * GModel factory and is never edited directly.
 */
import type { AnyIstarModel, ModelStore, PistarFile } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import type { SaveModelAction, StoreActionDispatcher } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
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
 * Service identifier of the host's `IstarSharedModel`. Bound (`bindIstarSharedModel`), sessions
 * share its store and dispatcher, `requestModel` shows its model without reading a file, and the
 * session never disposes it.
 */
export const IstarSharedModel: unique symbol = Symbol('IstarSharedModel');

@injectable()
export class IstarModelState extends DefaultModelState {
  readonly contribution: IstarGlspContribution;
  /** The session's model. Every edit goes through it, as one undo step per operation. */
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

  /** The current model. */
  get model(): AnyIstarModel {
    return this.store.getModel();
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
