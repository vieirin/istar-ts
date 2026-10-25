/**
 * The evaluation runner's harness plumbing (#132's "Verify"): task definitions load, metrics
 * aggregate correctly over fake per-run results, and the Text condition's parse-check-only guard
 * behaves as documented. No live model, no key: this is what CI runs for #132 (the real
 * evaluations are a manual, keyed invocation of `scripts/evaluate.ts`).
 */
import { describe, expect, test } from 'vitest';
import { ISTAR_2_0, parsePistar, toPistar } from '@istar-ts/core';
import type { AnyMetamodel } from '@istar-ts/core';
import type { AgentRun } from '../src';
import { CONDITIONS, pendingReason, setupCondition } from '../scripts/eval-conditions';
import { aggregateMetrics, computeRunMetrics } from '../scripts/eval-metrics';
import type { RunMetrics } from '../scripts/eval-metrics';
import { loadFixture, TASKS, tasksByFamily } from '../scripts/eval-tasks';

const METAMODEL = ISTAR_2_0 as unknown as AnyMetamodel;

describe('task definitions', () => {
  test('every task names a real fixture that parses', () => {
    expect(TASKS.length).toBeGreaterThan(0);
    for (const task of TASKS) {
      const model = parsePistar(loadFixture(task.fixture), { metamodel: METAMODEL });
      expect(model.elements.size).toBeGreaterThan(0);
    }
  });

  test('a retrieval task expects no edits; a modification task expects at least one', () => {
    for (const task of TASKS.filter((t) => t.id.includes('retrieval'))) {
      expect(task.expectedEdits).toEqual([]);
    }
    for (const task of TASKS.filter((t) => t.family === 'modification')) {
      expect(task.expectedEdits.length).toBeGreaterThan(0);
    }
  });

  test('tasksByFamily groups every task, in TASKS order', () => {
    const byFamily = tasksByFamily();
    expect([...byFamily.values()].flat()).toEqual(TASKS);
    expect([...byFamily.keys()].toSorted()).toEqual(
      ['conflict', 'large-model', 'modification', 'retrieval'].toSorted(),
    );
  });

  test('the conflict task expects a repair and forbids the rejected edit slipping through', () => {
    const task = TASKS.find((t) => t.family === 'conflict')!;
    expect(task.expectedEdits.length).toBeGreaterThan(0);
    expect(task.forbidden?.length).toBeGreaterThan(0);
  });
});

describe('pendingReason', () => {
  test('only the shield condition on backend A is pending (#136)', () => {
    expect(pendingReason('actions-shield', 'A')).toMatch(/#136/);
    expect(pendingReason('actions-shield', 'B')).toBeUndefined();
    expect(pendingReason('actions-no-guard', 'A')).toBeUndefined();
    expect(pendingReason('actions-no-guard', 'B')).toBeUndefined();
    expect(pendingReason('text', 'A')).toBeUndefined();
  });

  test('every documented condition is covered', () => {
    expect(CONDITIONS.map((c) => c.id).toSorted()).toEqual(
      ['actions-no-guard', 'actions-shield', 'text'].toSorted(),
    );
  });
});

describe('the Text condition', () => {
  test('one tool, replace-model; a parse check is its only guard', async () => {
    const model = parsePistar(loadFixture('welcome.txt'), { metamodel: METAMODEL });
    const setup = await setupCondition('text', 'B', model, METAMODEL);
    expect(setup.tools.list()).toEqual([expect.objectContaining({ name: 'replace-model' })]);

    const malformed = await setup.tools.call('replace-model', { pistarJson: '{not json' });
    expect(malformed).toMatchObject({ ok: false, diagnostics: [{ code: 'parse-error' }] });
    expect(setup.getModel()).toBe(model);

    const edited = {
      ...JSON.parse(toPistar(model, { metamodel: METAMODEL })),
      diagram: { width: 999, height: 999 },
    };
    const applied = await setup.tools.call('replace-model', { pistarJson: JSON.stringify(edited) });
    expect(applied).toMatchObject({ ok: true });
    expect(setup.getModel().diagram).toEqual({ width: 999, height: 999 });
  });

  test('refuses non-string arguments without ever touching parsePistar', async () => {
    const model = parsePistar(loadFixture('welcome.txt'), { metamodel: METAMODEL });
    const setup = await setupCondition('text', 'B', model, METAMODEL);
    const result = await setup.tools.call('replace-model', { pistarJson: 42 });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-arguments' }] });
  });
});

function fakeRun(toolCalls: AgentRun['transcript']['steps'][number]['toolCalls']): AgentRun {
  return {
    transcript: {
      model: 'fake',
      approval: 'auto',
      messages: [],
      steps: [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finishReason: null,
          latencyMs: 1,
          toolCalls,
        },
      ],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheHitTokens: 0,
        reasoningTokens: 0,
      },
      stop: { reason: 'final' },
      latencyMs: 42,
    },
    changeSet: [],
  };
}

describe('computeRunMetrics', () => {
  const task = TASKS.find((t) => t.id === 'modification-add-goal')!;

  test('a syntactic refusal does not count as a rejection the shield caught', () => {
    const run = fakeRun([
      {
        id: '1',
        name: 'createNode',
        arguments: '',
        args: null,
        disposition: 'applied',
        result: {
          ok: false,
          diagnostics: [
            { elementId: '', severity: 'error', message: 'bad', code: 'invalid-arguments' },
          ],
        },
        latencyMs: 1,
      },
    ]);
    const metrics = computeRunMetrics(task, run, undefined, false);
    expect(metrics.syntacticErrors).toBe(1);
    expect(metrics.rejectionsCaught).toBe(0);
    expect(metrics.modelDestroyed).toBe(true);
  });

  test('a guard refusal counts as a rejection caught, not a syntactic error', () => {
    const run = fakeRun([
      {
        id: '1',
        name: 'createNode',
        arguments: '',
        args: null,
        disposition: 'applied',
        result: {
          ok: false,
          diagnostics: [
            { elementId: '', severity: 'error', message: 'no tasks here', code: 'demo' },
          ],
        },
        latencyMs: 1,
      },
    ]);
    const metrics = computeRunMetrics(task, run, undefined, false);
    expect(metrics.syntacticErrors).toBe(0);
    expect(metrics.rejectionsCaught).toBe(1);
  });

  test('precision is 1 with no edits made, even when edits were expected', () => {
    const run = fakeRun([]);
    const metrics = computeRunMetrics(task, run, undefined, false);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0);
  });

  test('recall is 1 for a retrieval task (no edits expected) regardless of the model', () => {
    const retrieval = TASKS.find((t) => t.id === 'retrieval-actors')!;
    const run = fakeRun([]);
    const metrics = computeRunMetrics(retrieval, run, undefined, false);
    expect(metrics.recall).toBe(1);
  });
});

const fakeMetrics = (overrides: Partial<RunMetrics>): RunMetrics => ({
  precision: 1,
  recall: 1,
  syntacticErrors: 0,
  semanticErrors: 0,
  rejectionsCaught: 0,
  modelDestroyed: false,
  usage: {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cacheHitTokens: 0,
    reasoningTokens: 0,
  },
  wallClockMs: 1000,
  stop: 'final',
  ...overrides,
});

describe('aggregateMetrics', () => {
  test('mean and spread over a fake set of per-run results', () => {
    const runs: RunMetrics[] = [
      fakeMetrics({
        recall: 1,
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      }),
      fakeMetrics({
        recall: 0,
        modelDestroyed: true,
        usage: {
          promptTokens: 200,
          completionTokens: 40,
          totalTokens: 240,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      }),
      fakeMetrics({
        recall: 1,
        usage: {
          promptTokens: 150,
          completionTokens: 30,
          totalTokens: 180,
          cacheHitTokens: 0,
          reasoningTokens: 0,
        },
      }),
    ];
    const aggregate = aggregateMetrics(runs);
    expect(aggregate.runs).toBe(3);
    expect(aggregate.recall).toEqual({ mean: 2 / 3, min: 0, max: 1 });
    expect(aggregate.modelDestroyedCount).toBe(1);
    expect(aggregate.totalTokens).toEqual({ mean: (120 + 240 + 180) / 3, min: 120, max: 240 });
    expect(aggregate.cost).toBeUndefined();
  });

  test('cost is only reported when every run has one', () => {
    expect(aggregateMetrics([fakeMetrics({ cost: 0.01 }), fakeMetrics({})]).cost).toBeUndefined();
    expect(
      aggregateMetrics([fakeMetrics({ cost: 0.01 }), fakeMetrics({ cost: 0.03 })]).cost,
    ).toEqual({
      mean: 0.02,
      min: 0.01,
      max: 0.03,
    });
  });

  test('rejects an empty set of runs', () => {
    expect(() => aggregateMetrics([])).toThrow('at least one run is required');
  });
});
