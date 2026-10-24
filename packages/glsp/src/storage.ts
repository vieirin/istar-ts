/**
 * Loading and saving piStar files, through the `PistarFiles` the host binds.
 */
import { parsePistar } from '@istar-ts/core';
import { GLSPServerError, ModelState, SOURCE_URI_ARG } from '@eclipse-glsp/server';
import type { RequestModelAction, SaveModelAction, SourceModelStorage } from '@eclipse-glsp/server';
import { inject, injectable, optional } from 'inversify';
import { IstarGlspContribution } from './contribution';
import { PistarFiles } from './files';
import type { IstarModelState } from './model-state';

/**
 * Loads the file named by `requestModel`'s `sourceUri` option with `parsePistar`, in the
 * contribution's metamodel (extended by the file's own `"metamodel"` block unless the
 * contribution turns `fileMetamodel` off), into the model state's store. On a shared model
 * (`IstarSharedModel`) it loads nothing: the host owns the model, and every session shows it.
 *
 * Saves through the dispatcher's `saveModel`, so a save from GLSP and one from any other client
 * of the dispatcher mark the same model clean (the dispatcher's `isDirty`, which
 * `IstarCommandStack` reports to GLSP). The model state writes the file (`toPistar`, stamping
 * `saveDate` as piStar does) to `saveModel`'s `fileUri`, or back to the `sourceUri`.
 */
@injectable()
export class IstarSourceModelStorage implements SourceModelStorage {
  protected readonly modelState: IstarModelState;
  protected readonly files: PistarFiles | undefined;
  protected readonly contribution: IstarGlspContribution;

  constructor(
    @inject(ModelState) modelState: IstarModelState,
    @inject(PistarFiles) @optional() files: PistarFiles | undefined,
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
  ) {
    this.modelState = modelState;
    this.files = files;
    this.contribution = contribution;
  }

  async loadSourceModel(action: RequestModelAction): Promise<void> {
    if (this.modelState.isShared) return;
    const uri = action.options?.[SOURCE_URI_ARG];
    if (typeof uri !== 'string') {
      throw new GLSPServerError(`requestModel needs a "${SOURCE_URI_ARG}" option`);
    }
    if (!this.files) throw new GLSPServerError('the host binds no PistarFiles to load from');
    const text = await this.files.read(uri);
    const model = parsePistar(text, {
      metamodel: this.contribution.metamodel,
      fileMetamodel: this.contribution.fileMetamodel ?? true,
    });
    // The request's own `setModel` shows it; it is no other client's change.
    this.modelState.ownChange(() => this.modelState.store.load(model));
  }

  async saveSourceModel(action: SaveModelAction): Promise<void> {
    const result = await this.modelState.savingFromGlsp(() =>
      this.modelState.dispatcher.dispatch({
        kind: 'saveModel',
        ...(action.fileUri === undefined ? {} : { fileUri: action.fileUri }),
      }),
    );
    if (!result.ok) {
      throw new GLSPServerError(result.diagnostics.map((d) => d.message).join('; '));
    }
  }
}
