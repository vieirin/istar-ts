import type { AnyMetamodel, LinkKind, NodeKind } from '@istar-ts/core';
import { ISTAR_2_0 } from '@istar-ts/core';
import { resolveLinkStyle } from './edges';
import { dependencyIcon, elementIcon, linkIcon } from './palette-icons';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Tool } from './context';
import { useIstarEditor } from './context';
import type { AnyIstarRegistry, ElementToolEntry, IstarRegistry, PaletteEntry } from './registry';

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
export function paletteEntryFor(
  registry: IstarRegistry,
  tool: Tool,
  metamodel: AnyMetamodel = ISTAR_2_0,
): PaletteEntry | undefined {
  for (const slots of paletteSections(registry, metamodel)) {
    for (const slot of slots) {
      const items = slot.type === 'item' ? [slot.item] : slot.items;
      const match = items.find((i) => sameTool(i.tool, tool));
      if (match) return match.entry;
    }
  }
  return undefined;
}

/**
 * Registry palette entries, ordered, split into sections, with groups collapsed. `metamodel`
 * (default iStar 2.0) tells dependency kinds apart and draws icons for extended kinds whose
 * entries have none.
 */
export function paletteSections(
  registry: IstarRegistry,
  metamodel: AnyMetamodel = ISTAR_2_0,
): Slot[][] {
  const items: Item[] = [];
  const any = registry as unknown as AnyIstarRegistry;
  const elementIconFor = (kind: string): ReactNode => {
    const shape = any.elements[kind]?.shape;
    return elementIcon(kind, {
      ...(shape ? { shape } : {}),
      actor: metamodel.elements.get(kind)?.category === 'actor',
    });
  };
  for (const config of Object.values(registry.elements)) {
    if (config.palette === false) continue;
    const defaultIcon = (): ReactNode => elementIconFor(config.kind);
    if (Array.isArray(config.palette)) {
      (config.palette as readonly ElementToolEntry[]).forEach(({ properties, ...entry }, i) => {
        items.push({
          key: `${config.kind}:${i}`,
          entry: entry.icon === undefined ? { ...entry, icon: defaultIcon() } : entry,
          tool: { type: 'element', kind: config.kind, ...(properties && { properties }) },
        });
      });
      continue;
    }
    const entry = config.palette as PaletteEntry;
    items.push({
      key: config.kind,
      entry: entry.icon === undefined ? { ...entry, icon: defaultIcon() } : entry,
      tool: { type: 'element', kind: config.kind },
    });
  }
  for (const config of Object.values(registry.links)) {
    if (config.palette === false) continue;
    const kind = config.kind as LinkKind;
    const dependency = metamodel.links.get(kind)?.category === 'dependency';
    for (const raw of config.palette) {
      let entry: PaletteEntry & { readonly value?: string; readonly dependum?: string } = raw;
      if (entry.icon === undefined) {
        const style = resolveLinkStyle(metamodel, registry, kind);
        entry = {
          ...entry,
          icon: dependency
            ? (() => {
                const shape = any.elements[entry.dependum ?? '']?.shape;
                return dependencyIcon(entry.dependum ?? 'istar.Goal', shape ? { shape } : {});
              })()
            : linkIcon(kind, entry.value, {
                ...(style.dash ? { dash: style.dash } : {}),
                marker: style.marker ?? null,
              }),
        };
      }
      const tool: Tool = dependency
        ? {
            type: 'dependency',
            dependum: (entry.dependum ?? 'istar.Goal') as NodeKind,
            // The default kind stays implicit, so tools compare equal to those created before.
            ...(kind !== 'istar.DependencyLink' && { linkKind: kind }),
          }
        : {
            type: 'link',
            kind: kind as Exclude<LinkKind, 'istar.DependencyLink'>,
            ...(entry.value ? { value: entry.value } : {}),
          };
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

/** One toolbar control, as data, for rendering a custom palette (see `usePaletteControls`). */
export interface PaletteControl {
  readonly key: string;
  readonly label: string;
  readonly title?: string;
  readonly icon?: ReactNode;
  /** Registry section and group, for laying controls out like the built-in palette. */
  readonly section?: string;
  readonly group?: string;
  /** The tool this control activates. */
  readonly tool: Tool;
  /** Whether this control's tool is the active one. */
  readonly active: boolean;
  /** Activates the tool, or clears it if it is already active (like the built-in palette). */
  select(): void;
}

export interface PaletteControls {
  /** Every toolbar entry of the registry, in order (groups flattened). */
  readonly controls: readonly PaletteControl[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;
  /** The active tool, if any, and a way to clear it (the built-in palette's Escape). */
  readonly tool: Tool | null;
  clearTool(): void;
  readonly readOnly: boolean;
}

/**
 * The palette's controls as data, so an app can render its own tool bar (e.g. a side panel of
 * big buttons) while the editor keeps doing the work. Use inside an `IstarProvider` or as a
 * canvas `aside`, and pass `palette={false}` to the canvas to hide the built-in one. Controls
 * come from the registry (including element kinds with several entries); for anything else,
 * call `useIstarEditor().setTool(...)` yourself, e.g. an element tool with preset `properties`.
 */
export function usePaletteControls(): PaletteControls {
  const { registry, metamodel, tool, setTool, store, readOnly } = useIstarEditor();
  // Re-render when history changes so undo/redo enablement is current.
  useSyncExternalStore(store.subscribe, store.getModel, store.getModel);
  const controls: PaletteControl[] = [];
  for (const slots of paletteSections(registry, metamodel)) {
    for (const slot of slots) {
      for (const item of slot.type === 'item' ? [slot.item] : slot.items) {
        const active = sameTool(tool, item.tool);
        controls.push({
          key: item.key,
          label: item.entry.label,
          ...(item.entry.title !== undefined && { title: item.entry.title }),
          ...(item.entry.icon !== undefined && { icon: item.entry.icon }),
          ...(item.entry.section !== undefined && { section: item.entry.section }),
          ...(item.entry.group !== undefined && { group: item.entry.group }),
          tool: item.tool,
          active,
          select: () => setTool(active ? null : item.tool),
        });
      }
    }
  }
  return {
    controls,
    canUndo: !readOnly && store.canUndo(),
    canRedo: !readOnly && store.canRedo(),
    undo: () => store.undo(),
    redo: () => store.redo(),
    tool,
    clearTool: () => setTool(null),
    readOnly,
  };
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

  const sections = paletteSections(registry, editor.metamodel);
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
