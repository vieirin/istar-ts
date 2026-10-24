import { DiagramModule, RequestCheckEdgeActionHandler } from '@eclipse-glsp/server';
import type {
  ActionHandlerConstructor,
  BindingTarget,
  ClientActionForwarder,
  ClientSessionInitializer,
  CommandStack,
  DiagramConfiguration,
  GModelFactory,
  InstanceMultiBinding,
  LabelEditValidator,
  ModelState,
  ModelValidator,
  MultiBinding,
  OperationHandlerConstructor,
  ServerModule,
  SourceModelStorage,
  ToolPaletteItemProvider,
} from '@eclipse-glsp/server';
import type { ContainerModule, interfaces } from 'inversify';
import type { IstarGlspContribution } from './contribution';
import { IstarContributionModule } from './contribution';
import { IstarDiagramConfiguration } from './diagram-configuration';
import { IstarGModelFactory } from './gmodel-factory';
import { IstarModelState } from './model-state';
import { ISTAR_OPERATION_HANDLERS, IstarCommandStack, IstarOperationRunner } from './operations';
import { IstarSourceModelStorage } from './storage';
import {
  IstarLabelEditValidator,
  IstarModelValidator,
  IstarRequestCheckEdgeActionHandler,
  IstarToolPaletteItemProvider,
} from './tools';
import {
  IstarClientActionForwarder,
  IstarStoreChangedHandler,
  IstarStoreListener,
} from './updates';

/**
 * The core tier's manifest (see `contribution.ts`): GLSP's `DiagramModule` with the istar-ts
 * model state, storage, GModel factory and diagram configuration, all reading the session's
 * `IstarGlspContribution`. It binds no contribution itself; install it with the dialect's
 * `IstarContributionModule`, as `configureIstarDiagram` does. The host binds `PistarFiles`.
 *
 * The write side replaces GLSP's defaults where they would keep state of their own: the operation
 * handlers dispatch to the istar-ts dispatcher (`operations.ts`), the command stack is the
 * store's history, the palette comes from the contribution's `PaletteDescription`, edge checks
 * and markers from the dispatcher (`tools.ts`), and changes by the store's other clients are
 * pushed as `updateModel` (`updates.ts`).
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

  protected override configure(
    bind: interfaces.Bind,
    unbind: interfaces.Unbind,
    isBound: interfaces.IsBound,
    rebind: interfaces.Rebind,
  ): void {
    super.configure(bind, unbind, isBound, rebind);
    bind(IstarOperationRunner).toSelf().inSingletonScope();
  }

  override configureClientSessionInitializers(
    binding: MultiBinding<ClientSessionInitializer>,
  ): void {
    super.configureClientSessionInitializers(binding);
    // A session singleton (bound by the target), which `IstarStoreChangedHandler` asks too.
    binding.add({ service: IstarStoreListener });
  }

  protected override configureActionHandlers(
    binding: InstanceMultiBinding<ActionHandlerConstructor>,
  ): void {
    super.configureActionHandlers(binding);
    binding.rebind(RequestCheckEdgeActionHandler, IstarRequestCheckEdgeActionHandler);
    binding.add(IstarStoreChangedHandler);
  }

  /** The istar-ts operations, in place of GLSP's compound and layout handlers. */
  protected override configureOperationHandlers(
    binding: InstanceMultiBinding<OperationHandlerConstructor>,
  ): void {
    binding.addAll(...ISTAR_OPERATION_HANDLERS);
  }

  protected override bindCommandStack(): BindingTarget<CommandStack> {
    return IstarCommandStack;
  }

  protected override bindClientActionForwarder(): BindingTarget<ClientActionForwarder> {
    return IstarClientActionForwarder;
  }

  protected override bindToolPaletteItemProvider(): BindingTarget<ToolPaletteItemProvider> {
    return IstarToolPaletteItemProvider;
  }

  protected override bindModelValidator(): BindingTarget<ModelValidator> {
    return IstarModelValidator;
  }

  protected override bindLabelEditValidator(): BindingTarget<LabelEditValidator> {
    return IstarLabelEditValidator;
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
