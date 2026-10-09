import type { GoalDiagnostic } from '@istar-ts/core';

/**
 * Host-owned annotations for elements/links (e.g. LSP diagnostics from a VS Code webview).
 * Orthogonal to the model and to PropertySchema validation — never written to disk.
 *
 * `ElementIssue` is the element-level subset of `GoalDiagnostic` (`id` is its `elementId`; no
 * property `key`, `source` or `range`). The `issues` prop takes them as before; they are merged
 * with the other diagnostics (see `issueToDiagnostic`).
 */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ElementIssue {
  /** Element or link id the issue belongs to. */
  readonly id: string;
  readonly severity: IssueSeverity;
  readonly message: string;
}

/** Builds a map of id → issues for O(1) lookup while rendering nodes. */
export function groupIssuesById(
  issues: readonly ElementIssue[] | undefined,
): ReadonlyMap<string, readonly ElementIssue[]> {
  if (!issues?.length) return EMPTY_ISSUES;
  const map = new Map<string, ElementIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.id);
    if (list) list.push(issue);
    else map.set(issue.id, [issue]);
  }
  return map;
}

const EMPTY_ISSUES: ReadonlyMap<string, readonly ElementIssue[]> = new Map();

/** Worst severity among a list (`error` > `warning` > `info`), or `undefined` if empty. */
export function worstSeverity(
  issues: readonly ElementIssue[] | undefined,
): IssueSeverity | undefined {
  if (!issues?.length) return undefined;
  let worst: IssueSeverity = 'info';
  for (const issue of issues) {
    if (issue.severity === 'error') return 'error';
    if (issue.severity === 'warning') worst = 'warning';
  }
  return worst;
}

/** An issue as a diagnostic: `{ id, severity, message }` → `{ elementId, severity, message }`. */
export function issueToDiagnostic(issue: ElementIssue): GoalDiagnostic {
  return { elementId: issue.id, severity: issue.severity, message: issue.message };
}

/**
 * A diagnostic as an issue, for components written against `issues`. Hints read as `info`; a
 * property's diagnostic is prefixed with its key.
 */
export function diagnosticToIssue(diagnostic: GoalDiagnostic): ElementIssue {
  return {
    id: diagnostic.elementId,
    severity: diagnostic.severity === 'hint' ? 'info' : diagnostic.severity,
    message:
      diagnostic.key === undefined
        ? diagnostic.message
        : `${diagnostic.key}: ${diagnostic.message}`,
  };
}
