import type { LinkKind } from '@istar-ts/core';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Tool } from './context';
import { useIstarEditor } from './context';
import type { IstarRegistry, PaletteEntry } from './registry';

export type PaletteOrientation = 'vertical' | 'horizontal';

export interface IstarPaletteProps {
  readonly className?: string;
  /**
   * `vertical` (default): a column docked on the left, like an image editor's tool bar.
   * `horizontal`: a piStar-style bar with icons and labels.
   */
  readonly orientation?: PaletteOrientation;
  /** Show text labels under icons, like piStar. Default true. */
  readonly showLabels?: boolean;
  /** Show undo/redo buttons. Default true. */
  readonly history?: boolean;
  /**
   * Where group menus open: `right` of a vertical bar, `below` a horizontal one by default.
   * Use `above` for a bar docked at the bottom.
   */
  readonly flyout?: 'below' | 'above' | 'right';
}

interface Item {
  readonly key: string;
  readonly entry: PaletteEntry;
  readonly tool: Tool;
}

type Slot = { type: 'item'; item: Item } | { type: 'group'; id: string; items: Item[] };

function sameTool(a: Tool | null, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The palette entry that produces `tool`, if any (used for the status hint). */
export function paletteEntryFor(registry: IstarRegistry, tool: Tool): PaletteEntry | undefined {
  for (const slots of paletteSections(registry)) {
    for (const slot of slots) {
      const items = slot.type === 'item' ? [slot.item] : slot.items;
      const match = items.find((i) => sameTool(i.tool, tool));
      if (match) return match.entry;
    }
  }
  return undefined;
}

/** Registry palette entries, ordered, split into sections, with groups collapsed. */
export function paletteSections(registry: IstarRegistry): Slot[][] {
  const items: Item[] = [];
  for (const config of Object.values(registry.elements)) {
    if (config.palette === false) continue;
    items.push({
      key: config.kind,
      entry: config.palette,
      tool: { type: 'element', kind: config.kind },
    });
  }
  for (const config of Object.values(registry.links)) {
    if (config.palette === false) continue;
    const kind = config.kind as LinkKind;
    for (const entry of config.palette) {
      const tool: Tool =
        kind === 'istar.DependencyLink'
          ? { type: 'dependency', dependum: entry.dependum ?? 'istar.Goal' }
          : { type: 'link', kind, ...(entry.value ? { value: entry.value } : {}) };
      items.push({ key: `${kind}:${entry.value ?? entry.dependum ?? ''}`, entry, tool });
    }
  }
  items.sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0));

  const sections = new Map<string, Slot[]>();
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const sectionId = item.entry.section ?? '';
    let section = sections.get(sectionId);
    if (!section) sections.set(sectionId, (section = []));
    const groupId = item.entry.group;
    if (groupId === undefined) {
      section.push({ type: 'item', item });
    } else if (groups.has(groupId)) {
      groups.get(groupId)!.push(item);
    } else {
      const members = [item];
      groups.set(groupId, members);
      section.push({ type: 'group', id: groupId, items: members });
    }
  }
  return [...sections.values()];
}

/**
 * The add-element / add-link toolbar, modelled on piStar's: each entry shows a small preview,
 * and related entries (Actor/Agent/Role, actor links, dependencies, contributions) share a
 * dropdown. Entries come from the registry's `palette` settings.
 */
export function IstarPalette({
  className,
  orientation = 'vertical',
  showLabels = true,
  history = true,
  flyout = orientation === 'vertical' ? 'right' : 'below',
}: IstarPaletteProps): ReactElement {
  const editor = useIstarEditor();
  const { registry, tool, setTool, store } = editor;
  // Re-render when history changes so undo/redo enablement is current.
  useSyncExternalStore(store.subscribe, store.getModel, store.getModel);
  const [menu, setMenu] = useState<{
    id: string;
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const openGroup = menu?.id ?? null;
  const [lastInGroup, setLastInGroup] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  // Close an open group menu on outside click or Escape.
  useEffect(() => {
    if (!openGroup) return;
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    const close = (): void => setMenu(null);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [openGroup]);

  const choose = (item: Item, groupId?: string): void => {
    const active = sameTool(tool, item.tool);
    setTool(active ? null : item.tool);
    if (groupId) setLastInGroup((last) => ({ ...last, [groupId]: item.key }));
    setMenu(null);
  };

  const label = (text: string): ReactNode =>
    showLabels ? (
      <span className="istar-palette-label">{text}</span>
    ) : (
      <span className="istar-visually-hidden">{text}</span>
    );

  const renderItem = (item: Item): ReactElement => {
    const active = sameTool(tool, item.tool);
    return (
      <button
        key={item.key}
        type="button"
        className={`istar-palette-button${active ? ' is-active' : ''}`}
        title={item.entry.title ?? item.entry.label}
        aria-pressed={active}
        onClick={() => choose(item)}
      >
        {item.entry.icon}
        {label(item.entry.label)}
      </button>
    );
  };

  const renderGroup = (id: string, items: Item[]): ReactElement => {
    const group = registry.paletteGroups[id];
    const activeItem = items.find((i) => sameTool(tool, i.tool));
    const shown = activeItem ?? items.find((i) => i.key === lastInGroup[id]) ?? items[0]!;
    const open = openGroup === id;
    const groupLabel = group?.label ?? shown.entry.label;
    return (
      <div key={id} className={`istar-palette-group-button${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className={`istar-palette-button${activeItem ? ' is-active' : ''}`}
          title={`${shown.entry.title ?? shown.entry.label}`}
          aria-pressed={activeItem !== undefined}
          aria-label={shown.entry.label}
          onClick={() => choose(shown, id)}
        >
          {shown.entry.icon}
          {label(groupLabel)}
        </button>
        <button
          type="button"
          className="istar-palette-caret"
          aria-label={`More: ${group?.label ?? id}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={group?.title}
          onClick={(e) => {
            if (open) return setMenu(null);
            // Fixed positioning keeps the flyout above the canvas and out of any clipping
            // (the vertical bar scrolls).
            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
            setMenu(
              flyout === 'right'
                ? { id, top: rect.top, left: rect.right + 8 }
                : flyout === 'above'
                  ? { id, bottom: window.innerHeight - rect.top + 4, left: rect.left }
                  : { id, top: rect.bottom + 4, left: rect.left },
            );
          }}
        >
          ▾
        </button>
        {open && (
          <div
            className="istar-palette-menu"
            role="menu"
            aria-label={group?.label ?? id}
            style={{ top: menu?.top, bottom: menu?.bottom, left: menu?.left }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={sameTool(tool, item.tool)}
                className="istar-palette-menu-item"
                title={item.entry.title}
                onClick={() => choose(item, id)}
              >
                {item.entry.icon}
                <span>{item.entry.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const sections = paletteSections(registry);
  return (
    <div
      ref={rootRef}
      className={`istar-palette is-${orientation} flyout-${flyout}${showLabels ? ' has-labels' : ''}${
        className ? ` ${className}` : ''
      }`}
      role="toolbar"
      aria-orientation={orientation}
      aria-label="Add to diagram"
    >
      {sections.map((slots, i) => (
        <div className="istar-palette-section" key={i}>
          {slots.map((slot) =>
            slot.type === 'item' ? renderItem(slot.item) : renderGroup(slot.id, slot.items),
          )}
        </div>
      ))}
      {history && (
        <div className="istar-palette-section istar-palette-history">
          <button
            type="button"
            className="istar-palette-button"
            disabled={!store.canUndo()}
            onClick={() => store.undo()}
            title="Undo (Ctrl+Z)"
          >
            <span aria-hidden className="istar-palette-glyph">
              ↶
            </span>
            {label('Undo')}
          </button>
          <button
            type="button"
            className="istar-palette-button"
            disabled={!store.canRedo()}
            onClick={() => store.redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            <span aria-hidden className="istar-palette-glyph">
              ↷
            </span>
            {label('Redo')}
          </button>
        </div>
      )}
    </div>
  );
}
