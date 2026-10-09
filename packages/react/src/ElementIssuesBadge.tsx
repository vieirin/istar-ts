import type { DiagnosticSeverity, GoalDiagnostic } from '@istar-ts/core';
import { worstDiagnosticSeverity } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ElementIssue } from './issues';

export interface ElementIssuesBadgeProps {
  readonly issues?: readonly ElementIssue[];
  /** Diagnostics to show (with their source and property); used instead of `issues` if given. */
  readonly diagnostics?: readonly GoalDiagnostic[];
  readonly className?: string;
}

const TITLES: Readonly<Record<DiagnosticSeverity, string>> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  hint: 'Hint',
};

/** `[source] key: message`, the line a diagnostic gets in badges and lists. */
export function describeDiagnostic(diagnostic: GoalDiagnostic): string {
  return `${diagnostic.source ? `[${diagnostic.source}] ` : ''}${
    diagnostic.key === undefined ? '' : `${diagnostic.key}: `
  }${diagnostic.message}`;
}

/**
 * Small severity badge for host-owned issues or diagnostics, showing the worst severity.
 * Renders nothing when there are none. Hover shows the messages.
 */
export function ElementIssuesBadge({
  issues,
  diagnostics,
  className,
}: ElementIssuesBadgeProps): ReactElement | null {
  const [hovered, setHovered] = useState(false);
  const entries = diagnostics
    ? diagnostics.map((d) => ({ severity: d.severity, text: describeDiagnostic(d) }))
    : (issues ?? []).map((i) => ({ severity: i.severity, text: i.message }));
  const severity = worstDiagnosticSeverity(entries);
  if (!severity) return null;

  const classes = ['istar-issues-badge', `is-${severity}`, className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="status"
      aria-label={`${severity}: ${entries.map((e) => e.text).join('; ')}`}
    >
      <span className="istar-issues-badge-mark" aria-hidden>
        {severity === 'error' || severity === 'warning' ? '!' : 'i'}
      </span>
      {hovered && (
        <div className="istar-issues-badge-tooltip">
          <div className="istar-issues-badge-title">{TITLES[severity]}</div>
          <ul className="istar-issues-badge-list">
            {entries.map((entry, i) => (
              <li key={`${entry.text}-${i}`} className={`is-${entry.severity}`}>
                {entry.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
