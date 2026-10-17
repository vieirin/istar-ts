import type { LinkLabelProps } from '@istar-ts/react';
import type { ComponentType, ReactElement } from 'react';
import { KAOS_ASSIGNMENT_GLYPH, KAOS_CONFLICT_GLYPH } from './shapes';

/** Half the glyph box: DSM3's glyphs fit in ±16 around the midpoint. */
const R = 16;

/** A glyph drawn on the link's midpoint, as DSM3 does for Conflict and Responsibility links. */
export function LinkGlyph({ path, name }: { path: string; name?: string }): ReactElement {
  return (
    <div className="kaos-link-glyph">
      <svg width={2 * R} height={2 * R} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} aria-hidden>
        <path
          d={path}
          fill="var(--istar-canvas-bg, #fff)"
          stroke="var(--istar-link-stroke, #000)"
          strokeWidth={2}
        />
      </svg>
      {name ? <div className="istar-link-label is-name">{name}</div> : null}
    </div>
  );
}

function glyphLabel(path: string, displayName: string): ComponentType<LinkLabelProps> {
  function GlyphLabel({ labels }: LinkLabelProps): ReactElement {
    return <LinkGlyph path={path} {...(labels.name ? { name: labels.name } : {})} />;
  }
  GlyphLabel.displayName = displayName;
  return GlyphLabel;
}

/** Conflict's label: DSM3's lightning bolt. */
export const ConflictGlyph: ComponentType<LinkLabelProps> = glyphLabel(
  KAOS_CONFLICT_GLYPH,
  'ConflictGlyph',
);

/** Responsibility assignment's label: DSM3's circle. */
export const AssignmentGlyph: ComponentType<LinkLabelProps> = glyphLabel(
  KAOS_ASSIGNMENT_GLYPH,
  'AssignmentGlyph',
);
