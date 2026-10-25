import { GModelSerializer, ModelState } from '@eclipse-glsp/server';
import type { GModelFactory } from '@eclipse-glsp/server';
import { modelToGModelSchema } from '@istar-ts/gmodel';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution } from './contribution';
import { gmodelOptions } from './gmodel';
import type { IstarModelState } from './model-state';

/**
 * Derives the GModel from the model state's store after every change: `@istar-ts/gmodel`'s
 * schema (`modelToGModelSchema`), turned into the root by the session's `GModelSerializer`.
 */
@injectable()
export class IstarGModelFactory implements GModelFactory {
  protected readonly modelState: IstarModelState;
  protected readonly contribution: IstarGlspContribution;
  protected readonly serializer: GModelSerializer;

  constructor(
    @inject(ModelState) modelState: IstarModelState,
    @inject(IstarGlspContribution) contribution: IstarGlspContribution,
    @inject(GModelSerializer) serializer: GModelSerializer,
  ) {
    this.modelState = modelState;
    this.contribution = contribution;
    this.serializer = serializer;
  }

  createModel(): void {
    const schema = modelToGModelSchema(this.modelState.model, gmodelOptions(this.contribution));
    this.modelState.updateRoot(this.serializer.createRoot(schema));
  }
}
