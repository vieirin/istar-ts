/**
 * Orchestration (#132 scope items 3 and 5): 5 fresh runs per task × condition, each a run with no
 * state shared with any other, scored and aggregated into one `EvalReport`.
 */
import { ISTAR_2_0, parsePistar, toPistar } from '@istar-ts/core';
import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { runAgent } from '../src';
import type { ChatClient, Usage } from '../src';
import { CONDITIONS, setupCondition } from './eval-conditions';
import type { Backend, ConditionId } from './eval-conditions';
import type { ComboResult, EvalReport } from './eval-report';
import { aggregateMetrics, computeRunMetrics } from './eval-metrics';
import type { RunMetrics } from './eval-metrics';
import { TASKS, loadFixture } from './eval-tasks';
import type { EvalTask } from './eval-tasks';

export interface EvaluateOptions {
  readonly client: ChatClient;
  /** Default `'B'` (the actions dispatcher directly; backend A needs `@istar-ts/glsp`'s MCP server). */
  readonly backend?: Backend;
  /** Runs per task × condition. Default 5 (#132 scope item 3). */
  readonly runs?: number;
  /** Default every `CONDITIONS`. */
  readonly conditions?: readonly ConditionId[];
  /** Default `TASKS`. */
  readonly tasks?: readonly EvalTask[];
  /** Default `ISTAR_2_0` (every fixture this runs against is plain iStar 2.0). */
  readonly metamodel?: AnyMetamodel;
  /** Model calls at most, per run. Default `runAgent`'s own (20). */
  readonly maxSteps?: number;
  /** A run's cost from its usage, for the cost metric. Default: no cost reported. */
  readonly cost?: (usage: Usage) => number;
  /** Called after each run, for a progress line. */
  readonly onRun?: (info: {
    readonly taskId: string;
    readonly condition: ConditionId;
    readonly run: number;
    readonly runs: number;
  }) => void;
}

function promptFor(task: EvalTask, condition: ConditionId, model: AnyIstarModel): string {
  // The Text condition's only tool takes the whole replacement file, so the model needs the
  // current one in context; the other conditions read it themselves with a tool.
  if (condition !== 'text') return task.prompt;
  return `${task.prompt}\n\nThe current model, as piStar JSON:\n${toPistar(model)}`;
}

/** Whether `model` still reads back as a valid piStar file (never true for backend A/B: typed operations cannot leave the store in an invalid state; only the Text condition's raw JSON can). */
function isDestroyed(model: AnyIstarModel, metamodel: AnyMetamodel): boolean {
  try {
    parsePistar(toPistar(model, { metamodel }), { metamodel });
    return false;
  } catch {
    return true;
  }
}

async function runOne(
  client: ChatClient,
  task: EvalTask,
  condition: ConditionId,
  backend: Backend,
  metamodel: AnyMetamodel,
  maxSteps: number | undefined,
  cost: ((usage: Usage) => number) | undefined,
): Promise<RunMetrics> {
  const fixtureModel = parsePistar(loadFixture(task.fixture), { metamodel });
  const setup = await setupCondition(condition, backend, fixtureModel, metamodel);
  try {
    const run = await runAgent({
      client,
      prompt: promptFor(task, condition, fixtureModel),
      approval: 'auto',
      tools: setup.tools,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(cost ? { budget: { cost } } : {}),
    });
    let finalModel: AnyIstarModel | undefined;
    try {
      finalModel = setup.getModel();
    } catch {
      finalModel = undefined;
    }
    const destroyed = finalModel !== undefined && isDestroyed(finalModel, metamodel);
    return computeRunMetrics(task, run, finalModel, destroyed);
  } finally {
    await setup.close?.();
  }
}

async function runCombo(
  client: ChatClient,
  task: EvalTask,
  condition: ConditionId,
  options: Required<Pick<EvaluateOptions, 'backend' | 'runs' | 'metamodel'>> &
    Pick<EvaluateOptions, 'maxSteps' | 'cost' | 'onRun'>,
): Promise<ComboResult> {
  const base = {
    taskId: task.id,
    family: task.family,
    fixture: task.fixture,
    condition,
    backend: options.backend,
  };

  const runs: RunMetrics[] = [];
  for (let run = 1; run <= options.runs; run++) {
    runs.push(
      await runOne(
        client,
        task,
        condition,
        options.backend,
        options.metamodel,
        options.maxSteps,
        options.cost,
      ),
    );
    options.onRun?.({ taskId: task.id, condition, run, runs: options.runs });
  }
  return { ...base, aggregate: aggregateMetrics(runs) };
}

/** Runs every task × condition combination (#132's whole matrix) and reports the result. */
export async function evaluate(options: EvaluateOptions): Promise<EvalReport> {
  const backend = options.backend ?? 'B';
  const runs = options.runs ?? 5;
  const metamodel = options.metamodel ?? (ISTAR_2_0 as unknown as AnyMetamodel);
  const conditions = options.conditions ?? CONDITIONS.map((c) => c.id);
  const tasks = options.tasks ?? TASKS;

  const combos: ComboResult[] = [];
  for (const task of tasks) {
    for (const condition of conditions) {
      combos.push(
        await runCombo(options.client, task, condition, {
          backend,
          runs,
          metamodel,
          ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
          ...(options.cost ? { cost: options.cost } : {}),
          ...(options.onRun ? { onRun: options.onRun } : {}),
        }),
      );
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    model: options.client.model,
    runsPerCombo: runs,
    combos,
  };
}
