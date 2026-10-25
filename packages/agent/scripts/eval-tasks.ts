/**
 * Task families and the tasks that exercise them (#132 scope item 1): a natural-language prompt
 * over a fixture, with checks against the run's final model.
 *
 * - **retrieval** — a question answerable by reading the model; no edit is expected.
 * - **modification** — a stated change the agent must make through its tools.
 * - **large-model** — the same two shapes, against `smartHome.txt` (237 ids, #126 §4) to see how
 *   retrieval/modification degrade with size.
 * - **conflict** — a task that invites a guard-rejected edit, with a repair the agent can make
 *   instead, to see whether it repairs after a refusal or gives up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyIstarModel, IstarElement } from '@istar-ts/core';

export type TaskFamily = 'retrieval' | 'modification' | 'large-model' | 'conflict';

export interface ExpectedEdit {
  readonly id: string;
  readonly description: string;
  readonly check: (model: AnyIstarModel) => boolean;
}

export interface EvalTask {
  readonly id: string;
  readonly family: TaskFamily;
  /** File name under `fixtures/pistar`. */
  readonly fixture: string;
  readonly prompt: string;
  /** Checks a correct run's final model should satisfy; empty for a retrieval task. */
  readonly expectedEdits: readonly ExpectedEdit[];
  /** Checks the final model should never satisfy, even with guards off (a semantic error). */
  readonly forbidden?: readonly ExpectedEdit[];
}

/** `fixtures/pistar/<name>`'s text, as the fixtures the agent and loop tests already read it. */
export function loadFixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '../../../fixtures/pistar', name), 'utf8');
}

const elements = (model: AnyIstarModel): readonly IstarElement<string>[] => [
  ...model.elements.values(),
];

const hasElement = (model: AnyIstarModel, kind: string, name: string, parent?: string): boolean =>
  elements(model).some(
    (e) => e.kind === kind && e.name === name && (parent === undefined || e.parent === parent),
  );

// fixtures/pistar/welcome.txt: the actor "piStar tool v2.1.0".
const WELCOME_ACTOR = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';
// fixtures/pistar/smartHome.txt: the actor "Data storage" (0 inner elements, a clean target).
const SMART_HOME_DATA_STORAGE = '397fb3fe-da8d-4a72-a1c2-3bf6f87a1da5';
// fixtures/pistar/smartHome.txt: the actor "Smart home system" (69 inner elements).
const SMART_HOME_ACTOR = '0c7fe3d8-ed88-4bc1-8464-80c769a1b97f';

export const TASKS: readonly EvalTask[] = [
  {
    id: 'retrieval-actors',
    family: 'retrieval',
    fixture: 'welcome.txt',
    prompt:
      'How many actors does this model have, and what is each one named? Answer only; make no changes.',
    expectedEdits: [],
  },
  {
    id: 'modification-add-goal',
    family: 'modification',
    fixture: 'welcome.txt',
    prompt:
      'Add a new Goal named "Review access logs regularly" inside the actor "piStar tool v2.1.0".',
    expectedEdits: [
      {
        id: 'goal-created',
        description: 'a Goal "Review access logs regularly" inside the welcome actor',
        check: (model) =>
          hasElement(model, 'istar.Goal', 'Review access logs regularly', WELCOME_ACTOR),
      },
    ],
  },
  {
    id: 'large-model-retrieval',
    family: 'large-model',
    fixture: 'smartHome.txt',
    prompt:
      'How many elements does the actor "Smart home system" contain? Answer only; make no changes.',
    expectedEdits: [],
  },
  {
    id: 'large-model-modification',
    family: 'large-model',
    fixture: 'smartHome.txt',
    prompt: 'Add a new Goal named "Encrypt stored data" inside the actor "Data storage".',
    expectedEdits: [
      {
        id: 'goal-created',
        description: 'a Goal "Encrypt stored data" inside "Data storage"',
        check: (model) =>
          hasElement(model, 'istar.Goal', 'Encrypt stored data', SMART_HOME_DATA_STORAGE),
      },
    ],
  },
  {
    id: 'conflict-task-rejected',
    family: 'conflict',
    fixture: 'welcome.txt',
    prompt:
      'Add a Task named "Illegal task" inside the actor "piStar tool v2.1.0". If that is refused, ' +
      'add a Goal with the same name there instead.',
    expectedEdits: [
      {
        id: 'repaired-with-goal',
        description: 'a Goal "Illegal task" inside the welcome actor, after the Task was refused',
        check: (model) => hasElement(model, 'istar.Goal', 'Illegal task', WELCOME_ACTOR),
      },
    ],
    forbidden: [
      {
        id: 'task-slipped-through',
        description: 'a Task "Illegal task" (the guard should have rejected it)',
        check: (model) => hasElement(model, 'istar.Task', 'Illegal task', WELCOME_ACTOR),
      },
    ],
  },
];

/** `TASKS` grouped by `family`, in `TASKS`' order. */
export function tasksByFamily(): ReadonlyMap<TaskFamily, readonly EvalTask[]> {
  const byFamily = new Map<TaskFamily, EvalTask[]>();
  for (const task of TASKS) {
    (byFamily.get(task.family) ?? byFamily.set(task.family, []).get(task.family)!).push(task);
  }
  return byFamily;
}

export { SMART_HOME_ACTOR, SMART_HOME_DATA_STORAGE, WELCOME_ACTOR };
