import { afterEach, describe, expect, test, vi } from 'vitest';
import type { IstarAction } from '@istar-ts/actions';
import { createEmptyModel, createModelStore, toPistar } from '@istar-ts/core';
import { createLogStore, exportLog, logReducer, parseLogExport } from '../src/lab/log';
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

  test('getInitialModel is undefined until set', () => {
    const log = createLogStore();
    expect(log.getInitialModel()).toBeUndefined();
    const model = createEmptyModel();
    log.setInitialModel(model);
    expect(log.getInitialModel()).toBe(model);
  });

  test('attachStore captures the current model and clears the log on a load', () => {
    const store = createModelStore(createEmptyModel());
    const log = createLogStore();
    log.append(entry());

    log.attachStore(store);
    expect(log.getInitialModel()).toBe(store.getModel());

    const loaded = createEmptyModel();
    store.load(loaded);
    expect(log.getInitialModel()).toBe(loaded);
    expect(log.getEntries()).toEqual([]);
  });

  test('attachStore does not clear the log on an edit, only on a load', () => {
    const store = createModelStore(createEmptyModel());
    const log = createLogStore();
    log.attachStore(store);
    store.addElement({ kind: 'istar.Goal', x: 0, y: 0 });
    expect(log.getEntries()).toEqual([]);

    log.append(entry());
    store.addElement({ kind: 'istar.Goal', x: 10, y: 10 });
    expect(log.getEntries()).toHaveLength(1);
  });
});

describe('exportLog / parseLogExport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('round-trips the initial model and entries', () => {
    // Each toPistar call stamps saveDate with the current second: pin the clock so the two
    // calls below can't straddle a second boundary.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const model = createEmptyModel();
    const log = createLogStore();
    log.setInitialModel(model);
    log.append(entry());

    const exported = exportLog(log);
    const parsed = parseLogExport(exported);

    expect(toPistar(parsed.initialModel)).toBe(toPistar(model));
    expect(parsed.entries).toEqual(log.getEntries());
  });

  test('throws when the log has no initial model', () => {
    expect(() => exportLog(createLogStore())).toThrow('the log has no initial model to export');
  });
});
