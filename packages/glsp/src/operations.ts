/**
 * The write side: GLSP's operation handlers and command stack over the istar-ts dispatcher.
 *
 * Every operation a GLSP client sends is translated (`translateOperation`) and dispatched to the
 * session's dispatcher, so guards, rejections, transactions and the undo stack are the same as
 * for the React Flow canvas. The dispatcher applies the operation when the handler runs; the
 * `Command` GLSP gets back is only a marker of an applied change, and `IstarCommandStack` keeps
 * no list of commands: its undo and redo are the dispatcher's `glspUndo`/`glspRedo`, its dirty
 * state is the dispatcher's (framework-notes §7, "The undo conflict"). There is one history, the
 * store's, whichever client made or undoes an edit.
 *
 * GLSP has no failure answer to an operation (framework-notes §1). A rejection is reported as a
 * `MessageAction` (and markers on the elements it names, reason `ISTAR_REJECTION_REASON`), and
 * the unchanged model is pushed again so the client drops its local feedback (a dragged node
 * snaps back).
 */
import type { GoalDiagnostic } from '@istar-ts/core';
import { diagnosticToMarker } from '@istar-ts/actions';
import {
  ActionDispatcher,
  ApplyLabelEditOperation,
  ChangeBoundsOperation,
  ChangeContainerOperation,
  ChangeRoutingPointsOperation,
  CompoundOperation,
  CreateEdgeOperation,
  CreateNodeOperation,
  DeleteElementOperation,
  MessageAction,
  ModelState,
  OperationHandler,
  ReconnectEdgeOperation,
  SetMarkersAction,
  TriggerEdgeCreationAction,
  TriggerNodeCreationAction,
} from '@eclipse-glsp/server';
import type {
  Command,
  CommandStack,
  CreateEdgeOperationHandler,
  CreateNodeOperationHandler,
  Marker,
  MaybePromise,
  Operation,
} from '@eclipse-glsp/server';
import { inject, injectable, optional } from 'inversify';
import type { IstarGlspContribution } from './contribution';
import type { IstarModelState } from './model-state';
import { translateOperation } from './translate';
import { gmodelTypes } from './types';

/** `SetMarkersAction.reason` of the markers a rejected operation leaves on its elements. */
export const ISTAR_REJECTION_REASON = 'istar.rejection';

/** A GoalDiagnostic as GLSP's marker: `diagnosticToMarker`, with `hint` read as `info`. */
export function glspMarker(diagnostic: GoalDiagnostic): Marker {
  const { label, description, elementId, kind } = diagnosticToMarker(diagnostic);
  return { label, description, elementId, kind: kind === 'hint' ? 'info' : kind };
}

/**
 * The command of an operation the dispatcher has applied (or rejected, leaving the model as it
 * was): nothing left to execute. Undo and redo are the store's, through `IstarCommandStack`,
 * which never calls these.
 */
export class AppliedCommand implements Command {
  execute(): void {}
  undo(): void {}
  redo(): void {}
}

/**
 * GLSP's command stack, delegating to the session's dispatcher: no second history. `undo`/`redo`
 * dispatch `glspUndo`/`glspRedo`, `canUndo`/`canRedo` ask the store, `isDirty` is the
 * dispatcher's. Saving marks the model clean in the dispatcher already (`IstarSourceModelStorage`
 * saves through it), so `saveIsDone` has nothing to do; `flush` neither, as loading a file clears
 * the store's history.
 */
@injectable()
export class IstarCommandStack implements CommandStack {
  protected readonly state: IstarModelState;

  constructor(@inject(ModelState) state: IstarModelState) {
    this.state = state;
  }

  async execute(command: Command): Promise<void> {
    // `AppliedCommand`s are no-ops. Another handler's command editing the store is still this
    // session's own change, pushed by the handler.
    await this.state.ownChange(() => command.execute());
  }

  async undo(): Promise<void> {
    await this.state.ownChange(() => this.state.dispatcher.dispatch({ kind: 'glspUndo' }));
  }

  canUndo(): boolean {
    return this.state.store.canUndo();
  }

  async redo(): Promise<void> {
    await this.state.ownChange(() => this.state.dispatcher.dispatch({ kind: 'glspRedo' }));
  }

  canRedo(): boolean {
    return this.state.store.canRedo();
  }

  get isDirty(): boolean {
    return this.state.dispatcher.isDirty();
  }

  saveIsDone(): void {}

  flush(): void {}
}

/**
 * Runs GLSP operations on the session's dispatcher and reports what came of them: the session
 * service behind every `IstarOperationHandler`.
 */
@injectable()
export class IstarOperationRunner {
  readonly state: IstarModelState;
  protected readonly actions: ActionDispatcher;
  /** Whether the client shows markers of a rejection, to clear on the next accepted edit. */
  private rejectionMarkers = false;
  private readonly rejectionListeners = new Set<(diagnostics: readonly GoalDiagnostic[]) => void>();

  constructor(
    @inject(ModelState) state: IstarModelState,
    @inject(ActionDispatcher) actions: ActionDispatcher,
  ) {
    this.state = state;
    this.actions = actions;
  }

  get contribution(): IstarGlspContribution {
    return this.state.contribution;
  }

  /**
   * Calls `listener` with the diagnostics of every operation this session rejects, until the
   * returned function is called: how an MCP tool call learns that its operations were refused
   * (GLSP's dispatch has no failure answer).
   */
  onRejected(listener: (diagnostics: readonly GoalDiagnostic[]) => void): () => void {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  /**
   * Translates and dispatches `operation`. Returns a command when the client needs the model
   * again: after a change, or after a rejection (to undo the client's local feedback).
   */
  async run(operation: Operation): Promise<Command | undefined> {
    const { state } = this;
    const translation = translateOperation(operation, state.model, state.contribution);
    if (!translation.ok) return this.rejected(translation.diagnostics);
    if (!translation.operation) return undefined;
    const before = state.model;
    const istarOperation = translation.operation;
    const result = await state.ownChange(() => state.dispatcher.dispatch(istarOperation));
    if (!result.ok) return this.rejected(result.diagnostics);
    if (this.rejectionMarkers) {
      this.rejectionMarkers = false;
      this.actions.dispatchAfterNextUpdate(
        SetMarkersAction.create([], { reason: ISTAR_REJECTION_REASON }),
      );
    }
    if (result.diagnostics && result.diagnostics.length > 0) {
      this.actions.dispatchAfterNextUpdate(message(result.diagnostics, 'WARNING'));
    }
    return state.model === before ? undefined : new AppliedCommand();
  }

  protected rejected(diagnostics: readonly GoalDiagnostic[]): Command {
    for (const listener of this.rejectionListeners) listener(diagnostics);
    const model = this.state.model;
    const markers = diagnostics
      .filter((d) => model.elements.has(d.elementId) || model.links.has(d.elementId))
      .map(glspMarker);
    this.actions.dispatchAfterNextUpdate(message(diagnostics, 'ERROR'));
    if (markers.length > 0 || this.rejectionMarkers) {
      this.rejectionMarkers = markers.length > 0;
      this.actions.dispatchAfterNextUpdate(
        SetMarkersAction.create(markers, { reason: ISTAR_REJECTION_REASON }),
      );
    }
    // The model is untouched; the command only makes GLSP push it, as it pushes after a change.
    return new AppliedCommand();
  }
}

function message(diagnostics: readonly GoalDiagnostic[], severity: 'ERROR' | 'WARNING') {
  const text = diagnostics.map((d) => d.message).join('; ');
  return MessageAction.create(severity === 'ERROR' ? `Rejected: ${text}` : text, {
    severity,
    details: diagnostics.map((d) => diagnosticToMarker(d).description).join('\n'),
  });
}

/**
 * An operation handler that hands its operation to the session's `IstarOperationRunner`. GLSP
 * constructs every handler class once without arguments, only to read its `operationType`
 * (`DiagramModule.bindOperations`), hence the optional runner.
 */
@injectable()
export abstract class IstarOperationHandler extends OperationHandler {
  protected readonly runner: IstarOperationRunner | undefined;

  constructor(@inject(IstarOperationRunner) @optional() runner?: IstarOperationRunner) {
    super();
    this.runner = runner;
  }

  createCommand(operation: Operation): MaybePromise<Command | undefined> {
    return this.runner?.run(operation);
  }
}

/** The GModel types of the contribution's element kinds a client can create (hubs come with links). */
function nodeTypes(contribution: IstarGlspContribution | undefined): string[] {
  if (!contribution) return [];
  const { metamodel } = contribution;
  const types = gmodelTypes(metamodel, contribution.types);
  return [...metamodel.elements.values()]
    .filter((d) => d.role !== 'hub')
    .map((d) => types.of(d.kind)!);
}

function edgeTypes(contribution: IstarGlspContribution | undefined): string[] {
  if (!contribution) return [];
  const types = gmodelTypes(contribution.metamodel, contribution.types);
  return [...contribution.metamodel.links.keys()].map((kind) => types.of(kind)!);
}

/** `createNode`, for every node type of the contribution (GLSP registers create handlers by type). */
@injectable()
export class IstarCreateNodeOperationHandler
  extends IstarOperationHandler
  implements CreateNodeOperationHandler
{
  readonly operationType: typeof CreateNodeOperation.KIND = CreateNodeOperation.KIND;
  override readonly label: string = 'Create node';
  elementTypeIds: string[] = nodeTypes(this.runner?.contribution);

  getTriggerActions(): TriggerNodeCreationAction[] {
    return this.elementTypeIds.map((type) => TriggerNodeCreationAction.create(type));
  }
}

/** `createEdge`, for every edge type of the contribution: plain, dependency and n-ary links. */
@injectable()
export class IstarCreateEdgeOperationHandler
  extends IstarOperationHandler
  implements CreateEdgeOperationHandler
{
  readonly operationType: typeof CreateEdgeOperation.KIND = CreateEdgeOperation.KIND;
  override readonly label: string = 'Create edge';
  elementTypeIds: string[] = edgeTypes(this.runner?.contribution);

  getTriggerActions(): TriggerEdgeCreationAction[] {
    return this.elementTypeIds.map((type) => TriggerEdgeCreationAction.create(type));
  }
}

@injectable()
export class IstarDeleteElementOperationHandler extends IstarOperationHandler {
  readonly operationType: string = DeleteElementOperation.KIND;
}

@injectable()
export class IstarChangeBoundsOperationHandler extends IstarOperationHandler {
  readonly operationType: string = ChangeBoundsOperation.KIND;
}

@injectable()
export class IstarChangeContainerOperationHandler extends IstarOperationHandler {
  readonly operationType: string = ChangeContainerOperation.KIND;
}

@injectable()
export class IstarReconnectEdgeOperationHandler extends IstarOperationHandler {
  readonly operationType: string = ReconnectEdgeOperation.KIND;
}

@injectable()
export class IstarChangeRoutingPointsOperationHandler extends IstarOperationHandler {
  readonly operationType: string = ChangeRoutingPointsOperation.KIND;
}

@injectable()
export class IstarApplyLabelEditOperationHandler extends IstarOperationHandler {
  readonly operationType: string = ApplyLabelEditOperation.KIND;
}

/**
 * `compound` as one istar-ts `compound` operation: one transaction and one undo step, none of it
 * applied if a part is rejected. (GLSP's own `CompoundOperationHandler` runs each part's handler,
 * which here would be one dispatch, and one undo step, per part.)
 */
@injectable()
export class IstarCompoundOperationHandler extends IstarOperationHandler {
  readonly operationType: string = CompoundOperation.KIND;
}

/** Every operation handler of the write side, in the order `IstarDiagramModule` binds them. */
export const ISTAR_OPERATION_HANDLERS: readonly (new () => IstarOperationHandler)[] = [
  IstarCreateNodeOperationHandler,
  IstarCreateEdgeOperationHandler,
  IstarDeleteElementOperationHandler,
  IstarChangeBoundsOperationHandler,
  IstarChangeContainerOperationHandler,
  IstarReconnectEdgeOperationHandler,
  IstarChangeRoutingPointsOperationHandler,
  IstarApplyLabelEditOperationHandler,
  IstarCompoundOperationHandler,
];
