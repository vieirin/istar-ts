/**
 * The session's model state: GLSP's `DefaultModelState` (the GModel root, its index, the client
 * options) plus the istar-ts model it shows, held in one `ModelStore` with its action dispatcher.
 *
 * The store is created once per session and never replaced: loading a file `load`s it (and clears
 * its history), so whatever wraps the store (the dispatcher here; the `CommandStack` that maps
 * GLSP's undo and redo onto `store.undo()`/`store.redo()`, framework-notes §7 "The undo
 * conflict") keeps working across loads. The GModel is derived from `store.getModel()` by the
 * GModel factory and is never edited directly.
 */
import type { AnyIstarModel, ModelStore } from '@istar-ts/core';
import { createModelStore } from '@istar-ts/core';
import type { StoreActionDispatcher } from '@istar-ts/actions';
import { createActionDispatcher } from '@istar-ts/actions';
import { DefaultModelState } from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution, paletteOf } from './contribution';

@injectable()
export class IstarModelState extends DefaultModelState {
  readonly contribution: IstarGlspContribution;
  /** The session's model. Every edit goes through it, as one undo step per operation. */
  readonly store: ModelStore<string, string>;
  /** The istar-ts dispatcher over `store`: operations, requests, undo and redo. */
  readonly dispatcher: StoreActionDispatcher<string, string>;

  constructor(@inject(IstarGlspContribution) contribution: IstarGlspContribution) {
    super();
    this.contribution = contribution;
    this.store = createModelStore(undefined, { metamodel: contribution.metamodel });
    this.dispatcher = createActionDispatcher(this.store, {
      palette: paletteOf(contribution),
      ...(contribution.schemas ? { schemas: contribution.schemas } : {}),
    });
  }

  /** The current model. */
  get model(): AnyIstarModel {
    return this.store.getModel();
  }
}
