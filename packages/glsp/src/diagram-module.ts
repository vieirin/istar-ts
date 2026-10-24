import { DiagramModule } from '@eclipse-glsp/server';
import type {
  BindingTarget,
  DiagramConfiguration,
  GModelFactory,
  ModelState,
  ServerModule,
  SourceModelStorage,
} from '@eclipse-glsp/server';
import type { ContainerModule } from 'inversify';
import type { IstarGlspContribution } from './contribution';
import { IstarContributionModule } from './contribution';
import { IstarDiagramConfiguration } from './diagram-configuration';
import { IstarGModelFactory } from './gmodel-factory';
import { IstarModelState } from './model-state';
import { IstarSourceModelStorage } from './storage';

/**
 * The core tier's manifest (see `contribution.ts`): GLSP's `DiagramModule` with the istar-ts
 * model state, storage, GModel factory and diagram configuration, all reading the session's
 * `IstarGlspContribution`. It binds no contribution itself; install it with the dialect's
 * `IstarContributionModule`, as `configureIstarDiagram` does. The host binds `PistarFiles`.
 */
export class IstarDiagramModule extends DiagramModule {
  readonly diagramType: string;

  constructor(diagramType: string) {
    super();
    this.diagramType = diagramType;
  }

  protected bindModelState(): BindingTarget<ModelState> {
    return { service: IstarModelState };
  }

  protected bindSourceModelStorage(): BindingTarget<SourceModelStorage> {
    return IstarSourceModelStorage;
  }

  protected bindGModelFactory(): BindingTarget<GModelFactory> {
    return IstarGModelFactory;
  }

  protected bindDiagramConfiguration(): BindingTarget<DiagramConfiguration> {
    return IstarDiagramConfiguration;
  }
}

/**
 * Registers a dialect's diagram on a GLSP `ServerModule`: the core tier's `IstarDiagramModule`
 * under the contribution's diagram type, its manifest (`IstarContributionModule`) and any
 * further modules, in one session container (manifests installing manifests, Metin & Bork 2025
 * §4.1.2).
 */
export function configureIstarDiagram(
  serverModule: ServerModule,
  contribution: IstarGlspContribution,
  ...modules: ContainerModule[]
): ServerModule {
  return serverModule.configureDiagramModule(
    new IstarDiagramModule(contribution.diagramType),
    new IstarContributionModule(contribution),
    ...modules,
  );
}
