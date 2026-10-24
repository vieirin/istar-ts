# Changelog

Versions are published from GitHub release tags; see the release notes for full details.

## Unreleased

- **react (tests):** the rejected-create rollback tests no longer flake (#94). The rollback was
  already correct; the tests read the editor through a passive effect, which can run a task after
  the commit that shows the notice. They now read it in a layout effect and check the commit itself,
  for rejections settling after a microtask or a task.
- **glsp:** new package `@istar-ts/glsp`, a GLSP server diagram module on `@eclipse-glsp/server`
  2.8 (read side, #80): `modelToGModel` (actors as containers with actor-relative children,
  dependums, n-ary hubs, link anchors; types `node:<kind>`/`edge:<kind>`), `IstarDiagramConfiguration`
  (type hints from `typeHintsFor` in GModel types, `needsClientLayout: false`), `IstarModelState`
  (one `ModelStore` and its dispatcher per session), `IstarSourceModelStorage` (`parsePistar`/
  `toPistar` through a host-bound `PistarFiles`), and dialect contributions bound by Inversify
  manifests (`IstarDiagramModule`, `IstarContributionModule`, `configureIstarDiagram`):
  `ISTAR_GLSP`, `KAOS_GLSP`/`KAOS_OBSTACLES_GLSP` (`@istar-ts/glsp/kaos`) and `NFR_GLSP`
  (`@istar-ts/glsp/nfr`). Inversify's legacy decorators build with tsdown, with an explicit
  `@inject()` per constructor parameter. No React dependency.
- **glsp:** the write side (#81): GLSP's operations (`createNode`, `createEdge`, `deleteElement`,
  `changeBounds`, `changeContainer`, `reconnectEdge`, `applyLabelEdit`, `compound`) go through the
  istar-ts dispatcher (`translateOperation` maps GModel types, ids and relative positions back);
  `IstarCommandStack` delegates undo/redo to `glspUndo`/`glspRedo`, so there is one undo stack,
  and dirty state is the dispatcher's (GLSP's `saveModel` saves through it). `updateModel` follows
  every accepted operation, undo, redo and change by another client of the store; rejections are
  a `message` plus markers. The palette comes from the contribution's `PaletteDescription`,
  `requestCheckEdge` from the dispatcher (with `canLink`'s reason), markers from its
  `requestMarkers`, and client-bound actions a client didn't list are dropped quietly.
- **glsp:** hosts (#82). `@istar-ts/glsp/browser`: `startIstarGlspWorker` runs the server in a Web
  Worker (the model lives there; GLSP on the worker itself, as `GLSPWebWorkerProvider` connects)
  and `serveIstarGlsp` serves it on any `MessagePort` in the page. `@istar-ts/glsp/page`:
  `connectWorkerDispatcher`, an istar-ts `ActionDispatcher` on the worker's model (no GLSP in the
  page). `@istar-ts/glsp/node`: `startIstarGlspServer` on a WebSocket, `diskPistarFiles`, and an
  opt-in MCP server (`mcp`, `@eclipse-glsp/server-mcp` 2.8.0 as an optional peer, loopback only);
  `pnpm --filter @istar-ts/glsp serve <file>`. Shared-store hosting: a host passes its own
  `{ store, dispatcher }` (`IstarSharedModel`) and every session, plus the host's canvas, edits
  one model; a session's store listener now unsubscribes when the session is disposed.

- **examples:** the playground is now a multi-page Vite app: `/` is a React-free start page with
  cards picking the front end (`/react.html`, today's playground, unchanged in content; the stock
  GLSP client and the side-by-side view are disabled pending #83 and #85).
- **examples:** a new workspace package, `glsp-client`, exports `mountGlspClient(element, options)`:
  the stock `@eclipse-glsp/client` 2.8 (default modules, default views, plus every concrete
  `node:<kind>`/`edge:<kind>` type registered against the default node/edge views) connected over
  an in-page `MessageChannel` port, a module `Worker`, or a Node launcher's WebSocket. A standalone
  container never auto-fits the viewport, so `mountGlspClient` dispatches `fit` once the model
  loads. `MountedGlspClient.dispatch` lets a host send actions directly (`undoAction`/`redoAction`,
  for a toolbar button — the default modules bind no undo/redo button, only a keyboard shortcut).
  The start page's GLSP card is enabled and opens `/glsp.html`: a fixture picker (iStar, KAOS, NFR,
  one `@istar-ts/glsp` session each, in-page by default, `?server=worker` or `?server=ws://...`
  for the other two launchers), Undo/Redo buttons, and a status line for rejections and other
  server messages (`message`; `status` and `setMarkers` already show through the default modules).
  GLSP, Inversify and `@eclipse-glsp/*` stay out of `/react.html`'s bundle.
- **react:** `IstarInspector`'s width is a CSS variable (`--istar-inspector-width`, default
  340px, up from a fixed 280px) with min/max variables (`--istar-inspector-min-width` 240px,
  `--istar-inspector-max-width` 60vw), and resizable by dragging a handle on its canvas-facing
  edge (`role="separator"`, arrow keys step it, double-click resets it). New optional props
  `inspectorWidth` (controlled), `defaultInspectorWidth` and `onInspectorWidthChange` let a host
  control or persist the width; the playground persists it in `localStorage`.
- **docs:** `docs/papers/metin-bork-2025.md` transcribes the reference architecture section of
  Metin & Bork, "A reference architecture for the development of GLSP-based web modeling tools"
  (SoSyM 24(6), 2025, CC BY 4.0) — layers, feature tiers, manifests/contributions, figures redrawn
  as text, and a mapping to istar-ts. `#74`'s build briefs cite this file instead of the PDF.
- **docs:** `docs/glsp/framework-notes.md` — a GLSP server/client framework reference read from
  `eclipse-glsp/glsp-core` source (server module anatomy, GModel, the five-method lifecycle,
  the standalone client, `server-mcp`, `e2e/playwright`), plus a GLSP-piece-to-istar-ts-piece
  mapping table and a risk table, for [#74](https://github.com/vieirin/istar-ts/issues/74)'s
  later stages. Docs only, no code.
- **react:** `IstarProvider`/`IstarCanvas` accept an optional `dispatcherFor?: (surface: IstarSurface) => ActionDispatcher`
  prop (`IstarSurface = 'canvas' | 'inspector'`) so a host can tell which surface sent an action
  without a protocol change. The canvas's own handlers dispatch through `dispatcherFor('canvas')`.
  `'inspector'` covers calls made by components rendered in the inspector panel (`Inspector.tsx`
  and the per-kind inspector components the registry provides); `elementActions`/`linkActions`
  called without a `surface` (host code outside the inspector panel, e.g. a toolbar button, or a
  canvas node's inline rename) keep using the base `dispatcher`. Omitted, both surfaces use
  `dispatcher`, unchanged. The playground's action log now tags the canvas and the inspector
  "Canvas"/"Inspector" instead of lumping both into "UI".
- **core:** a failing `LinkCheck`/`ConnectResult` carries `end?: 'source' | 'target'` naming the
  offending endpoint; `connectResultToDiagnostic` reads it instead of matching `'source'` in the
  reason text, so a source or target id containing the word "source" is no longer misattributed.
- **core:** `DEFAULT_PALETTE` (`./palette`) is iStar 2.0's palette data (label, group, section,
  order, and a dependency/contribution entry's `dependum`/`value`) without React, so a host can
  answer "what can I add here" (GLSP's `RequestContextActions`) headlessly; the react registry's
  default entries derive from it, icons and titles staying in react. `ModelOperationError` carries
  the `elementId` it names (when it names one) and gains `toDiagnostic(): GoalDiagnostic`;
  `connectResultToDiagnostic` maps a failing `connect` result to a `GoalDiagnostic` anchored on
  the offending end.
- **react:** `modelToFlow` and `actorBoundary` are generic over the model's kinds
  (`IstarModel<EK, LK>` with an `IstarRegistry<EK, LK>`, iStar 2.0's by default), so a KAOS, NFR or
  extended model is laid out without a cast. `modelToFlow`'s registry is optional: by default
  `registryForMetamodel(metamodelOf(model))`.
- **actions:** the action vocabulary and dispatcher (`@istar-ts/actions`), a GLSP-protocol subset
  over a `ModelStore`. `IstarAction` is a discriminated union on `kind` with GLSP's names and
  shapes where they fit (`createNode`, `createEdge`, `deleteElement`, `changeBounds`,
  `changeContainer`, `reconnectEdge`, `applyLabelEdit`, `compound`; `requestModel`/`setModel`,
  `requestTypeHints`, `requestCheckEdge`, `requestContextActions`, `requestMarkers`, `glspUndo`,
  `glspRedo`, `saveModel`, `setDirtyState`, `sourceModelChanged`) and iStar extras under `istar.*`
  (`addLeg`, `removeLeg`, `setCollapsed`, `updateDiagram`, `updateProperties`).
  `createActionDispatcher(store, { guards, palette, schemas, diagnostics, save })` runs each
  operation as one transaction; a rejection (`canLink`, `ModelOperationError`, a guard, a property
  schema) returns `GoalDiagnostic`s and leaves the model untouched (a shape GLSP's own protocol
  has no equivalent for — see `docs/action-protocol.md`); a success returns the ids it created.
  Store changes reach subscribers as `ModelSourceChangedAction` (wire `kind`:
  `sourceModelChanged`). Actions and results are plain JSON (`ActionDispatcher` is the interface
  a transport implements). Also `typeHintsFor`, `contextActionsFor`,
  `diagnosticToMarker`/`markerToDiagnostic`. `connectDispatcher`/`createRemoteDispatcher` carry
  an `ActionDispatcher` over a `MessagePort`-like object (`{ postMessage, onmessage }`), framed
  as JSON-RPC 2.0 with one method per action kind (`method` = the action's `kind`) — not yet
  GLSP's own five-method lifecycle (`initialize`/`initializeClientSession`/`process`/
  `disposeClientSession`/`shutdown`), tracked as istar-ts#44; `subscribe` events go server to
  client as notifications, and only a transport/protocol fault is a JSON-RPC error, a rejection
  staying a normal result. One undo stack is shared by every client of a dispatcher.
- **react:** `IstarProvider` and `IstarCanvas` accept a `dispatcher?: ActionDispatcher` prop
  (default: one `createActionDispatcher` makes over the store). The canvas's drag, create,
  connect, delete and undo/redo handlers, and the inspector's rename/delete/custom-property
  setters (`elementActions`/`linkActions`, unchanged as the typed facade), now dispatch through
  it instead of calling the store directly; a rejection surfaces through `notify`.
  Creating a kind that can't be an inner element inside an actor is now refused with a
  notification, instead of the silent nested create `addElement` allowed before (`createNode`
  checks `canBeInnerElement`/`canBeOnPaper`, as `core`'s path did not); a rejected create or
  dependency connect no longer leaves the selection or inline rename on the id it optimistically
  picked. The playground's toolbar gets a "Run remote worker demo" button: a Web Worker
  dispatches `createNode` actions over a `MessageChannel` (`createRemoteDispatcher`) served by
  the main thread's own dispatcher (`connectDispatcher`), each node landing in the real model as
  its own undo step.
- **docs:** `docs/action-protocol.md` — the GLSP concept ↔ istar-ts mapping, the vocabulary,
  the dispatcher contract, the transport envelope and its gap with GLSP's own, how a host adds a
  guard (a compiled example, `packages/actions/test/docs.test.ts`), and the limitations-by-design
  list. README sections for `packages/actions`, `packages/core` (palette, `toDiagnostic`) and
  `packages/react` (`dispatcher` prop).
- **react:** `IstarEditor.select`/`setEditingId` also accept an updater function, as `useState`'s
  setter does. A rejected create's rollback (`addAt`/`onConnect`'s dependency and n-ary paths) now
  uses it, so the "still names this id" check runs against the latest state whenever React applies
  it, not a stale snapshot read before a fast rejection — a race that could leave the inspector
  editing an element that doesn't exist (istar-ts#63).
- **actions:** two more operations close the remaining gaps between the dispatcher and the react
  facade (istar-ts#50, #51, #52): `istar.updateDisplay { elementId, patch }` merges into an
  element's `display` (colour, the auto-grown height), as `ElementPatch.display` does; and
  `istar.setLinkValue { linkId, value }` sets an existing link's contribution value
  (make/help/hurt/break), checked against the link kind's `possibleLabels` as `createEdge.args.value`
  is at creation (`null` clears it). `applyLabelEdit` on a link now removes its `name` when `text`
  is `""`, instead of writing an empty string, matching what piStar writes for a link whose name
  was cleared. `elementActions.setDisplay` and `linkActions.setLabel`/`setName` now dispatch these
  instead of calling the store directly.
- **actions:** `HANDLED_ACTION_KINDS` (`{ operations, requests, notifications }`), derived from
  the same lists `isOperation`/`isRequestAction` use, so a host can know what
  `createActionDispatcher` accepts without the dispatcher's own code (goal-controller#171's
  `initialize`, istar-ts#44). `createEdge`'s `args` gains `legId`/`endId` for an n-ary kind whose
  target isn't yet one of the kind's hubs, mirroring `linkIds` for a dependency: the new hub's leg
  and end then take those ids instead of fresh ones, so a replayed log reproduces the model byte
  for byte and a remote client can know the ids in advance (`core`'s `connect`/`NewLink` gain the
  same options).
- **playground:** the script console's kind list is `HANDLED_ACTION_KINDS.operations`, replacing
  its own mirrored copy; the protocol lab's replay injects a new n-ary hub's recorded leg/end ids
  too, closing the gap `replayLog.ts` used to document.
- **dsm3-kaos, dsm3-nfr:** `KAOS_PALETTE`/`KAOS_OBSTACLES_PALETTE` and `NFR_PALETTE` are
  React-free `PaletteDescription`s (`@istar-ts/core`) for each dialect's kinds, exported from the
  packages' root and their React-free `./metamodel` subpath; `contextActionsFor`
  (`@istar-ts/actions`) can now answer "what can I add here" for a KAOS or NFR model without
  `@istar-ts/react`. `kaosExtension`/`nfrExtension` derive their palette entries' label, order,
  section and group from them, adding titles, icons and shapes as before (palette output
  unchanged).
- **glsp-client:** `/glsp.html` loads the stock `@eclipse-glsp/client`'s own CSS (`glsp-sprotty`,
  sprotty's base CSS, the tool palette, decorations, toast, status overlay, codicons) plus a new
  `istar-glsp.css` styling every concrete GModel type (`node:<kind>`/`edge:<kind>`, actor
  containers, dependums, hubs/anchors) with colours mirroring `@istar-ts/react`'s `--istar-*`
  theme, in light and dark (`prefers-color-scheme`) — previously nodes fell back to the SVG
  default (`fill: black`) and edges had no stroke at all (#103). The sprotty SVG now fills
  `.pg-glsp-diagram`, and `MountedGlspClient` gains a `fit()` method the playground calls on
  window resize (the standalone container never re-fits on its own).
- **glsp:** edges can be created and reconnected by clicking in a stock GLSP client (#105). Edge
  type hints are no longer `dynamic`: `@eclipse-glsp/client` drops a click that lands before its
  own `requestCheckEdge` answer, and never shows a refusal's reason. The client now checks types
  and sends `createEdge`, and a refused link (a self-refinement, say) comes back as an `ERROR`
  message with `canLink`'s reason. Edge hints are `repositionable`, which GLSP reads as "can be
  reconnected", and an n-ary kind's hint targets its hub, so a leg can be drawn onto it.
  `mountGlspClient` takes `logActions` (`/glsp.html?debug=actions`) to log the action traffic.

For goal-controller#185 and istar-ts#25 (A1, A2, B, C, D), istar-ts#26, istar-ts#28, istar-ts#29,
istar-ts#31, istar-ts#35, istar-ts#57, istar-ts#60.

## 0.14.0

- **dsm3-kaos:** obstacle analysis on the KAOS root, `kaosObstacleAnalysis` and `KAOS_OBSTACLES`
  (`extendMetamodel(KAOS, kaosObstacleAnalysis)`): Obstacle, the n-ary Obstacle refinement,
  Obstruction and Resolution, with text keys only (`Description`, `FormalSpec`, `Category`;
  `ResolutionType`, `Anchor`). Kinds are `kaosObstacles.*`, saved as `kaos.Obstacle`,
  `kaos.ObstacleRefinementLinkHub/Start/End`, `kaos.ObstructionLink` and `kaos.ResolutionLink`:
  istar-ts's file types, not DSM3's. Shapes, lines and palette entries in `kaosExtension`, in KAOS
  grey. Domain property gets an optional `Kind` (`domainPropertyProperties`). Everything is also on
  `./metamodel`. New fixture `fixtures/dsm3/kaos-las.txt` (KAOSTools' LAS) with leg probabilities
  and RSR/ESR as plain strings.
- **core:** `prop.number({ max: 1 })` also reads `.2` and `20.00%`; `write` keeps a value's string
  when it is unchanged and writes a changed one in the form it was read in. `prop.reference({ kinds
  })` holds another element's id; `validateModelProperties` reports dangling ids and wrong kinds.
  `HubPartKind<K>` names an n-ary kind's generated hub, leg and end kinds. `PropertyType.type` gains
  `'reference'`.
- **react:** `HubPartInspector` shows the selected leg's (or end's) own properties, typed by its
  kind's schema, below the hub's. References render as a picker of the model's elements; numbers
  with `max: 1` as text inputs.

For istar-ts#20 and goal-controller#181.

## 0.13.7

- **dsm3-kaos / dsm3-nfr:** `KAOS_FILL` and `NFR_FILL` are also exported from the React-free
  `./metamodel` subpaths, so a consumer without React can share DSM3's colours.

## 0.13.6

- **core / react:** `KindShape.fill`, a kind's default fill (any CSS colour) for its elements
  without a `display.backgroundColor` and for its palette icon; absent, the theme's node fill as
  before. **dsm3-kaos** fills every KAOS node DSM3's grey (`KAOS_FILL`), **dsm3-nfr** draws its
  clouds on white (`NFR_FILL`), so the canvas and palette look as DSM3's do. For goal-controller
  #171.

## 0.13.5

- **core:** the registries kept beside models (their metamodel, the host part of it, their
  file's layout) are shared across every copy of `@istar-ts/core` in a process, through one
  `Symbol.for` key on `globalThis`. A bundle that loads the package twice (ESM for the
  application, CommonJS for a dependency) no longer sees a model parsed by one copy as iStar 2.0
  in the other, so `metamodelOf`, `getSourceLayout` and `toPistar` agree. For goal-controller
  #171.

## 0.13.4

- **core:** `toPistar` writes every element, link, hub entry and the diagram with the key order
  its file had (`SourceLayout.objects`, recorded by `parsePistar`, carried over edits by
  `inheritSourceLayout`), so files other tools wrote (a link's `label` before its
  `customProperties`, an actor's `x`/`y` after its `nodes`) round-trip byte for byte. Objects the
  file lacked follow in piStar's order. A parsed file that had no `saveDate` keeps none until a
  save passes one; a model that was never a file still gets the current time. For
  goal-controller #171.

## 0.13.3

- **dsm3-kaos / dsm3-nfr:** `typesVersions` maps the `./metamodel` subpath's types for TypeScript's
  `node10` module resolution (`module: commonjs` without `moduleResolution`), which ignores
  `exports`. The 0.13.2 subpath resolved at runtime but not for types under that setting.

## 0.13.2

- **dsm3-kaos / dsm3-nfr:** a React-free `./metamodel` subpath (`@istar-ts/dsm3-kaos/metamodel`,
  `@istar-ts/dsm3-nfr/metamodel`) with the root metamodel, its declaration, kind names,
  property schemas and labels, built for `import` and `require` as `@istar-ts/core` is. The
  package roots stay ESM-only. For CommonJS consumers such as mocha + ts-node (goal-controller
  #171).

- **KAOS polish** (issue #12).
  - **react:** selecting a leg or the end of an n-ary link inspects the whole link through its hub
    (`HubPartInspector`, the default for generated leg and end kinds). `HubInspector` lists the
    link's sources and its target.
  - **react:** `LinkKindConfig.icon` sets the palette icon of a link kind's entries that have
    none, and `linkIcon`'s style takes a `glyph` drawn at the line's middle.
  - **dsm3-kaos:** Conflict and Responsibility Assignment palette icons show their glyphs.

## 0.13.1

- **dsm3-kaos / dsm3-nfr:** republished with correct dependency ranges. 0.13.0 of both declared
  `@istar-ts/core@^0.0.0-development` and cannot be installed; use 0.13.1. core and react are
  unchanged.
- **Release workflow:** npm trusted publishing only (no token), manual re-run by tag, and a guard
  against tarballs that still reference `0.0.0-development`.

## 0.13.0

- **Root metamodels** (issue #7, groundwork for DSM3-goals' KAOS and NFR). iStar 2.0 is no longer
  the only language a metamodel can start from.
  - **core:** `defineMetamodel(declaration)` builds a root metamodel from a `name`, a `prefix`,
    element and link declarations, and optional `file` hints. It uses the same per-kind
    validation and error messages as `extendMetamodel`.
  - **core:** `ISTAR_2_0` is now `defineMetamodel(ISTAR_2_0_DECLARATION)`, with the declaration
    exported. Its kinds, info objects and every iStar 2.0 file are unchanged.
  - **core:** `Metamodel` gains `framework` (the root's name), `prefix` (its reserved namespace)
    and `file` (`MetamodelFileHints`). `extendMetamodel` keeps all three and rejects kinds in
    the root's prefix, which for iStar 2.0 is still `istar.`.
  - **core:** `createEmptyModel` writes the root's `file.tool`, `file.istar` (iStar 2.0 only) and
    `file.extra`. `toPistar` orders a new model's top-level keys by `file.keys`. iStar 2.0's
    empty model is unchanged.
  - **core:** property schemas recognise elements and links of any metamodel passed whole, not
    only `istar.*` ones.
  - **core:** `KindShape` gains optional `dash` and `strokeWidth` hints. They are types only for
    now; `@istar-ts/react` will draw them.
- **DSM3-goals' KAOS and NFR in core** (issue #7). Its three welcome models round-trip byte for
  byte.
  - **core:** n-ary links. A link kind with `arity: 'n'` generates a hub element kind and leg and
    end link kinds, as DSM3-goals does. `connect` with it creates a hub, a leg and the end, or
    adds a leg when the target is one of its hubs. New: `addLeg` and `removeLeg`, also on the
    store, plus `hubLinkOf`, `hubOfLink`, `isHubElement`, `elementCenter` and
    `defaultHubPosition`. Removing a hub's end or last leg removes the hub.
  - **core:** category selectors never match a hub. New `ConstraintCode`s are `hub-target`, for
    a link of another kind towards a hub, and `incomplete-hub`, from `validateModel`.
  - **core:** hub entries `{ hub, starts, end }` are read and written as DSM3-goals saves them,
    with an entry's unknown keys under `HUB_ENTRY_KEY`. `PistarFile.links` may now hold
    `PistarHubLinkJson` entries.
  - **core:** links that target links. `LinkRules.targets` may hold `link` or link kind names, and
    `canLink` accepts a link as the target. `validateModel` checks such links last, and removing a
    link removes the links that target it. New: `isLinkRef`, `linkTargetOf`, `linkBehavesLike`,
    `targetsLinks` and `LINK_SELECTOR`.
  - **core:** `LinkRuleContext.target` is now `IstarElement | IstarLink`, and
    `isThereLinkBetween` accepts anything with an `id`. This is a type-level change for `check`
    authors: narrow with `isLinkRef` before reading element fields. Runtime behaviour for element
    targets is unchanged.
  - **core:** `detectPrefix(json)` and `detectFramework(json, roots)` tell which root metamodel a
    file is written in.
  - **core:** `DSM3_TOOL` and `DSM3_FILE_KEYS`, DSM3-goals' file conventions, for roots' `file` hints.
- **DSM3-goals' KAOS and NFR on the canvas** (issue #7). iStar 2.0 models render exactly as
  before (a snapshot of `modelToFlow` pins it).
  - **react:** the provider completes the registry for any root other than iStar 2.0, and
    `registryForMetamodel` keeps only the metamodel's kinds.
  - **react:** hubs of n-ary links draw with `HubComponent` and inspect with `HubInspector`, off
    the palette. Legs have no marker and ends draw like their link. Connecting with an n-ary
    kind creates a hub or adds a leg, puts the kind's property defaults on a new hub, and
    selects the hub.
  - **react:** new link kinds with `possibleLabels` get one palette entry per label.
  - **react:** links that target links end on the middle of their target link, through an anchor
    node shown while a link-targeting tool is active (`linkAnchorId`, `linkIdOfAnchor`,
    canvas class `is-linking-to-links`). The link inspector names a link target by its kind.
  - **react:** node kinds with `info.canBeOnPaper` are added outside actors.
  - **react:** `ShapeSpec` is core's `KindShape`; `PathShape` and palette icons draw its `dash`
    and `strokeWidth`. New `polygonPath(points)`.
  - **react:** `resolveLinkStyle` accepts a registry of any metamodel.
- **New packages: `@istar-ts/dsm3-kaos` and `@istar-ts/dsm3-nfr`** (issue #7). KAOS and the NFR
  Framework as DSM3-goals defines them. DSM3's example files open, render and save byte for
  byte. Design notes: `docs/dsm3-goals.md`.
  - **dsm3-kaos:** the `KAOS` root (`KAOS_DECLARATION`), with DSM3's rules and its n-ary
    refinement (`kaos.RefinementLinkHub` and its legs and end). Also property schemas for goals,
    the refinement (kept on its hub) and Conflict, DSM3's shapes (`KAOS_SHAPES`), the Conflict
    and Responsibility glyphs, and `kaosExtension`.
  - **dsm3-nfr:** the `NFR` root (`NFR_DECLARATION`), with DSM3's rules, the Argument link from a
    Claim to another link, `NFR_CONTRIBUTION_LABELS`, the cloud shapes (`NFR_SHAPES`) and
    `nfrExtension`.
  - **playground:** a "Frameworks" group in the switcher, the DSM3 examples, and `detectFramework`
    when opening a file.
  - The release workflow publishes the two new packages after core and react.

## 0.12.0

- **Diagnostics protocol** (goal-controller issue #24, option D). Findings about elements and links
  can now come from any number of analysers: LSP servers, validators, simulations. They are
  anchored by element id and are never serialized.
  - **core:** the `GoalDiagnostic` type (`elementId`, `key?`, `severity` including `'hint'`,
    `message`, `source?`, `range?`, `code?`, `data?`), plus `mergeDiagnostics` (union,
    deduplicated by `(elementId, key, message)`, worst severity kept), `groupDiagnostics` and
    `worstDiagnosticSeverity`.
  - **core:** `createDiagnosticsStore`, where `publish(source, list)` replaces one source's set and
    `clear(source?)` removes it.
  - **core adapters:** `fromLspDiagnostics` (`data.elementId` / `data.nodeId` / `data.key`, an
    `elementIdFor` for range-anchored diagnostics, VS Code severity numbering) and
    `fromNodeIdDiagnostics` (MutRoSe's `{ nodeId, severity, message }`).
  - **react:** `IstarCanvas` / `IstarProvider` take `diagnostics` (a store or a list) and
    `diagnosticBadges`. New hooks: `useGoalDiagnostics()` (merged list, `byElement`, `publish`,
    `clear`), `useElementDiagnostics(id)` and `useDiagnosticsStore()`.
  - **react:** components, inspectors and link labels receive `diagnostics`.
  - **react:** default components and link labels draw a severity badge. A badge your own
    component draws replaces it.
  - **react:** the default inspector shows element-level diagnostics at the top and property ones
    under their rows (exported as `DiagnosticList`).
  - **Compatibility:** `issues` / `ElementIssue` / `issuesById` are unchanged and merged with the
    rest. `ElementIssue` is the element-level subset (`issueToDiagnostic`, `diagnosticToIssue`).

## 0.11.0

- **A model's own metamodel (core):** files can declare their constructs in a top-level
  `"metamodel"` block (the `MetamodelExtension` shape, as JSON, with `shape` / `textBox` / `line`
  presentation hints).
  - `parsePistar(json, { fileMetamodel: true })` applies it on top of the host's metamodel.
  - `fileMetamodelOf(model)` returns it.
  - `withFileMetamodel(model, block)` adds or replaces constructs at run time.
  - `toPistar` writes the block byte for byte, unknown keys included.
  - `validateFileMetamodel` reports malformed blocks by path, and collisions throw
    `MetamodelError`.
  - Without the option, files read as before.
- **react:** kinds whose metamodel definition carries `shape`, `textBox` or `line` are drawn with
  them by default (registry overrides still win).

## 0.10.1

- **Fix:** label fitting ellipsized a too-wide header line (e.g. `<<utility-based>>`) at full size
  instead of shrinking it first, and `labelFit.minScale` had no effect on it. Header lines clip
  themselves, so the label never looked too wide. A header line that overflows on its own now
  counts, and refits (e.g. after a resize) measure without the previous ellipsis.

## 0.10.0

- **Label fitting (react):** per-kind `textBox` (where the label is laid out; `TEXT_BOXES` has
  insets per piStar shape), `labelHeader` (small italic lines above the name, such as «stereotype»
  or {tag = value}) and `labelFit`:
  - `'shrink'` (the default) leaves names that fit untouched. Overflowing names step down to
    `minScale`, then are ellipsized with the full text as the tooltip.
  - `'none'` does no fitting.
  - `'grow'` sets `display.height`, only after an edit, never on load.

  Exports `useFitText`, `LabelHeader`, `FittedLabel`, `FULL_TEXT_BOX` and `TEXT_BOXES`. Names that
  fit are laid out exactly as before.
- **Link `labelHeader`:** lines drawn above a link's default label. A `labelComponent` receives
  them as `labels.header`.
- **Fix:** link labels from a `labelComponent` were hidden under actor boundaries. React Flow's
  edge-label layer now sits above actors and below intentional elements, scoped to `.istar-canvas`.

## 0.9.0

- **Link labels (react):** a link kind can have a `labelComponent` (`LinkKindConfig`, settable
  through an `IstarExtension`, extended kinds included). It is drawn as HTML at the link's middle,
  replaces that kind's default labels, and receives them (`labels.fixed`, `.value`, `.name`) along
  with the link, model, metamodel and selection. Use it for piStar-ext's
  `<<stereotype>> {tag = value}`. Without one, links are labelled exactly as before.
- `<IstarCanvas linkNames />` draws each link's `name`. It is off by default, because piStar
  shows link names only in its properties panel.
- The default link inspector edits the link's name, as piStar's properties panel does.

## 0.8.1

- **Fix:** `isActor` and `isNode` take one argument again, as in 0.7.0. In 0.8.0 they gained an
  optional `metamodel` parameter, so `elements.filter(isActor)` passed the array index as a
  metamodel: a type error, and a crash for untyped callers. For extended actor and node kinds use
  the new `isActorIn(metamodel)` / `isNodeIn(metamodel)`, which return a predicate.
- `validateModel`, `elementIcon`, `dependencyIcon`, `paletteSections` and `paletteEntryFor` (which
  also gained optional parameters in 0.8.0) list their 0.7.0 signature last and ignore a stray
  non-object argument, so they too are safe as array callbacks.

## 0.8.0

- Extensible metamodel: new element and link kinds (`extendMetamodel`, `ISTAR_2_0`), threaded
  through serialization, constraints, operations, the store and the React editor. See "Extending
  the metamodel" in the package READMEs and `docs/metamodel-extensions.md`.
