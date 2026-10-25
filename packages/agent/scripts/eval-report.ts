/**
 * The runner's output (#132 scope item 7): one `EvalReport`, written as JSON and as a markdown
 * table (`evaluate.ts`'s `--out`), never committed — a point-in-time artefact of a live key and
 * model.
 */
import type { Backend, ConditionId } from './eval-conditions';
import type { AggregatedMetrics } from './eval-metrics';
import type { TaskFamily } from './eval-tasks';

export interface ComboResult {
  readonly taskId: string;
  readonly family: TaskFamily;
  readonly fixture: string;
  readonly condition: ConditionId;
  readonly backend: Backend;
  readonly aggregate: AggregatedMetrics;
}

export interface EvalReport {
  readonly generatedAt: string;
  readonly model: string;
  readonly runsPerCombo: number;
  readonly combos: readonly ComboResult[];
}

function row(c: ComboResult): string {
  const a = c.aggregate;
  const cost = a.cost === undefined ? '' : `, $${a.cost.mean.toFixed(4)}`;
  const result =
    `precision ${a.precision.mean.toFixed(2)}, recall ${a.recall.mean.toFixed(2)}, ` +
    `syntactic ${a.syntacticErrors.mean.toFixed(2)}, semantic ${a.semanticErrors.mean.toFixed(2)}, ` +
    `rejections ${a.rejectionsCaught.mean.toFixed(2)}, destroyed ${a.modelDestroyedCount}/${a.runs}, ` +
    `tokens ${a.totalTokens.mean.toFixed(0)} (±${(a.totalTokens.max - a.totalTokens.min).toFixed(0)}), ` +
    `${a.wallClockMs.mean.toFixed(0)}ms${cost}`;
  return `| ${c.taskId} | ${c.condition} | ${c.backend} | ${result} |`;
}

export function toMarkdown(report: EvalReport): string {
  return [
    `# Level-7 evaluation — ${report.model}`,
    '',
    `Generated ${report.generatedAt}, ${report.runsPerCombo} runs per combination.`,
    '',
    '| Task | Condition | Backend | Result (mean across runs) |',
    '| --- | --- | --- | --- |',
    ...report.combos.map(row),
  ].join('\n');
}
