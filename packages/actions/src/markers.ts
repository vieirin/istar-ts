import { DIAGNOSTIC_SEVERITIES } from '@istar-ts/core';
import type { DiagnosticSeverity, GoalDiagnostic } from '@istar-ts/core';
import type { Marker } from './actions';

/** A `GoalDiagnostic` as a GLSP marker: `kind` is its severity, `label` its message. */
export function diagnosticToMarker(diagnostic: GoalDiagnostic): Marker {
  const { elementId, key, severity, message, source, code } = diagnostic;
  return {
    label: message,
    description: source === undefined ? message : `${message} (${source})`,
    elementId,
    kind: severity,
    ...(key === undefined ? {} : { key }),
    ...(source === undefined ? {} : { source }),
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * A GLSP marker as a `GoalDiagnostic`. A `kind` that is no `DiagnosticSeverity` reads as
 * `info`; `range` and `data` are not carried by markers.
 */
export function markerToDiagnostic(marker: Marker): GoalDiagnostic {
  const { elementId, kind, label, key, source, code } = marker;
  const severity = (DIAGNOSTIC_SEVERITIES as readonly string[]).includes(kind)
    ? (kind as DiagnosticSeverity)
    : 'info';
  return {
    elementId,
    severity,
    message: label,
    ...(key === undefined ? {} : { key }),
    ...(source === undefined ? {} : { source }),
    ...(code === undefined ? {} : { code }),
  };
}
