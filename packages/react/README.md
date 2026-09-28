# @istar-ts/react

React components for editing [iStar 2.0](https://istarwiki.org/) goal models: a React Flow–based
canvas, palette, inspector, and a **registry** that lets you override how each element kind renders,
its default properties, inspector form, and palette entry. Pair with
[`@istar-ts/core`](https://github.com/vieirin/istar-ts/tree/main/packages/core) for load/save,
constraints, and typed `customProperties`.

```sh
pnpm add @istar-ts/react @istar-ts/core react react-dom
```

Import the single stylesheet once (it includes React Flow’s base styles; rules are scoped under
`.istar-*` classes):

```tsx
import '@istar-ts/react/styles.css';
```

**Peer dependencies:** `react` and `react-dom` ^18.2.0 or ^19.0.0.

## Quick start

Give the canvas an explicit height (it fills its container). Use a store for undo/redo, or controlled
`model` / `onChange`.

```tsx
import '@istar-ts/react/styles.css';
import { parsePistar } from '@istar-ts/core';
import { IstarCanvas, IstarInspector, useIstarStore } from '@istar-ts/react';

const text = await fetch('/model.pistar').then((r) => r.text());

export function Editor() {
  const { store } = useIstarStore(() => parsePistar(text));
  return (
    <div style={{ height: '100vh' }}>
      <IstarCanvas store={store} aside={<IstarInspector />} />
    </div>
  );
}
```

Controlled mode (no separate store in your app state):

```tsx
import { useState } from 'react';
import type { IstarModel } from '@istar-ts/core';
import { createEmptyModel } from '@istar-ts/core';
import { IstarCanvas } from '@istar-ts/react';

export function Controlled() {
  const [model, setModel] = useState<IstarModel>(() => createEmptyModel());
  return (
    <div style={{ height: 600 }}>
      <IstarCanvas model={model} onChange={setModel} />
    </div>
  );
}
```

`<IstarCanvas>` props include `registry`, `readOnly`, `palette` (`'left'` by default, `'top'` or `'bottom'` for a piStar-style bar, or `false`), `aside`, `extensions`,
`controls` (zoom buttons), `background` (dotted grid, off by default: piStar's paper is plain) and
`fitView` (on by default; waits until the container has a usable size, so a canvas mounted in a
panel that is still opening is fitted once it has room).

### Controlling the viewport

The canvas owns its React Flow instance, so `useReactFlow()` isn't available to your app. Pass a
`ref` instead to fit, zoom, or reveal elements, e.g. after resizing the container or when an element
is selected elsewhere. Each method resolves to `true` once the viewport has moved (after any
animation), or `false` if it couldn't (for example, an unknown element id).

```tsx
import { useRef } from 'react';
import type { IstarCanvasHandle } from '@istar-ts/react';

const canvas = useRef<IstarCanvasHandle>(null);

<IstarCanvas ref={canvas} store={store} />;

canvas.current?.fitView({ padding: 0.1, duration: 200 }); // or { nodes: [elementId] }
canvas.current?.centerOn(elementId, { zoom: 1.5, duration: 200 }); // keeps the zoom if omitted
canvas.current?.zoomIn();
canvas.current?.zoomOut();
```

## Editing behaviour

- **Palette:** pick an element or link tool, then click again to cancel. **Actors, agents, and roles**
  are placed by clicking empty diagram space. **Goals, tasks, resources, and qualities** are placed by
  clicking inside an actor, role, or agent.
- **Links and dependencies:** with a link tool active, drag from one node to another. Contribution tools
  preset the contribution value; dependency tools create a dependum of the chosen node kind between
  depender and dependee.
- **Constraints:** invalid connections are blocked. While dragging, a live tooltip shows
  `canLink`’s reason; failed connects also show an error notice at the bottom of the canvas.
- **Delete:** `Backspace` or `Delete` removes the selection (elements cascade; one dependency half
  removes the whole dependency).
- **Undo / redo:** `Ctrl+Z` / `Cmd+Z` and `Ctrl+Shift+Z` / `Cmd+Shift+Z` (also `Ctrl+Y` / `Cmd+Y`
  for redo) when the diagram has focus; palette Undo/Redo buttons mirror the store.
- **Rename:** double-click an element (or an actor) to edit its name inline; new elements start in
  edit mode. Enter commits, Shift+Enter adds a line break, Escape cancels.
- **Resize:** select an intentional element and drag its handles; the size is saved in `display`.
- **Links:** click to select (the inspector shows them), Delete to remove. Links with vertices are
  drawn as smooth curves, like piStar's.
- **Actors:** **Alt+click** an actor to collapse or expand it, as in piStar. Collapsed actors
  hide inner elements; dependency links re-anchor on the actor; other links involving hidden nodes are
  hidden until expand.

Press **Escape** to clear the active palette tool.

## Extensions and the element registry

Out of the box the editor is a plain piStar: `defaultRegistry` knows the iStar 2.0 elements and
links and nothing else. To adapt it to another modeller (one that annotates tasks with costs,
treats resources as variables, adds its own inspectors, …) write an **extension** and pass it
to the canvas. The libraries never hardcode any modeller's properties.

```tsx
<IstarCanvas store={store} extensions={[myExtension]} />
```

An `IstarExtension` is a name plus per-kind overrides; several extensions apply in order
(`applyExtensions(base, extensions)` does the same outside React). For each **element** kind:

| Field               | Role                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `component`         | React node view (`ElementComponentProps`)                        |
| `defaultProperties` | `customProperties` preset, or `({ model }) => …` when creating   |
| `inspector`         | Side-panel form, or `false` to hide                              |
| `palette`           | Toolbar entry (`Partial<PaletteEntry>`), or `false` to hide      |
| `properties`        | `PropertySchema` from `@istar-ts/core` — typed fields + defaults |
| `size`              | Default width/height (actors: initial boundary)                  |

For each **link** kind: `palette` (array of tool entries or `false`), `inspector`, `properties`.
`paletteGroups` relabels the palette's dropdown groups.

Example: an extension that gives tasks a cost and a priority, shows the cost on the node, and
hides Role from the palette.

```tsx
import {
  DefaultElementComponent,
  IstarCanvas,
  type ElementComponentProps,
  type IstarExtension,
} from '@istar-ts/react';
import { defineProperties, prop } from '@istar-ts/core';
import type { ReactElement } from 'react';

const taskProperties = defineProperties('istar.Task', {
  cost: prop.number({ min: 0, default: 0, label: 'Cost' }),
  priority: prop.enum(['low', 'medium', 'high'] as const, { optional: true, label: 'Priority' }),
});

function CostTask(props: ElementComponentProps): ReactElement {
  const { values } = taskProperties.read(props.element);
  return (
    <div style={{ position: 'relative' }}>
      <DefaultElementComponent {...props} />
      <span style={{ position: 'absolute', right: 4, bottom: -8, fontSize: 10 }}>
        {`cost ${values.cost ?? 0}`}
      </span>
    </div>
  );
}

export const costs: IstarExtension = {
  name: 'costs',
  elements: {
    // The default inspector renders typed fields from `properties`, so no custom form is needed.
    'istar.Task': { properties: taskProperties, component: CostTask },
    'istar.Role': { palette: false },
  },
};

// <IstarCanvas store={store} extensions={[costs]} />
```

For a fully custom form set `inspector`, built from `InspectorField`, `PropertyField`,
`CommitText`, `CustomPropertiesEditor` and `useTypedProperties`. The playground
(`examples/playground/src/extensions/`) has a complete extension with its own inspector.

`createRegistry(overrides, base?)` builds a standalone registry from the same overrides, for the
`registry` prop. `defaultPropertiesFor(registry, kind, model)` merges schema defaults with
`defaultProperties` (preset wins on key clashes).

### Palette

Palette entries carry an `icon` (the default registry draws piStar-like previews, exported as
`elementIcon`, `linkIcon` and `dependencyIcon`), an `order`, a `section` (sections are separated by
a divider) and an optional `group`: entries sharing a group collapse into one button with a ▾ menu,
as piStar does for Actor, Actor links, Dependency and Contribution. While a tool is active a
status hint (the entry's `title`) says what to do next.

`<IstarPalette orientation="vertical" | "horizontal" flyout="right" | "below" | "above" showLabels history />` can also be placed
yourself inside an `<IstarProvider>` (use `<IstarCanvas palette={false}>` then).

Reusable pieces: `DefaultElementComponent`, `DefaultActorComponent`, `EditableLabel`, and shape
primitives (`GoalShape`, `ResourceShape`, `TaskShape`, `QualityShape`, `ActorSymbol`). Export helpers:
`defaultRegistry`, `elementSize`, `modelToFlow`, `actorBoundary`.

Default inspectors (`DefaultElementInspector`, `DefaultLinkInspector`) use `PropertyField` and
`CustomPropertiesEditor` when you omit a custom `inspector`.

## Composition

Split the UI with one shared editor context:

```tsx
import {
  IstarCanvas,
  IstarInspector,
  IstarPalette,
  IstarProvider,
  useIstarStore,
} from '@istar-ts/react';

function Layout() {
  const { store } = useIstarStore();
  return (
    <IstarProvider store={store}>
      <header>
        <IstarPalette />
      </header>
      <main style={{ display: 'flex', height: 'calc(100vh - 48px)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <IstarCanvas palette={false} />
        </div>
        <IstarInspector />
      </main>
    </IstarProvider>
  );
}
```

`useIstarEditor()` exposes `store`, `model`, `registry`, `readOnly`, `tool` / `setTool`, `selection` /
`select`, `editingId`, `notify` / `notice`, `checkConnection`, and `elementActions` / `linkActions`.
`useSelectedTarget()` returns the selected element or link. `useStoreModel(store)` subscribes to any
`ModelStore`.

`<IstarCanvas>` wraps itself in `IstarProvider` when none exists; with an outer provider, pass
`store` or `model` / `onChange` on the provider instead.

## Theming

Override CSS custom properties on `.istar-canvas` or any ancestor of the editor:

| Variable                   | Default                 | Used for                |
| -------------------------- | ----------------------- | ----------------------- |
| `--istar-font-family`      | Arial, Helvetica…       | UI type                 |
| `--istar-font-size`        | `12px`                  | Base size               |
| `--istar-text`             | `#000`                  | Text                    |
| `--istar-stroke`           | `#000`                  | Shapes and links        |
| `--istar-stroke-width`     | `2px`                   | Node outlines           |
| `--istar-link-width`       | `1px`                   | Link lines              |
| `--istar-node-fill`        | `rgb(205, 254, 205)`    | Inner elements          |
| `--istar-actor-fill`       | `rgb(242, 242, 242)`    | Actor boundary          |
| `--istar-selection`        | `#2f6fe4`               | Selection, focus        |
| `--istar-canvas-bg`        | `#fff`                  | Diagram background      |
| `--istar-panel-bg`         | `#fafafa`               | Palette and inspector   |
| `--istar-panel-border`     | `#d9d9d9`               | Panel borders           |
| `--istar-button-bg`        | `#fff`                  | Buttons                 |
| `--istar-button-active-bg` | `#dfe9fc`               | Active palette tool     |
| `--istar-button-hover-bg`  | `rgba(0, 0, 0, 0.06)`   | Hovered palette tool    |
| `--istar-palette-bg`       | `var(--istar-panel-bg)` | Palette background      |
| `--istar-palette-divider`  | `#dcdcdc`               | Palette section divider |
| `--istar-error-bg`         | `#fdecea`               | Errors, connection hint |
| `--istar-error-text`       | `#8a1c1c`               | Error text              |
| `--istar-info-bg`          | `#eef4fd`               | Info notices            |
| `--istar-info-text`        | `#1d3f7a`               | Info text               |

```css
.my-app .istar-canvas {
  --istar-node-fill: #e8f4ff;
  --istar-selection: #0d9488;
  --istar-canvas-bg: #f8fafc;
}
```

## Credits

Element shapes and editing behaviour are derived from
[piStar](https://github.com/jhcp/piStar) by João Pimentel and contributors, released under the MIT
License. The canvas uses [React Flow](https://reactflow.dev/) (`@xyflow/react`, MIT).
