/**
 * The protocol lab's pseudo-agent change set (#47, #42 item 7): a scripted plan, no LLM, of
 * five actions towards a stated goal. `dryRun` sends them one at a time to a scratch
 * dispatcher over a copy of the model (`parsePistar(toPistar(model))`), with the same guards
 * the live dispatcher would use, so the live store is never touched; the lab applies the
 * (possibly user-edited) set as one `compound` to the live dispatcher instead.
 *
 * The plan's steps carry explicit `args.id`s (`createNode`'s seat for a caller-chosen id) so a
 * later step can address an earlier one's `containerId`/`sourceElementId` without knowing what
 * id a store would otherwise generate — the same ids work whether the step runs in the dry
 * run's scratch store or, once applied, in the live one.
 */
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionGuard, ActionResult, IstarOperation } from '@istar-ts/actions';
import { createModelStore, metamodelOf, parsePistar, toPistar } from '@istar-ts/core';
import type { AnyIstarModel, IstarModel, ModelStore } from '@istar-ts/core';

export interface AgentStep {
  readonly label: string;
  readonly operation: IstarOperation;
}

export interface AgentPlan {
  readonly goal: string;
  readonly steps: readonly AgentStep[];
}

const ACTOR_ID = 'agent-plan-actor';
const GOAL_1_ID = 'agent-plan-goal-1';
const TASK_1_ID = 'agent-plan-task-1';
const GOAL_2_ID = 'agent-plan-goal-2';

/** The scripted five-step plan the pseudo-agent proposes, whatever model it runs against. */
export function planFor(): AgentPlan {
  return {
    goal: 'Give the model an actor with an audit trail: review requests, log activity, flag anomalies.',
    steps: [
      {
        label: 'Create an actor to hold the audit trail',
        operation: {
          kind: 'createNode',
          elementTypeId: 'istar.Actor',
          args: { id: ACTOR_ID, name: 'Auditor' },
          location: { x: 40, y: 40 },
        },
      },
      {
        label: 'Add a goal: review incoming requests',
        operation: {
          kind: 'createNode',
          elementTypeId: 'istar.Goal',
          containerId: ACTOR_ID,
          args: { id: GOAL_1_ID, name: 'Review requests' },
          location: { x: 20, y: 90 },
        },
      },
      {
        label: 'Add a task: log activity',
        operation: {
          kind: 'createNode',
          elementTypeId: 'istar.Task',
          containerId: ACTOR_ID,
          args: { id: TASK_1_ID, name: 'Log activity' },
          location: { x: 20, y: 150 },
        },
      },
      {
        label: 'Add a goal: flag anomalies',
        operation: {
          kind: 'createNode',
          elementTypeId: 'istar.Goal',
          containerId: ACTOR_ID,
          args: { id: GOAL_2_ID, name: 'Flag anomalies' },
          location: { x: 20, y: 210 },
        },
      },
      {
        label: 'Refine "review requests" with "log activity" (AND)',
        operation: {
          kind: 'createEdge',
          elementTypeId: 'istar.AndRefinementLink',
          sourceElementId: GOAL_1_ID,
          targetElementId: TASK_1_ID,
        },
      },
    ],
  };
}

export interface ChangeSetEntry {
  readonly step: AgentStep;
  readonly result: ActionResult<never>;
}

/** A model identical to `model`, but a different object, for a dry run to edit freely. */
function copyOf(model: AnyIstarModel): AnyIstarModel {
  return parsePistar(toPistar(model), {
    metamodel: metamodelOf(model),
    fileMetamodel: true,
  });
}

/**
 * Dry-runs `steps` against a scratch copy of `model`, in order, with `guards` — the same ones
 * the live dispatcher would apply. Never touches `model` or any store built over it.
 */
export async function dryRun(
  model: AnyIstarModel,
  steps: readonly AgentStep[],
  guards: readonly ActionGuard[] = [],
): Promise<readonly ChangeSetEntry[]> {
  const scratch = createModelStore(
    copyOf(model) as IstarModel | undefined,
  ) as unknown as ModelStore;
  const dispatcher = createActionDispatcher(scratch, { guards });
  const entries: ChangeSetEntry[] = [];
  for (const step of steps) {
    entries.push({ step, result: await dispatcher.dispatch(step.operation) });
  }
  dispatcher.dispose();
  return entries;
}
