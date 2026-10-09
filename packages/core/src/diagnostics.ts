/**
 * The Goal Model Diagnostics Protocol: findings about a model's elements and links, published by
 * any analyser (a language server, a validator, a simulation…) and anchored by element id rather
 * than by text position. Data only: diagnostics are never part of the model and are never
 * written to disk.
 *
 * See goal-controller issue #24 (option D). Producers publish per source; consumers see the
 * union of every source, deduplicated by `(elementId, key, message)`.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/** Most severe first. */
export const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  'error',
  'warning',
  'info',
  'hint',
];

/** A zero-based position in the producer's document (as in LSP). */
export interface DiagnosticPosition {
  readonly line: number;
  readonly character: number;
}

export interface DiagnosticRange {
  readonly start: DiagnosticPosition;
  readonly end: DiagnosticPosition;
}

export interface GoalDiagnostic {
  /** Id of the element or link the diagnostic is about. */
  readonly elementId: string;
  /** The custom property it is about; absent for the element as a whole. */
  readonly key?: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Who published it (e.g. `mutrose`, `goal-language`). */
  readonly source?: string;
  /** Where it was found in the producer's document, if it has one. */
  readonly range?: DiagnosticRange;
  readonly code?: string;
  /** Producer data, passed through untouched. */
  readonly data?: unknown;
}

const RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/** Negative when `a` is more severe than `b`. */
export function compareSeverity(a: DiagnosticSeverity, b: DiagnosticSeverity): number {
  return RANK[a] - RANK[b];
}

/** The most severe severity in a list (what a badge shows), or `undefined` if it is empty. */
export function worstDiagnosticSeverity(
  diagnostics: readonly { readonly severity: DiagnosticSeverity }[] | undefined,
): DiagnosticSeverity | undefined {
  let worst: DiagnosticSeverity | undefined;
  for (const d of diagnostics ?? []) {
    if (worst === undefined || RANK[d.severity] < RANK[worst]) worst = d.severity;
    if (worst === 'error') break;
  }
  return worst;
}

function identity(d: GoalDiagnostic): string {
  return `${d.elementId}\u0000${d.key ?? ''}\u0000${d.message}`;
}

/**
 * The union of several lists, in order, without duplicates: diagnostics with the same
 * `(elementId, key, message)` count once, keeping the first one's position and the most severe
 * severity among them.
 */
export function mergeDiagnostics(
  lists: Iterable<readonly GoalDiagnostic[] | undefined>,
): GoalDiagnostic[] {
  const result: GoalDiagnostic[] = [];
  const index = new Map<string, number>();
  for (const list of lists) {
    for (const d of list ?? []) {
      const id = identity(d);
      const at = index.get(id);
      if (at === undefined) {
        index.set(id, result.length);
        result.push(d);
      } else if (RANK[d.severity] < RANK[result[at]!.severity]) {
        result[at] = { ...result[at]!, severity: d.severity };
      }
    }
  }
  return result;
}

/** Diagnostics by element (or link) id, each list in the input order. */
export function groupDiagnostics(
  diagnostics: readonly GoalDiagnostic[] | undefined,
): ReadonlyMap<string, readonly GoalDiagnostic[]> {
  const map = new Map<string, GoalDiagnostic[]>();
  for (const d of diagnostics ?? []) {
    const list = map.get(d.elementId);
    if (list) list.push(d);
    else map.set(d.elementId, [d]);
  }
  return map;
}

/**
 * Holds the diagnostics of several sources. Each `publish` replaces that source's set, so a
 * producer re-publishes everything it currently reports, as an LSP server does.
 */
export interface DiagnosticsStore {
  /**
   * Replaces `source`'s diagnostics (an empty list clears them). Entries without a `source` get
   * this one.
   */
  publish(source: string, diagnostics: readonly GoalDiagnostic[]): void;
  /** Removes one source's diagnostics, or every source's. */
  clear(source?: string): void;
  /** Sources with diagnostics, in the order they first published. */
  sources(): readonly string[];
  /** One source's diagnostics. */
  get(source: string): readonly GoalDiagnostic[];
  /**
   * Every source's diagnostics, merged (see `mergeDiagnostics`). The same array until the next
   * change, so it can back `useSyncExternalStore`.
   */
  getAll(): readonly GoalDiagnostic[];
  subscribe(listener: () => void): () => void;
}

const NONE: readonly GoalDiagnostic[] = [];

export function createDiagnosticsStore(): DiagnosticsStore {
  const bySource = new Map<string, readonly GoalDiagnostic[]>();
  const listeners = new Set<() => void>();
  let merged: readonly GoalDiagnostic[] = NONE;
  const changed = (): void => {
    merged = bySource.size === 0 ? NONE : mergeDiagnostics(bySource.values());
    for (const listener of listeners) listener();
  };
  return {
    publish(source, diagnostics) {
      if (diagnostics.length === 0) {
        if (bySource.delete(source)) changed();
        return;
      }
      bySource.set(
        source,
        diagnostics.map((d) => (d.source === undefined ? { ...d, source } : d)),
      );
      changed();
    },
    clear(source) {
      if (source === undefined) {
        if (bySource.size === 0) return;
        bySource.clear();
      } else if (!bySource.delete(source)) {
        return;
      }
      changed();
    },
    sources: () => [...bySource.keys()],
    get: (source) => bySource.get(source) ?? NONE,
    getAll: () => merged,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Adapters

/**
 * The parts of an LSP `Diagnostic` the adapter reads (structurally typed, so no LSP library is
 * needed). The element is taken from `data.elementId`, or MutRoSe's `data.nodeId`; the property
 * from `data.key`.
 */
export interface LspDiagnosticLike {
  readonly range?: DiagnosticRange;
  /** LSP numbering: 1 error, 2 warning, 3 information, 4 hint. */
  readonly severity?: number;
  readonly message: string | { readonly value: string };
  readonly source?: string;
  readonly code?: string | number | { readonly value: string | number };
  readonly data?: unknown;
}

export interface FromLspOptions<D extends LspDiagnosticLike = LspDiagnosticLike> {
  /**
   * The element of a diagnostic whose `data` names none, e.g. by looking its range up in the
   * document. Return `undefined` to drop it.
   */
  readonly elementIdFor?: (diagnostic: D) => string | undefined;
  /**
   * `'vscode'` for `vscode.Diagnostic` objects, whose severity counts from 0 (error) to 3
   * (hint). Default `'lsp'`, the protocol's 1 to 4.
   */
  readonly severityNumbering?: 'lsp' | 'vscode';
}

const LSP_SEVERITIES: readonly DiagnosticSeverity[] = ['error', 'warning', 'info', 'hint'];

function anchorOf(data: unknown): { elementId?: string; key?: string } {
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  const elementId =
    typeof record.elementId === 'string'
      ? record.elementId
      : typeof record.nodeId === 'string'
        ? record.nodeId
        : undefined;
  return {
    ...(elementId ? { elementId } : {}),
    ...(typeof record.key === 'string' ? { key: record.key } : {}),
  };
}

function convertLsp<D extends LspDiagnosticLike>(
  d: D,
  options: FromLspOptions<D>,
): GoalDiagnostic | undefined {
  const anchor = anchorOf(d.data);
  const elementId = anchor.elementId ?? options.elementIdFor?.(d);
  if (!elementId) return undefined;
  const base = options.severityNumbering === 'vscode' ? 0 : 1;
  // LSP leaves a missing severity to the client; VS Code shows it as an error.
  const severity =
    d.severity === undefined ? 'error' : (LSP_SEVERITIES[d.severity - base] ?? 'error');
  const code = typeof d.code === 'object' ? d.code.value : d.code;
  return {
    elementId,
    ...(anchor.key !== undefined ? { key: anchor.key } : {}),
    severity,
    message: typeof d.message === 'string' ? d.message : d.message.value,
    ...(d.source !== undefined ? { source: d.source } : {}),
    ...(d.range ? { range: d.range } : {}),
    ...(code !== undefined ? { code: String(code) } : {}),
    ...(d.data !== undefined ? { data: d.data } : {}),
  };
}

/**
 * One LSP diagnostic anchored by `data.elementId` (or `data.nodeId`), or `undefined` when it
 * names no element. For range-anchored diagnostics use `fromLspDiagnostics` with `elementIdFor`.
 */
export function fromLspDiagnostic(diagnostic: LspDiagnosticLike): GoalDiagnostic | undefined {
  return convertLsp(diagnostic, {});
}

/** LSP diagnostics as goal diagnostics; those that can't be anchored to an element are dropped. */
export function fromLspDiagnostics<D extends LspDiagnosticLike>(
  diagnostics: readonly D[],
  options: FromLspOptions<D> = {},
): GoalDiagnostic[] {
  const result: GoalDiagnostic[] = [];
  for (const d of diagnostics) {
    const converted = convertLsp(d, options);
    if (converted) result.push(converted);
  }
  return result;
}

/**
 * The shape MutRoSe's VS Code extension posts to its webview: `{ nodeId, severity, message }`
 * (plus `range` and `source`). `nodeId` is missing when no node could be found.
 */
export interface NodeIdDiagnostic {
  readonly nodeId?: string;
  readonly key?: string;
  readonly severity: DiagnosticSeverity | string;
  readonly message: string;
  readonly source?: string;
  readonly range?: DiagnosticRange;
  readonly code?: string;
}

/** One `{ nodeId, severity, message }` diagnostic, or `undefined` without a `nodeId`. */
export function fromNodeIdDiagnostic(diagnostic: NodeIdDiagnostic): GoalDiagnostic | undefined {
  const { nodeId, severity, ...rest } = diagnostic;
  if (!nodeId) return undefined;
  return {
    ...rest,
    elementId: nodeId,
    severity: Object.hasOwn(RANK, severity) ? (severity as DiagnosticSeverity) : 'info',
  };
}

/**
 * `{ nodeId, severity, message }` diagnostics (MutRoSe) as goal diagnostics, dropping those
 * without a node: `store.publish('mutrose', fromNodeIdDiagnostics(message.diagnostics))`.
 */
export function fromNodeIdDiagnostics(diagnostics: readonly NodeIdDiagnostic[]): GoalDiagnostic[] {
  const result: GoalDiagnostic[] = [];
  for (const d of diagnostics) {
    const converted = fromNodeIdDiagnostic(d);
    if (converted) result.push(converted);
  }
  return result;
}
