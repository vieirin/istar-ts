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

`<IstarCanvas>` props include `registry`, `readOnly`, `palette` (default `true`), `aside`, `controls`,
and `fitView`.

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
- **Actors:** use the **−** / **+** control on the actor symbol to collapse or expand. Collapsed actors
  hide inner elements; dependency links re-anchor on the actor; other links involving hidden nodes are
  hidden until expand.

Press **Escape** to clear the active palette tool.

## Element registry

`createRegistry(overrides, base?)` starts from `defaultRegistry` (piStar-like defaults) and merges
per-kind overrides. For each **element** kind you can set:

| Field               | Role                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `component`         | React node view (`ElementComponentProps`)                        |
| `defaultProperties` | `customProperties` preset, or `({ model }) => …` when creating   |
| `inspector`         | Side-panel form, or `false` to hide                              |
| `palette`           | Toolbar entry (`Partial<PaletteEntry>`), or `false` to hide      |
| `properties`        | `PropertySchema` from `@istar-ts/core` — typed fields + defaults |
| `size`              | Default width/height (actors: initial boundary)                  |

For each **link** kind: `palette` (array of tool entries or `false`), `inspector`, `properties`.

`defaultPropertiesFor(registry, kind, model)` merges schema defaults with `defaultProperties`
(preset wins on key clashes).

Example: typed Resource properties, custom canvas rendering, and a tailored inspector:

```tsx
import {
  CommitText,
  createRegistry,
  DefaultElementComponent,
  IstarCanvas,
  InspectorField,
  PropertyField,
  useTypedProperties,
  type ElementComponentProps,
  type InspectorProps,
} from '@istar-ts/react';
import { defineProperties, prop, type IstarElement } from '@istar-ts/core';
import type { ReactElement } from 'react';

const resourceSchema = defineProperties('istar.Resource', {
  type: prop.enum(['bool', 'int'] as const),
  initialValue: prop.string(),
});

function ResourceNode(props: ElementComponentProps): ReactElement {
  const badge = props.element.customProperties?.type ?? '?';
  return (
    <div className="istar-element-body" style={{ width: props.width, height: props.height }}>
      <DefaultElementComponent {...props} />
      <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 10 }}>{badge}</span>
    </div>
  );
}

function ResourceInspector({
  target,
  actions,
  readOnly,
  schema,
}: InspectorProps<IstarElement>): ReactElement {
  const typed = useTypedProperties(schema, target, actions);
  const nameId = 'resource-name';
  return (
    <div className="istar-inspector-body">
      <InspectorField label="Name" htmlFor={nameId}>
        <CommitText id={nameId} value={target.name} readOnly={readOnly} onCommit={actions.rename} />
      </InspectorField>
      <PropertyField
        name="type"
        type={resourceSchema.shape.type}
        value={target.customProperties?.type}
        issue={typed.issueFor('type')}
        readOnly={readOnly}
        onChange={(raw) => typed.setRaw('type', raw)}
      />
      <PropertyField
        name="initialValue"
        type={resourceSchema.shape.initialValue}
        value={target.customProperties?.initialValue}
        issue={typed.issueFor('initialValue')}
        readOnly={readOnly}
        onChange={(raw) => typed.setRaw('initialValue', raw)}
      />
    </div>
  );
}

const registry = createRegistry({
  elements: {
    'istar.Resource': {
      properties: resourceSchema,
      component: ResourceNode,
      inspector: ResourceInspector,
      palette: { label: 'Variable' },
      defaultProperties: { type: 'bool', initialValue: 'false' },
    },
    'istar.Role': { palette: false },
  },
  links: {
    'istar.IsALink': { palette: false },
  },
});

// <IstarCanvas store={store} registry={registry} />
```

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

| Variable                   | Default              | Used for                |
| -------------------------- | -------------------- | ----------------------- |
| `--istar-font-family`      | Arial, Helvetica…    | UI type                 |
| `--istar-font-size`        | `12px`               | Base size               |
| `--istar-text`             | `#000`               | Text                    |
| `--istar-stroke`           | `#000`               | Shapes and links        |
| `--istar-stroke-width`     | `2px`                | Node outlines           |
| `--istar-link-width`       | `1px`                | Link lines              |
| `--istar-node-fill`        | `rgb(205, 254, 205)` | Inner elements          |
| `--istar-actor-fill`       | `rgb(242, 242, 242)` | Actor boundary          |
| `--istar-selection`        | `#2f6fe4`            | Selection, focus        |
| `--istar-canvas-bg`        | `#fff`               | Diagram background      |
| `--istar-panel-bg`         | `#fafafa`            | Palette and inspector   |
| `--istar-panel-border`     | `#d9d9d9`            | Panel borders           |
| `--istar-button-bg`        | `#fff`               | Buttons                 |
| `--istar-button-active-bg` | `#dfe9fc`            | Active palette tool     |
| `--istar-error-bg`         | `#fdecea`            | Errors, connection hint |
| `--istar-error-text`       | `#8a1c1c`            | Error text              |
| `--istar-info-bg`          | `#eef4fd`            | Info notices            |
| `--istar-info-text`        | `#1d3f7a`            | Info text               |

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
