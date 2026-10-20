import type { DiagnosticSeverity, GoalDiagnostic } from '@istar-ts/core';
import { worstDiagnosticSeverity } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface TooltipPosition {
  readonly top: number;
  readonly flipped: boolean;
  readonly left?: number;
  readonly right?: number;
}

/** Beside the badge: right by default, flipped left if it would overflow the viewport. */
function positionBeside(mark: HTMLElement): TooltipPosition {
  const rect = mark.getBoundingClientRect();
  const tooltipWidth = 280;
  const overflowsRight = rect.right + 6 + tooltipWidth > window.innerWidth;
  return overflowsRight
    ? { top: rect.top, flipped: true, right: window.innerWidth - rect.left + 6 }
    : { top: rect.top, flipped: false, left: rect.right + 6 };
}

/**
 * Small severity badge for host-owned issues or diagnostics, showing the worst severity.
 * Renders nothing when there are none. Hover shows the messages in a portal beside the mark,
 * so links and the node it describes don't paint over it.
 */
export function ElementIssuesBadge({
  issues,
  diagnostics,
  className,
}: ElementIssuesBadgeProps): ReactElement | null {
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | undefined>();
  const markRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const updatePosition = useCallback(() => {
    if (markRef.current) setPosition(positionBeside(markRef.current));
  }, []);

  const show = useCallback(() => {
    if (hideTimer.current !== undefined) clearTimeout(hideTimer.current);
    updatePosition();
    setHovered(true);
  }, [updatePosition]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current !== undefined) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), 150);
  }, []);

  useEffect(() => {
    if (!hovered || typeof window === 'undefined') return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [hovered, updatePosition]);

  const entries = diagnostics
    ? diagnostics.map((d) => ({ severity: d.severity, text: describeDiagnostic(d) }))
    : (issues ?? []).map((i) => ({ severity: i.severity, text: i.message }));
  const severity = worstDiagnosticSeverity(entries);
  if (!severity) return null;

  const classes = ['istar-issues-badge', `is-${severity}`, className].filter(Boolean).join(' ');

  const tooltip = hovered && position && (
    <div
      className={`istar-issues-badge-tooltip is-${severity}`}
      style={{
        top: position.top,
        left: position.left,
        right: position.right,
      }}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onScroll={updatePosition}
    >
      <div className="istar-issues-badge-title">{TITLES[severity]}</div>
      <ul className="istar-issues-badge-list">
        {entries.map((entry, i) => (
          <li key={`${entry.text}-${i}`} className={`is-${entry.severity}`}>
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className={classes}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      role="status"
      aria-label={`${severity}: ${entries.map((e) => e.text).join('; ')}`}
    >
      <span className="istar-issues-badge-mark" aria-hidden ref={markRef}>
        {severity === 'error' || severity === 'warning' ? '!' : 'i'}
      </span>
      {tooltip &&
        (typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body))}
    </div>
  );
}
