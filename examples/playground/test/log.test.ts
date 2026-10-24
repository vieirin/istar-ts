import { describe, expect, test } from 'vitest';
import type { IstarAction } from '@istar-ts/actions';
import { createLogStore, logReducer } from '../src/lab/log';
import type { LogEntry } from '../src/lab/log';

const action: IstarAction = { kind: 'applyLabelEdit', labelId: 'a', text: 'New name' };

function entry(overrides: Partial<Omit<LogEntry, 'id'>> = {}): Omit<LogEntry, 'id'> {
  return {
    client: 'UI',
    action,
    result: { ok: true, createdIds: [] },
    startedAt: 0,
    durationMs: 0,
    ...overrides,
  };
}

describe('logReducer', () => {
  test('append adds an entry with a fresh, stable id', () => {
    const once = logReducer([], { type: 'append', entry: entry() });
    expect(once).toHaveLength(1);
    expect(once[0]!.id).toBe(0);

    const twice = logReducer(once, { type: 'append', entry: entry({ client: 'Script' }) });
    expect(twice).toHaveLength(2);
    expect(twice[1]!.id).toBe(1);
    // The first entry, and the array it lives in, are untouched (a pure reducer).
    expect(twice[0]).toBe(once[0]);
  });

  test('clear empties the log', () => {
    const withOne = logReducer([], { type: 'append', entry: entry() });
    expect(logReducer(withOne, { type: 'clear' })).toEqual([]);
  });
});

describe('createLogStore', () => {
  test('append notifies subscribers and getEntries reflects the new entry', () => {
    const log = createLogStore();
    let notified = 0;
    const unsubscribe = log.subscribe(() => {
      notified += 1;
    });
    log.append(entry());
    expect(notified).toBe(1);
    expect(log.getEntries()).toHaveLength(1);
    unsubscribe();
    log.append(entry());
    expect(notified).toBe(1);
    expect(log.getEntries()).toHaveLength(2);
  });

  test('clear notifies subscribers and empties getEntries', () => {
    const log = createLogStore();
    log.append(entry());
    let notified = 0;
    log.subscribe(() => {
      notified += 1;
    });
    log.clear();
    expect(notified).toBe(1);
    expect(log.getEntries()).toEqual([]);
  });
});
