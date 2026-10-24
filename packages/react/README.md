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
`controls` (zoom buttons), `background` (dotted grid, off by default: piStar's paper is plain),
`fitView` (on by default; waits until the container has a usable size, so a canvas mounted in a
panel that is still opening is fitted once it has room), `diagnostics` and `issues` (findings
from LSPs, validators and other analysers; see Diagnostics below), `diagnosticBadges`,
`onSelectionChange`, `linkShape` (`'straight'` by default, or
`'curved'` for Bézier links that leave each node perpendicular to its side), `colorMode`
(`'light'` or `'dark'`, see Theming), `minimap` and `panOnShiftScroll`.

### Controlling the viewport and selection

The canvas owns its React Flow instance, so `useReactFlow()` isn't available to your app. Pass a
`ref` instead to fit, zoom, reveal, or select elements, e.g. after resizing the container or when an
element is selected elsewhere. Viewport methods resolve to `true` once the viewport has moved
(after any animation), or `false` if they couldn't (for example, an unknown element id).

```tsx
import { useRef } from 'react';
import type { IstarCanvasHandle } from '@istar-ts/react';

const canvas = useRef<IstarCanvasHandle>(null);

<IstarCanvas
  ref={canvas}
  store={store}
  onSelectionChange={(sel) => {
    /* mirror to a tree view / VS Code host */
  }}
/>;

canvas.current?.fitView({ padding: 0.1, duration: 200 }); // or { nodes: [elementId] }
canvas.current?.centerOn(elementId, { zoom: 1.5, duration: 200 }); // keeps the zoom if omitted
canvas.current?.select({ type: 'element', id: elementId });
canvas.current?.zoomIn();
canvas.current?.zoomOut();
```

### Diagnostics

Diagnostics are findings about elements and links that are **not** part of the saved model and
are never written to disk. Any analyser can publish them: an LSP server, a model checker, a
simulation, an LLM critic. Each one is a `GoalDiagnostic` (from `@istar-ts/core`, re-exported
here). They are anchored by element id, not by text position:

```ts
{
  elementId: string;   // an element or link id
  key?: string;        // the custom property it is about
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;     // who published it
  range?: { start: { line, character }; end: { line, character } };
  code?: string;
  data?: unknown;
}
```

Publish per source to a `DiagnosticsStore`. Each `publish(source, list)` replaces only that
source's set, as an LSP `publishDiagnostics` does. The editor then shows the union of all sources,
deduplicated by `(elementId, key, message)` and keeping the worst severity:

```tsx
const diagnostics = useDiagnosticsStore(); // or createDiagnosticsStore() outside React

// MutRoSe's webview message ({ nodeId, severity, message }), in one line:
diagnostics.publish('mutrose', fromNodeIdDiagnostics(message.diagnostics));
// LSP diagnostics carrying data.elementId (or data.nodeId) and data.key:
diagnostics.publish('goal-language', fromLspDiagnostics(lspDiagnostics));
// Range-anchored ones: map the range to an element once, in the host.
diagnostics.publish(
  'lsp',
  fromLspDiagnostics(list, { elementIdFor: (d) => idAtLine(d.range!.start.line) }),
);
diagnostics.clear('prism'); // one source; clear() for all

<IstarCanvas store={store} diagnostics={diagnostics} />;
```

`diagnostics` also accepts a plain `GoalDiagnostic[]`. Pass `severityNumbering: 'vscode'` to
`fromLspDiagnostics` for `vscode.Diagnostic` objects, whose severities count from 0. istar-ts
contains no LSP client.

Diagnostics show up in three places:

- **Badges.** Default element components and link labels draw a badge with the worst severity;
  hovering lists the messages with their source. A badge your own component draws (as before
  0.12) replaces the default one. Use `diagnosticBadges={false}` to turn them off.
- **Inspector.** The default inspector lists element-level diagnostics at the top, and property
  diagnostics under that property's row (schema or free-form), matched by `key`. A key without
  a row is listed at the top with its key.
- **Custom UI.** Components, inspectors and link `labelComponent`s receive `diagnostics`.
  `useElementDiagnostics(id)` returns them for any id. `useGoalDiagnostics()` returns the merged
  list, `byElement`, and `publish` / `clear` for producers inside the editor. `<DiagnosticList>`
  and `<ElementIssuesBadge diagnostics={…} />` are the default building blocks.

The older `issues` prop (`{ id, severity, message }`, an `ElementIssue`) still works. It is the
element-level subset of a diagnostic and is merged with the rest. Components that read
`props.issues` (or `useIstarEditor().issuesById`) see every diagnostic as an issue: hints read as
`info`, and property diagnostics are prefixed with their key.

Property schemas (`defineProperties`) remain for inspector UX only; they do not replace an external
validator such as an LSP.

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
- **Actors:** select an actor, role or agent by its **symbol** (the circle at the top left), and drag
  it by the symbol, or by its body while nothing is selected. Clicks on the rest of its boundary
  don't select it and leave the current selection as it is, and box selection never picks up the
  whole frame. **Alt+click** the symbol to collapse or expand
  the actor, as in piStar. Collapsed actors
  hide inner elements; dependency links re-anchor on the actor; other links involving hidden nodes are
  hidden until expand.

- **Navigation:** the wheel zooms; **Shift + wheel** pans sideways (`panOnShiftScroll`, on by
  default). On touch screens, pinch with two fingers to zoom, anywhere on the diagram.

Press **Escape** to clear the active palette tool.

## The action protocol

The canvas's drag, create, connect, delete and undo/redo handlers, and the inspector's
rename/delete/custom-property setters, edit the model by dispatching
[`@istar-ts/actions`](https://github.com/vieirin/istar-ts/tree/main/packages/actions) actions
rather than calling the store directly. `IstarProvider` (and `IstarCanvas`, which creates one
implicitly) accepts a `dispatcher?: ActionDispatcher` prop; without one, it makes its own with
`createActionDispatcher` over the store. Pass your own to add guards, observe every edit
(`dispatcher.subscribe`), or front the editor with a transport:

```tsx
import { createActionDispatcher } from '@istar-ts/actions';
import { IstarCanvas, useIstarStore } from '@istar-ts/react';

export function Guarded() {
  const { store } = useIstarStore();
  const [dispatcher] = useState(() =>
    createActionDispatcher(store, { guards: [(operation, model) => /* host rules */ []] }),
  );
  return <IstarCanvas store={store} dispatcher={dispatcher} />;
}
```

A rejection (a `canLink` failure, a guard, a property schema) surfaces as the editor's notice,
the same as a direct store rejection did; the model is untouched. Two edits have no operation and
still write to the store directly: a link's value (the contribution make/help/hurt/break) and
name, because clearing a link's name needs to remove the key, which `applyLabelEdit`'s `text:
string` can't express; and an element's display patch (colour, the auto-grown height), because
`changeBounds` only carries position and size.

The playground's "Run remote worker demo" button
(`examples/playground/src/remote-worker.ts`) shows a client outside the page: a Web Worker gets
one end of a `MessageChannel` and dispatches `createNode` actions over it with
`createRemoteDispatcher`; the main thread serves its own dispatcher on the other end with
`connectDispatcher`, so the nodes the worker asks for land in the real model, each its own undo
step.

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
| `defaultName`       | Name when creating (`string` or `({ model }) => string`)         |
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

### New element and link kinds

An `IstarExtension` can bring new kinds as well as presentation. Its `metamodel` part is a core
metamodel extension (see `@istar-ts/core`, "Extending the metamodel"); `elements` / `links` say how
the kinds look, like piStar-ext's "Shape" and "Kind of Line" fields:

```tsx
import { ISTAR_2_0, parsePistar } from '@istar-ts/core';
import { IstarCanvas, LINE_DASHES, metamodelWithExtensions, useIstarStore } from '@istar-ts/react';
import type { IstarExtension } from '@istar-ts/react';

const rationalAgents: IstarExtension<string, string> = {
  name: 'rationalAgents',
  metamodel: {
    name: 'rationalAgents',
    elements: [
      { kind: 'rationalAgents.Planning', behavesLike: 'istar.Task', pistarType: 'istar.Planning' },
      { kind: 'rationalAgents.Plan', category: 'node' },
    ],
    links: [
      {
        kind: 'rationalAgents.GeneratesLink',
        label: 'Generates',
        rules: { sources: ['rationalAgents.Planning'], targets: ['rationalAgents.Plan'] },
      },
    ],
  },
  elements: {
    // SVG path data, scaled to the element (no viewBox needed).
    'rationalAgents.Planning': {
      shape: { path: 'M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 L 14 20 Z' },
    },
  },
  links: {
    'rationalAgents.GeneratesLink': {
      line: { dash: LINE_DASHES.dotted, marker: 'm 10,-6 l -10,6 10,6' },
    },
  },
};

const extensions = [rationalAgents];
const metamodel = metamodelWithExtensions(extensions, ISTAR_2_0);

function Editor({ text }: { text: string }) {
  const { store } = useIstarStore(() => parsePistar(text, { metamodel }));
  return <IstarCanvas store={store} extensions={extensions} />;
}
```

- **Defaults.** The canvas completes its registry for the model's metamodel
  (`registryForMetamodel`). Every extended kind gets a palette entry after the built-in ones, its
  label and size, and the default components. Extended node kinds that can be dependums join the
  Dependency menu.
- **Nodes.** `shape` draws the kind with SVG path data, scaled to the element (`pathBounds`
  computes the drawing's box without a DOM). Without a shape, an extended node is drawn as piStar's
  default node: a dashed box with its «stereotype» (set `stereotype` to change or hide it). An
  extended actor kind looks like the actor it behaves like, or is a dashed circle.
- **Links.** `line` sets the `dash` (`LINE_DASHES`: piStar-ext's dashed, dotted, continuous) and
  the target `marker` (path data, JointJS convention, as piStar-ext stores it). Without one, an
  extended link is drawn like the kind it behaves like, or as a continuous line with an open arrow.
- **Constraints.** The canvas checks connections with the same `canLink` as `@istar-ts/core`, so
  extended rules apply while dragging, and rejected links say why.

The playground's "iStar4RationalAgents" extension (`examples/playground/src/extensions/`) and the
`fixtures/extensions/rationalAgents.txt` example show it end to end.

### Other root metamodels, hubs and link-anchored links

A model whose metamodel is a root other than iStar 2.0, such as KAOS or the NFR Framework built
with core's `defineMetamodel`, gets a registry of its own. The canvas completes the registry for
it and keeps only its kinds, so a KAOS canvas has no iStar palette. A framework package then
applies its presentation on top:

```tsx
import { applyExtensions, registryForMetamodel } from '@istar-ts/react';

<IstarCanvas store={store} extensions={[kaosExtension]} />;
// or, standalone:
const registry = applyExtensions(registryForMetamodel(KAOS), [kaosExtension]);
```

- **Paper.** A node kind whose metamodel `info.canBeOnPaper` is true is added where you click on
  empty canvas, or on a node outside any actor. iStar 2.0's node kinds still need an actor.
- **Hubs.** An n-ary link kind (`arity: 'n'`, e.g. KAOS's refinement) is drawn as DSM3-goals
  draws it: a circle (`HubComponent`), a leg from each source to it, and an end from it to the
  target. The hub isn't on the palette, and its inspector (`HubInspector`) is titled with the
  link and edits the link kind's `properties`, which are kept on the hub. Legs have no marker;
  the end is drawn like the base kind's `line`. The base kind has one tool: dragging from a
  source to a target creates the hub, its first leg and the end; dragging onto an existing hub
  adds a leg. Either way the hub is selected. Selecting a leg or the end inspects the whole link
  too (`HubPartInspector`), with its sources and target, followed by the selected part's own
  properties under its kind's schema: a leg kind (`<Kind>Start`, see core's `HubPartKind`) may
  have `properties` of its own, such as a probability per leg of a case-driven refinement.
- **Value hints.** `prop.reference({ kinds })` renders a select of the model's elements of
  those kinds, by name; an id that isn't in the model stays shown, marked missing. A
  `prop.number({ max: 1 })` is a text input, so `.2` and `20.00%` stay as typed.
- **Glyph links.** A link drawn with a glyph at its middle (a `labelComponent` and
  `line.marker: false`) can show it in the palette: give the kind an `icon`, e.g.
  `linkIcon(kind, undefined, { marker: null, glyph })`.
- **Changeable labels.** A new link kind with `info.possibleLabels` gets one palette entry per
  label, grouped in a dropdown, as iStar's Contribution has.
- **Links that target links.** A link kind whose rules target links (NFR's Argument, core's
  `targetsLinks`) is drawn to the middle of the link it points at, and follows it while its
  nodes are dragged. While such a tool is active (canvas class `is-linking-to-links`), each
  targeted link shows an anchor on its middle to drop the new link on. `linkAnchorId(linkId)`
  and `linkIdOfAnchor(nodeId)` convert between a link and its anchor node.
- **Shapes.** A `shape` may give a `dash` and a `strokeWidth` for its outline, as KAOS's dashed
  Softgoal and NFR's bold Operationalization need. `polygonPath(points)` turns SVG polygon
  points into path data.

### Link labels

By default links are labelled as in piStar: Is-A and Participates-In links show their fixed text, and
contributions show their value. piStar keeps a link's `name` only in its properties panel. Here the
default inspector edits it as well, and `<IstarCanvas linkNames />` also draws it on the canvas.

For anything else, such as piStar-ext's `<<stereotype>> {tag = value}`, give the link kind a
`labelComponent`, either through an extension or in the registry. It is drawn as HTML at the link's
middle, replaces the default labels for that kind, and receives the texts they would show:

```tsx
import type { IstarExtension, LinkLabelProps } from '@istar-ts/react';

function Stereotyped({ link, labels }: LinkLabelProps) {
  const stereotype = link.customProperties?.stereotype;
  return (
    <span>
      {stereotype && `<<${stereotype}>> `}
      {labels.value ?? labels.fixed}
    </span>
  );
}

const stereotypes: IstarExtension = {
  name: 'stereotypes',
  links: { 'istar.ContributionLink': { labelComponent: Stereotyped } },
};
```

Extended link kinds (see "New element and link kinds") take a `labelComponent` the same way. The
playground's iStar4RationalAgents demo uses one to draw piStar-ext's `extension` block on a link.

### Label layout and fitting

The default components lay out an element's name as piStar does: wrapped at the element's full width,
with 1em lines. Three per-kind settings change that, through an extension or the registry:

- `textBox`: the box the label is laid out in, as fractions cut from each side of the element. The
  default is the whole element. `TEXT_BOXES` (`goal`, `task`, `resource`, `quality`, `actor`) keeps
  text inside each piStar shape, but changes where names wrap, so it is opt-in.
- `labelHeader(element)`: small italic lines above the name (e.g. `«action»`, `{Id = G1}`), fitted
  together with it and hidden while the name is edited. An extended kind's default «stereotype»
  is the first header line.
- `labelFit`:
  - `{ mode: 'shrink' }` (the default) leaves names that fit untouched. When the text overflows,
    the font steps down by `step` (0.1) to `minScale` (0.7). If it still overflows, it is
    ellipsized, with the full text as the tooltip. The text refits whenever the element is resized.
    It never changes the model.
  - `'none'` lets text overflow, as piStar does.
  - `'grow'` makes the element taller (`display.height`) to fit its label, but only after the name
    is edited (including naming a new element), never on load, so opening a file doesn't change its
    layout.

```tsx
import type { IstarExtension } from '@istar-ts/react';
import { TEXT_BOXES } from '@istar-ts/react';

const stereotypes: IstarExtension = {
  name: 'stereotypes',
  elements: {
    'istar.Task': {
      textBox: TEXT_BOXES.task,
      labelHeader: (task) => {
        const s = task.customProperties?.stereotype;
        return s ? [`«${s}»`] : null;
      },
    },
  },
  links: {
    'istar.ContributionLink': {
      labelHeader: (link) =>
        link.customProperties?.tag ? [`{${link.customProperties.tag}}`] : null,
    },
  },
};
```

Links take a `labelHeader` too: its lines are drawn above the default label, so annotations need no
`labelComponent`. A `labelComponent` receives them as `labels.header`. For your own components,
`useFitText(ref)` fits the first child of `ref` inside it and returns the font scale, and
`<LabelHeader lines={…} />` draws header lines in the default style.

### Palette

Palette entries carry an `icon` (the default registry draws piStar-like previews, exported as
`elementIcon`, `linkIcon` and `dependencyIcon`), an `order`, a `section` (sections are separated by
a divider) and an optional `group`: entries sharing a group collapse into one button with a ▾ menu,
as piStar does for Actor, Actor links, Dependency and Contribution. While a tool is active a
status hint (the entry's `title`) says what to do next.

`<IstarPalette orientation="vertical" | "horizontal" flyout="right" | "below" | "above" showLabels history />` can also be placed
yourself inside an `<IstarProvider>` (use `<IstarCanvas palette={false}>` then).

**Several entries for one kind.** An element kind's `palette` can be a list, like a link kind's:
each entry is its own tool creating that kind, optionally presetting `properties` (merged over
`defaultProperties`). Entries inherit the kind's icon, section and order unless they set their
own, and entries sharing a `group` collapse into one dropdown:

```tsx
const extension: IstarExtension = {
  name: 'typed-resources',
  elements: {
    'istar.Resource': {
      palette: [
        { label: 'Boolean', group: 'resource', properties: { type: 'bool' } },
        { label: 'Integer', group: 'resource', properties: { type: 'int' } },
      ],
    },
  },
  paletteGroups: { resource: { label: 'Resource' } },
};
```

**Your own tool bar.** With `palette={false}`, render any controls you like (e.g. as the canvas
`aside`) and drive the editor's tools yourself. `usePaletteControls()` returns the registry's
entries as data (`label`, `icon`, `active`, `select()`, plus `undo`/`redo`), or build tools directly
with `useIstarEditor().setTool(tool)`. An element tool can preset custom properties on what it
creates:

```tsx
function MyBar() {
  const { tool, setTool } = useIstarEditor();
  const achieve = {
    type: 'element',
    kind: 'istar.Goal',
    properties: { GoalType: 'Achieve' },
  } as const;
  return <button onClick={() => setTool(achieve)}>Achieve</button>;
}

<IstarCanvas store={store} palette={false} aside={<MyBar />} />;
```

**Actors without a boundary.** An actor kind with `boundary: false` (e.g. in an extension) is drawn
as its `component` alone, at the kind's `size`, instead of a boundary around its elements. The
elements stay nested in the model and move with the actor; nodes added on empty canvas space join
the nearest such actor.

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
| `--istar-node-stroke`      | `var(--istar-stroke)`   | Node outlines           |
| `--istar-node-text`        | `#000`                  | Element names           |
| `--istar-link-stroke`      | `var(--istar-stroke)`   | Links and markers       |
| `--istar-boundary-stroke`  | `var(--istar-stroke)`   | Actor boundaries        |
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

`colorMode="dark"` applies a dark theme (the `istar-dark` class, which also works on an ancestor
of a standalone palette or inspector) and React Flow's dark controls and minimap. Nodes keep their
light fills with dark outlines and names; the same variables override it.

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
