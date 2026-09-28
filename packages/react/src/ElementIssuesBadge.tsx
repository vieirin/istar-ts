import type { ReactElement } from 'react';
import { useState } from 'react';
import type { ElementIssue } from './issues';
import { worstSeverity } from './issues';

export interface ElementIssuesBadgeProps {
  readonly issues: readonly ElementIssue[];
  readonly className?: string;
}

/**
 * Small severity badge for host-owned issues (e.g. LSP diagnostics). Renders nothing when
 * `issues` is empty. Hover shows the messages.
 */
export function ElementIssuesBadge({
  issues,
  className,
}: ElementIssuesBadgeProps): ReactElement | null {
  const [hovered, setHovered] = useState(false);
  const severity = worstSeverity(issues);
  if (!severity) return null;

  const classes = ['istar-issues-badge', `is-${severity}`, className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="status"
      aria-label={`${severity}: ${issues.map((i) => i.message).join('; ')}`}
    >
      <span className="istar-issues-badge-mark" aria-hidden>
        !
      </span>
      {hovered && (
        <div className="istar-issues-badge-tooltip">
          <div className="istar-issues-badge-title">
            {severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Info'}
          </div>
          <ul className="istar-issues-badge-list">
            {issues.map((issue, i) => (
              <li key={`${issue.message}-${i}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
