import { describe, expect, test, vi } from 'vitest';
import type { GoalDiagnostic, LspDiagnosticLike, NodeIdDiagnostic } from '../src';
import {
  createDiagnosticsStore,
  fromLspDiagnostic,
  fromLspDiagnostics,
  fromNodeIdDiagnostic,
  fromNodeIdDiagnostics,
  groupDiagnostics,
  mergeDiagnostics,
  parsePistar,
  toPistar,
  worstDiagnosticSeverity,
} from '../src';
import { loadFixtures } from './fixtures';

const d = (
  elementId: string,
  severity: GoalDiagnostic['severity'],
  message: string,
  extra: Partial<GoalDiagnostic> = {},
): GoalDiagnostic => ({ elementId, severity, message, ...extra });

describe('merging', () => {
  test('union in order, deduplicated by (elementId, key, message), keeping the worst severity', () => {
    const merged = mergeDiagnostics([
      [d('a', 'warning', 'm', { source: 'one' }), d('a', 'info', 'm', { key: 'k' })],
      [d('a', 'error', 'm', { source: 'two' }), d('b', 'hint', 'x')],
      undefined,
    ]);
    expect(merged).toEqual([
      d('a', 'error', 'm', { source: 'one' }),
      d('a', 'info', 'm', { key: 'k' }),
      d('b', 'hint', 'x'),
    ]);
  });

  test('worst severity and grouping', () => {
    expect(worstDiagnosticSeverity([d('a', 'hint', 'h'), d('a', 'info', 'i')])).toBe('info');
    expect(worstDiagnosticSeverity([d('a', 'warning', 'w'), d('a', 'error', 'e')])).toBe('error');
    expect(worstDiagnosticSeverity([])).toBeUndefined();
    const grouped = groupDiagnostics([
      d('a', 'info', '1'),
      d('b', 'info', '2'),
      d('a', 'hint', '3'),
    ]);
    expect(grouped.get('a')?.map((x) => x.message)).toEqual(['1', '3']);
    expect(grouped.get('b')).toHaveLength(1);
  });
});

describe('store', () => {
  test('publish replaces a source, stamps it, and merges across sources', () => {
    const store = createDiagnosticsStore();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    store.publish('lsp', [d('a', 'error', 'bad'), d('b', 'info', 'note', { source: 'mutrose' })]);
    store.publish('prism', [d('a', 'error', 'bad'), d('c', 'warning', 'slow')]);
    expect(store.sources()).toEqual(['lsp', 'prism']);
    expect(store.get('lsp')[0]?.source).toBe('lsp');
    expect(store.get('lsp')[1]?.source).toBe('mutrose');
    expect(store.getAll().map((x) => `${x.elementId}:${x.source}`)).toEqual([
      'a:lsp',
      'b:mutrose',
      'c:prism',
    ]);
    const before = store.getAll();
    expect(store.getAll()).toBe(before);

    store.publish('lsp', [d('b', 'hint', 'later')]);
    expect(store.getAll().map((x) => x.message)).toEqual(['later', 'bad', 'slow']);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('per-source and full clearing', () => {
    const store = createDiagnosticsStore();
    const listener = vi.fn<() => void>();
    const unsubscribe = store.subscribe(listener);
    store.publish('one', [d('a', 'error', 'x')]);
    store.publish('two', [d('b', 'error', 'y')]);
    store.clear('one');
    expect(store.sources()).toEqual(['two']);
    expect(store.getAll().map((x) => x.elementId)).toEqual(['b']);
    store.clear('missing');
    store.publish('two', []);
    expect(store.getAll()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
    store.publish('three', [d('c', 'info', 'z')]);
    store.clear();
    expect(store.sources()).toEqual([]);
    unsubscribe();
    store.publish('four', [d('d', 'info', 'w')]);
    expect(listener).toHaveBeenCalledTimes(6);
  });
});

describe('adapters', () => {
  test('LSP diagnostics anchored by data.elementId / data.nodeId and data.key', () => {
    const range = { start: { line: 3, character: 2 }, end: { line: 3, character: 9 } };
    const lsp: LspDiagnosticLike[] = [
      {
        range,
        severity: 2,
        message: 'unknown key',
        source: 'goal-language',
        code: 12,
        data: { elementId: 'G1', key: 'Monitors' },
      },
      {
        range,
        severity: 4,
        message: { value: 'hint' },
        data: { nodeId: 'G2' },
        code: { value: 'x' },
      },
      { range, message: 'no severity', data: { elementId: 'G3' } },
      { range, severity: 1, message: 'unanchored' },
    ];
    expect(fromLspDiagnostics(lsp)).toEqual([
      {
        elementId: 'G1',
        key: 'Monitors',
        severity: 'warning',
        message: 'unknown key',
        source: 'goal-language',
        range,
        code: '12',
        data: { elementId: 'G1', key: 'Monitors' },
      },
      {
        elementId: 'G2',
        severity: 'hint',
        message: 'hint',
        range,
        code: 'x',
        data: { nodeId: 'G2' },
      },
      {
        elementId: 'G3',
        severity: 'error',
        message: 'no severity',
        range,
        data: { elementId: 'G3' },
      },
    ]);
    expect(fromLspDiagnostic(lsp[3]!)).toBeUndefined();
    // One argument, so it is safe as an array callback.
    expect(lsp.map(fromLspDiagnostic).filter(Boolean)).toHaveLength(3);
  });

  test('range-anchored LSP diagnostics and VS Code severity numbering', () => {
    const lines = new Map([[3, 'G7']]);
    const converted = fromLspDiagnostics(
      [
        {
          range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } },
          severity: 0,
          message: 'e',
        },
        {
          range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } },
          severity: 1,
          message: 'w',
        },
      ],
      { elementIdFor: (x) => lines.get(x.range!.start.line), severityNumbering: 'vscode' },
    );
    expect(converted.map((x) => [x.elementId, x.severity])).toEqual([['G7', 'error']]);
  });

  test('MutRoSe { nodeId, severity, message } in one line', () => {
    const posted: NodeIdDiagnostic[] = [
      { nodeId: 'G1', severity: 'error', message: 'missing Controls', source: 'mutrose' },
      { severity: 'warning', message: 'no node found' },
      { nodeId: 'AT2', severity: 'info', message: 'ok' },
    ];
    const store = createDiagnosticsStore();
    store.publish('mutrose', fromNodeIdDiagnostics(posted));
    expect(store.getAll()).toEqual([
      { elementId: 'G1', severity: 'error', message: 'missing Controls', source: 'mutrose' },
      { elementId: 'AT2', severity: 'info', message: 'ok', source: 'mutrose' },
    ]);
    expect(
      fromNodeIdDiagnostic({ nodeId: 'x', severity: 'toString', message: 'm' })?.severity,
    ).toBe('info');
  });
});

test('fixtures still round-trip with diagnostics published about them', () => {
  const store = createDiagnosticsStore();
  const fixtures = loadFixtures();
  for (const { name, text } of fixtures) {
    const model = parsePistar(text);
    store.publish(
      name,
      [...model.elements.keys()].map((id) => d(id, 'warning', 'checked')),
    );
    expect(JSON.parse(toPistar(model))).toStrictEqual(JSON.parse(text));
  }
  expect(store.sources().length).toBe(fixtures.length);
});
