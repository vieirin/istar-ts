import type { ElementKind, LinkKind } from '@istar-ts/core';
import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import type { Tool } from './context';
import { useIstarEditor } from './context';
import type { PaletteEntry } from './registry';

interface Item {
  readonly key: string;
  readonly entry: PaletteEntry;
  readonly tool: Tool;
}

function sameTool(a: Tool | null, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The add-element / add-link toolbar. Entries come from the registry's `palette` settings;
 * a kind with `palette: false` is not shown.
 */
export function IstarPalette({ className }: { className?: string }): ReactElement {
  const editor = useIstarEditor();
  const { registry, tool, setTool, store } = editor;
  // Re-render when history changes so undo/redo enablement is current.
  useSyncExternalStore(store.subscribe, store.getModel, store.getModel);

  const elements: Item[] = [];
  for (const config of Object.values(registry.elements)) {
    if (config.palette === false) continue;
    elements.push({
      key: config.kind,
      entry: config.palette,
      tool: { type: 'element', kind: config.kind as ElementKind },
    });
  }
  const links: Item[] = [];
  for (const config of Object.values(registry.links)) {
    if (config.palette === false) continue;
    for (const entry of config.palette) {
      const kind = config.kind as LinkKind;
      const itemTool: Tool =
        kind === 'istar.DependencyLink'
          ? { type: 'dependency', dependum: entry.dependum ?? 'istar.Goal' }
          : { type: 'link', kind, ...(entry.value ? { value: entry.value } : {}) };
      links.push({ key: `${kind}:${entry.value ?? entry.dependum ?? ''}`, entry, tool: itemTool });
    }
  }
  const byOrder = (a: Item, b: Item): number => (a.entry.order ?? 0) - (b.entry.order ?? 0);

  const renderGroup = (items: Item[], label: string): ReactElement => (
    <div className="istar-palette-group" role="group" aria-label={label}>
      {items.toSorted(byOrder).map((item) => {
        const active = sameTool(tool, item.tool);
        return (
          <button
            key={item.key}
            type="button"
            className={`istar-palette-button${active ? ' is-active' : ''}`}
            title={item.entry.title}
            aria-pressed={active}
            onClick={() => setTool(active ? null : item.tool)}
          >
            {item.entry.icon}
            <span>{item.entry.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={`istar-palette${className ? ` ${className}` : ''}`} role="toolbar">
      {renderGroup(elements, 'Add element')}
      {renderGroup(links, 'Add link')}
      <div className="istar-palette-group" role="group" aria-label="History">
        <button
          type="button"
          className="istar-palette-button"
          disabled={!store.canUndo()}
          onClick={() => store.undo()}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          className="istar-palette-button"
          disabled={!store.canRedo()}
          onClick={() => store.redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
      </div>
    </div>
  );
}
