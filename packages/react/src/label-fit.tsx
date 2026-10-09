/**
 * Element labels: where the name is laid out (`textBox`), optional header lines above it
 * (`labelHeader`, e.g. «stereotype» or {tag = value}), and how the text is fitted (`labelFit`).
 *
 * The defaults reproduce piStar: the name wraps at the element's full width with 1em lines (as
 * JointJS's `breakText` does), so names that fit are laid out exactly as before. Fitting only
 * changes names that would overflow, and never changes model data except in the opt-in `grow`
 * mode, after an edit.
 */
import type { CSSProperties, RefObject, ReactElement } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { EditableLabel } from './default-components';

/** Fractions of the element's box cut from each side to get the box the label is laid out in. */
export interface TextBox {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface LabelFit {
  /**
   * `shrink` (default): step the font down to `minScale` while the text box overflows, then
   * ellipsize, with the full text as the tooltip. `none`: no fitting (overflowing text spills, as
   * in piStar). `grow`: make the element taller to fit, only when it is created or its name edited.
   */
  readonly mode?: 'shrink' | 'none' | 'grow';
  /** Smallest font scale for `shrink`. Default 0.7. */
  readonly minScale?: number;
  /** Scale decrement per step. Default 0.1. */
  readonly step?: number;
}

/** The whole element box: today's layout, as piStar wraps names at the element's full width. */
export const FULL_TEXT_BOX: TextBox = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Insets that keep labels inside each piStar shape, for kinds that want the text box tighter
 * than piStar's full-width layout (`textBox: TEXT_BOXES.task`). Not the defaults: insetting the
 * box changes where names wrap, and existing models would be laid out differently.
 */
export const TEXT_BOXES: Readonly<
  Record<'goal' | 'task' | 'resource' | 'quality' | 'actor', TextBox>
> = {
  // Rounded ends of the goal's capsule.
  goal: { top: 0.06, right: 0.1, bottom: 0.06, left: 0.1 },
  // The hexagon's pointed ends take 15/130 of its width on each side.
  task: { top: 0.06, right: 0.12, bottom: 0.06, left: 0.12 },
  resource: { top: 0.06, right: 0.05, bottom: 0.06, left: 0.05 },
  // The cloud's lobes.
  quality: { top: 0.15, right: 0.1, bottom: 0.12, left: 0.1 },
  // The square inscribed in the actor's circle: (1 - 1/√2) / 2 on each side.
  actor: { top: 0.146, right: 0.146, bottom: 0.146, left: 0.146 },
};

interface FitResult {
  readonly scale: number;
  /** Still overflowing at the smallest scale (the text is then ellipsized). */
  readonly overflowing: boolean;
  /** When overflowing: how many of the name's lines fit under the header. */
  readonly lines?: number;
}

function overflows(box: HTMLElement, content: HTMLElement): boolean {
  return (
    content.scrollHeight > box.clientHeight + 0.5 || content.scrollWidth > box.clientWidth + 0.5
  );
}

function fitNow(box: HTMLElement, content: HTMLElement, minScale: number, step: number): FitResult {
  // Always refit from full size, so a box that grew lets the text grow back.
  let scale = 1;
  content.style.fontSize = '1em';
  while (overflows(box, content) && scale - step >= minScale - 1e-9) {
    scale = Math.round((scale - step) * 1000) / 1000;
    content.style.fontSize = `${scale}em`;
  }
  if (!overflows(box, content)) return { scale, overflowing: false };
  // Ellipsize: keep as many of the name's lines as fit below the header.
  const name = content.lastElementChild as HTMLElement | null;
  const nameHeight = name?.scrollHeight ?? 0;
  const headerHeight = content.scrollHeight - nameHeight;
  const lineHeight =
    (name && Number.parseFloat(getComputedStyle(name).lineHeight)) ||
    (name && Number.parseFloat(getComputedStyle(name).fontSize)) ||
    12 * scale;
  const lines = Math.max(1, Math.floor((box.clientHeight - headerHeight) / lineHeight));
  return { scale, overflowing: true, lines };
}

const NO_FIT: FitResult = { scale: 1, overflowing: false };

function sameFit(a: FitResult, b: FitResult): boolean {
  return a.scale === b.scale && a.overflowing === b.overflowing && a.lines === b.lines;
}

function useFit(
  ref: RefObject<HTMLElement | null>,
  options: { minScale?: number; step?: number; enabled?: boolean; refitKey?: string } = {},
): FitResult {
  const { minScale = 0.7, step = 0.1, enabled = true, refitKey = '' } = options;
  const [result, setResult] = useState<FitResult>(NO_FIT);
  useLayoutEffect(() => {
    const box = ref.current;
    const content = box?.firstElementChild as HTMLElement | null | undefined;
    if (!box || !content || !enabled) return;
    const run = (): void => {
      const next = fitNow(box, content, minScale, Math.max(step, 0.01));
      setResult((r) => (sameFit(r, next) ? r : next));
    };
    run();
    // Refit whenever the box resizes: first sizing, manual resize, zoom-independent layout.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(run);
    observer.observe(box);
    return () => observer.disconnect();
    // `refitKey` changes with the text, which the box doesn't see as a resize: refit then too.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- see above
  }, [ref, minScale, step, enabled, refitKey]);
  // Disabled (editing, `none`, `grow`): no fitting, derived rather than stored.
  return enabled ? result : NO_FIT;
}

/**
 * Fits the first child of `ref` (the text) inside `ref` (its box): steps the font scale down
 * from 1 to `minScale` while it overflows, refitting from full size whenever the box resizes.
 * Returns the scale applied (also set as the child's `font-size` in em).
 */
export function useFitText(
  ref: RefObject<HTMLElement | null>,
  options?: { minScale?: number; step?: number },
): number {
  return useFit(ref, options ?? {}).scale;
}

/** The default header styling: small italic lines above a name. For hosts' own components too. */
export function LabelHeader({ lines }: { lines: readonly string[] }): ReactElement {
  return (
    <div className="istar-label-header">
      {lines.map((line, i) => (
        <div key={i} className="istar-label-header-line" title={line}>
          {line}
        </div>
      ))}
    </div>
  );
}

export interface FittedLabelProps {
  readonly name: string;
  readonly header: readonly string[];
  readonly textBox: TextBox;
  readonly fit: LabelFit;
  readonly editing: boolean;
  onCommit(name: string): void;
  onDone(): void;
  /** `grow` mode: called with the element height the label needs, when it exceeds the current. */
  onGrow?(height: number): void;
  /** The element's current height in px (for `grow`). */
  readonly height: number;
  /** Classes for the header's first line (e.g. the default «stereotype»). */
  readonly firstHeaderClass?: string;
}

/** A name with header lines, laid out in a text box and fitted. Used by the default components. */
export function FittedLabel(props: FittedLabelProps): ReactElement {
  const { name, header, textBox, fit, editing } = props;
  const mode = fit.mode ?? 'shrink';
  const boxRef = useRef<HTMLDivElement>(null);
  const showHeader = !editing && header.length > 0;
  const result = useFit(boxRef, {
    ...(fit.minScale !== undefined ? { minScale: fit.minScale } : {}),
    ...(fit.step !== undefined ? { step: fit.step } : {}),
    enabled: mode === 'shrink' && !editing,
    refitKey: `${name}\n${header.join('\n')}`,
  });

  // `grow`: once an edit ends (which includes naming a new element), make the element tall
  // enough for its label. Never on load, so opening a file doesn't change its layout.
  const { onGrow, height } = props;
  const wasEditing = useRef(editing);
  useLayoutEffect(() => {
    const ended = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (!ended || mode !== 'grow' || !onGrow) return;
    const box = boxRef.current;
    const content = box?.firstElementChild as HTMLElement | null | undefined;
    if (!box || !content) return;
    const free = 1 - textBox.top - textBox.bottom;
    if (free <= 0) return;
    const needed = Math.ceil(content.scrollHeight / free);
    if (needed > height) onGrow(needed);
  }, [editing, mode, onGrow, height, textBox.top, textBox.bottom]);

  const clipped = mode === 'shrink' && !editing && result.overflowing;
  const fullText = [...(showHeader ? header : []), name].join('\n');
  return (
    <div
      ref={boxRef}
      className="istar-label-box"
      style={{
        top: `${textBox.top * 100}%`,
        right: `${textBox.right * 100}%`,
        bottom: `${textBox.bottom * 100}%`,
        left: `${textBox.left * 100}%`,
      }}
    >
      <div
        className={`istar-label-content${clipped ? ' is-clipped' : ''}${editing ? ' is-editing' : ''}`}
        {...(clipped ? { title: fullText } : {})}
        // Fitting measures by setting the font size directly; React renders the result, and drops it
        // when fitting is off.
        style={
          {
            ...(mode === 'shrink' && !editing ? { fontSize: `${result.scale}em` } : {}),
            ...(clipped && result.lines ? { '--istar-label-lines': result.lines } : {}),
          } as CSSProperties
        }
      >
        {showHeader && (
          <div className="istar-label-header">
            {header.map((line, i) => (
              <div
                key={i}
                className={`istar-label-header-line${i === 0 && props.firstHeaderClass ? ` ${props.firstHeaderClass}` : ''}`}
              >
                {line}
              </div>
            ))}
          </div>
        )}
        <EditableLabel
          value={name}
          editing={editing}
          onCommit={props.onCommit}
          onDone={props.onDone}
        />
      </div>
    </div>
  );
}
