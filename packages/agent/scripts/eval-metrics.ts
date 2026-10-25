/**
 * The level-7 evaluation metrics (#132 scope item 4), computed per run and aggregated (mean and
 * spread) across the 5 runs of one task × condition × fixture combination.
 */
import type { AnyIstarModel } from '@istar-ts/core';
import type { AgentRun, StopReason, UsageTotals } from '../src';
import type { EvalTask } from './eval-tasks';

/** A tool call's refusal diagnostics carry the model's own malformed input, not a guard. */
const SYNTACTIC_ERROR_CODES: ReadonlySet<string> = new Set(['invalid-arguments', 'parse-error']);

export interface RunMetrics {
  /**
   * Of the edits the run made, the share that satisfy an expected edit. 1 when the run made no
   * edits (vacuously no wrong one): a task with expected edits still shows the miss through 0
   * `recall` below, not a misleadingly low `precision`.
   */
  readonly precision: number;
  /** Of the task's expected edits, the share the final model satisfies. 1 when none are expected. */
  readonly recall: number;
  /** Tool calls refused for arguments the model itself got wrong (not valid JSON, bad shape). */
  readonly syntacticErrors: number;
  /** Forbidden states (a guard's dialect rule) that the final model reached anyway. */
  readonly semanticErrors: number;
  /** Tool calls a guard correctly refused. */
  readonly rejectionsCaught: number;
  /** The run's final model could not be read back, or round-tripped, as a valid piStar file. */
  readonly modelDestroyed: boolean;
  readonly usage: UsageTotals;
  readonly wallClockMs: number;
  readonly cost?: number;
  readonly stop: StopReason;
}

/**
 * One run's metrics. `finalModel` is the model to score `task.expectedEdits`/`task.forbidden`
 * against, or undefined when the run's model could not be read back at all (counts as
 * `modelDestroyed`, along with `modelDestroyed` passed in by the caller for a model that reads
 * back but does not round-trip as valid piStar).
 */
export function computeRunMetrics(
  task: EvalTask,
  run: AgentRun,
  finalModel: AnyIstarModel | undefined,
  modelDestroyed: boolean,
): RunMetrics {
  const toolCalls = run.transcript.steps.flatMap((step) => step.toolCalls);
  const edits = toolCalls.filter((call) => call.disposition !== 'read');
  const editsMade = edits.filter((call) => call.result.ok).length;
  const refusals = edits.filter((call) => !call.result.ok);
  const syntacticErrors = refusals.filter(
    (call) =>
      !call.result.ok &&
      call.result.diagnostics.some((d) => SYNTACTIC_ERROR_CODES.has(d.code ?? '')),
  ).length;
  const rejectionsCaught = refusals.length - syntacticErrors;

  const satisfied = finalModel
    ? task.expectedEdits.filter((edit) => edit.check(finalModel)).length
    : 0;
  const semanticErrors = finalModel
    ? (task.forbidden ?? []).filter((edit) => edit.check(finalModel)).length
    : 0;

  return {
    precision: editsMade === 0 ? 1 : satisfied / editsMade,
    recall: task.expectedEdits.length === 0 ? 1 : satisfied / task.expectedEdits.length,
    syntacticErrors,
    semanticErrors,
    rejectionsCaught,
    modelDestroyed: finalModel === undefined || modelDestroyed,
    usage: run.transcript.usage,
    wallClockMs: run.transcript.latencyMs,
    ...(run.transcript.cost === undefined ? {} : { cost: run.transcript.cost }),
    stop: run.transcript.stop.reason,
  };
}

export interface Spread {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

function spread(values: readonly number[]): Spread {
  return {
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export interface AggregatedMetrics {
  readonly runs: number;
  readonly precision: Spread;
  readonly recall: Spread;
  readonly syntacticErrors: Spread;
  readonly semanticErrors: Spread;
  readonly rejectionsCaught: Spread;
  readonly modelDestroyedCount: number;
  readonly totalTokens: Spread;
  readonly wallClockMs: Spread;
  readonly cost?: Spread;
}

/** Mean and spread of `runs`' metrics, over the 5 (or however many) runs of one combination. */
export function aggregateMetrics(runs: readonly RunMetrics[]): AggregatedMetrics {
  if (runs.length === 0) throw new Error('aggregateMetrics: at least one run is required');
  const costs = runs.map((r) => r.cost).filter((c): c is number => c !== undefined);
  return {
    runs: runs.length,
    precision: spread(runs.map((r) => r.precision)),
    recall: spread(runs.map((r) => r.recall)),
    syntacticErrors: spread(runs.map((r) => r.syntacticErrors)),
    semanticErrors: spread(runs.map((r) => r.semanticErrors)),
    rejectionsCaught: spread(runs.map((r) => r.rejectionsCaught)),
    modelDestroyedCount: runs.filter((r) => r.modelDestroyed).length,
    totalTokens: spread(runs.map((r) => r.usage.totalTokens)),
    wallClockMs: spread(runs.map((r) => r.wallClockMs)),
    ...(costs.length === runs.length ? { cost: spread(costs) } : {}),
  };
}
