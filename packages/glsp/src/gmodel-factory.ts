import { ModelState } from '@eclipse-glsp/server';
import type { GModelFactory } from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution } from './contribution';
import { modelToGModel } from './gmodel';
import type { IstarModelState } from './model-state';

/** Derives the GModel from the model state's store with `modelToGModel`, after every change. */
@injectable()
export class IstarGModelFactory implements GModelFactory {
  protected readonly modelState: IstarModelState;
  protected readonly contribution: IstarGlspContribution;

  constructor(
    @inject(ModelState) modelState: IstarModelState,
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
  ) {
    this.modelState = modelState;
    this.contribution = contribution;
  }

  createModel(): void {
    const options = {
      ...(this.contribution.types ? { types: this.contribution.types } : {}),
      ...(this.contribution.sizes ? { sizes: this.contribution.sizes } : {}),
    };
    this.modelState.updateRoot(modelToGModel(this.modelState.model, options));
  }
}
