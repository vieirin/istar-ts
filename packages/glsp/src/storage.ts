/**
 * Loading and saving piStar files. Where the text comes from is the host's business (a Node
 * host reads the disk, a worker asks its page), so the storage reads and writes through a
 * `PistarFiles` the host binds.
 */
import { parsePistar, toPistar } from '@istar-ts/core';
import { GLSPServerError, ModelState, SOURCE_URI_ARG } from '@eclipse-glsp/server';
import type {
  MaybePromise,
  RequestModelAction,
  SaveModelAction,
  SourceModelStorage,
} from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution } from './contribution';
import type { IstarModelState } from './model-state';

/** Reads and writes the text of piStar files, by the URI the client sends as `sourceUri`. */
export interface PistarFiles {
  read(uri: string): MaybePromise<string>;
  write(uri: string, text: string): MaybePromise<void>;
}

/** Service identifier of the host's `PistarFiles`. */
export const PistarFiles: unique symbol = Symbol('PistarFiles');

/** `PistarFiles` over a map of URI → text (tests, a worker given its files up front). */
export function memoryPistarFiles(files: Map<string, string> = new Map()): PistarFiles {
  return {
    read(uri) {
      const text = files.get(uri);
      if (text === undefined) throw new Error(`no file "${uri}"`);
      return text;
    },
    write(uri, text) {
      files.set(uri, text);
    },
  };
}

/**
 * Loads the file named by `requestModel`'s `sourceUri` option with `parsePistar`, in the
 * contribution's metamodel (extended by the file's own `"metamodel"` block unless the
 * contribution turns `fileMetamodel` off), into the model state's store. Saves with `toPistar`
 * to `saveModel`'s `fileUri`, or back to the `sourceUri`, stamping `saveDate` as piStar does.
 */
@injectable()
export class IstarSourceModelStorage implements SourceModelStorage {
  protected readonly modelState: IstarModelState;
  protected readonly files: PistarFiles;
  protected readonly contribution: IstarGlspContribution;

  constructor(
    @inject(ModelState) modelState: IstarModelState,
    @inject(PistarFiles) files: PistarFiles,
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
  ) {
    this.modelState = modelState;
    this.files = files;
    this.contribution = contribution;
  }

  async loadSourceModel(action: RequestModelAction): Promise<void> {
    const uri = action.options?.[SOURCE_URI_ARG];
    if (typeof uri !== 'string') {
      throw new GLSPServerError(`requestModel needs a "${SOURCE_URI_ARG}" option`);
    }
    const text = await this.files.read(uri);
    const model = parsePistar(text, {
      metamodel: this.contribution.metamodel,
      fileMetamodel: this.contribution.fileMetamodel ?? true,
    });
    this.modelState.store.load(model);
  }

  async saveSourceModel(action: SaveModelAction): Promise<void> {
    const uri = action.fileUri ?? this.modelState.sourceUri;
    if (uri === undefined) throw new GLSPServerError('saveModel needs a file URI');
    await this.files.write(uri, toPistar(this.modelState.model, { saveDate: new Date() }));
  }
}
