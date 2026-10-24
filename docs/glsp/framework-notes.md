# GLSP framework notes

Research for [#74](https://github.com/vieirin/istar-ts/issues/74) (architecture: align with the
SoSyM GLSP reference architecture). Precise references into upstream GLSP source for the parts
of the framework that #74's later stages (S0–S4) need. **Code changes are out of scope for this
document.** Every item is marked:

- ✅ read in source — the path (and line, where useful) is given, and was spot-checked to exist
  at the commit below.
- ◐ inferred — general GLSP knowledge, a protocol-spec read, or a conclusion drawn from source
  that wasn't read line-by-line. Called out explicitly, never silently mixed with ✅.

## Sources and commits read

| Repo                                                                                             | Commit                                                                                       | Notes                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [eclipse-glsp/glsp-core](https://github.com/eclipse-glsp/glsp-core)                              | `b76da01d843f7256b3b54dff91f78bd8c307ded6` (`origin/main`, 2026-09-25, version `2.9.0-next`) | Primary source for sections 1–5. See **Version note** below.                                                                                                                                                                                       |
| [eclipse-glsp/glsp-core](https://github.com/eclipse-glsp/glsp-core)                              | `12b54a932f41f9f05c98126f85742c9a587f740c` (tag `v2.8.0`)                                    | Cross-checked: the pre-consolidation layout, matching the `@eclipse-glsp/server`/`@eclipse-glsp/client` `2.8.x` the epic's decision pins.                                                                                                          |
| [eclipse-glsp/glsp-examples](https://github.com/eclipse-glsp/glsp-examples)                      | `87151da9ebd0d5b1bc8b00eea532b4461a883be4` (`main`)                                          | `project-templates/node-json-{theia,vscode}` confirms the "minimal lineage" the issue refers to; not read beyond directory names.                                                                                                                  |
| [eclipse.dev/glsp/documentation/protocol/](https://eclipse.dev/glsp/documentation/protocol/)     | n/a (web page, fetched 2026-10-24)                                                           | Corroborates protocol version `1.0.0` and the `ActionMessage` envelope shape. Its own method list is imprecise (conflates the `process` method with the `requestModel` action); **the five-method list in §3 is from source, not from this page.** |
| `docs/papers/metin-bork-2025.md` (this repo, [#90](https://github.com/vieirin/istar-ts/pull/90)) | n/a (transcription of Metin & Bork, SoSyM 24(6), 2025, CC BY 4.0)                            | §4.1.2/Fig. 4 (manifests & contributions) and §5.1.1/Table 1/Table 2/Fig. 8 (BIGUML's concrete realization) back §7's manifest/contribution mapping.                                                                                               |

All file paths below are relative to the `glsp-core` repo root, at the `b76da01…` commit unless
marked `[v2.8.0]`.

### Version note — read this before trusting a path

`glsp-core` is mid-consolidation: several previously separate repos (`glsp-server`,
`glsp-client`, `glsp-protocol`, `glsp-graph`, `glsp-layout-elk`, and `glsp-playwright`) were
merged into one pnpm workspace. At `v2.8.0` the layout was already flat —
`packages/{client,glsp-sprotty,graph,layout-elk,protocol,server,server-mcp}` plus
`dev-packages/cli` — but **`e2e/playwright` did not exist in `glsp-core` yet**; it was a fully
separate repo, [eclipse-glsp/glsp-playwright](https://github.com/eclipse-glsp/glsp-playwright)
(latest tag `v2.7.0`, no `2.8.0` release). Between `v2.8.0` and `main` HEAD, commit `fe16735`
("GLSP-1682: Group packages and set up the consolidated pnpm workspace") did two more things at
once: it nested the flat packages under `packages/{client,common,server}/<name>` (e.g.
`packages/server/server`, `packages/common/protocol`), and it merged `glsp-playwright` in as
`e2e/playwright`. None of this is released yet (`2.9.0-next`).

This document uses **`main` HEAD paths** throughout (`packages/server/server/...`,
`packages/common/protocol/...`, `e2e/playwright/...`) because that is the only commit where
`e2e/playwright` actually lives inside `glsp-core`, matching the issue's own description of the
workspace layout. The _API surface_ described (DI bindings, operation handlers, actions,
GModel builders) did not change across this reorg — only file locations did. When wiring
`@istar-ts/glsp`'s actual `package.json` dependency, pin `@eclipse-glsp/server`/`@eclipse-glsp/client`
`^2.8.0` (released) per the epic's decision; the paths in this doc will need a one-time path
prefix fix once `2.9.0` (or later) is released and installed, not an API rewrite. ◐ (my own
synthesis of the two commits' diff, not a single upstream statement.)

---

## 1. Server module anatomy

### `DiagramModule` / `ServerModule` bindings

✅ `packages/server/server/src/common/di/diagram-module.ts:130-373` — `DiagramModule` is the
per-diagram-type DI module. Its `configure()` (lines 134-199) binds, in order: `DiagramType`,
`ClientId`, `DiagramConfiguration` (**required**, abstract `bindDiagramConfiguration()`),
`ClientActionForwarder`, `GModelSerializer`, `ModelState` (**required**, abstract
`bindModelState()`), `GModelIndex`, `SourceModelStorage` (**required**, abstract
`bindSourceModelStorage()`), `GModelFactory` (**required**, abstract `bindGModelFactory()`),
`ModelSubmissionHandler`, then _optional_ bindings (`applyOptionalBindingTarget`, each defaults
to `undefined` unless overridden): `ModelValidator`, `LabelEditValidator`,
`ToolPaletteItemProvider` (defaults to `DefaultToolPaletteItemProvider`, so not actually
`undefined` by default), `CommandPaletteActionProvider`, `ContextMenuItemProvider`,
`NavigationTargetResolver`, `PopupModelFactory`, `LayoutEngine`, `EdgeCreationChecker`. Then the
action/operation machinery: `ActionDispatcher`, the `ActionHandlerConstructor` multi-binding
(`configureActionHandlers`, lines 206-221, binds 14 built-in handlers — see §1 "action handlers"
below), `ActionHandlerFactory`, `ActionHandlerRegistry`, the `OperationHandlerConstructor`
multi-binding (`configureOperationHandlers`, lines 288-291, binds only
`CompoundOperationHandler` and `LayoutOperationHandler` — every create/delete/move handler is
diagram-specific and added by the subclass), `OperationHandlerRegistry`,
`OperationHandlerFactory`, `Operations` (derived: the list of bound operation types),
`CommandStack`. Three required abstract methods (`bindSourceModelStorage`, `bindModelState`,
`bindDiagramConfiguration`, `bindGModelFactory` — four, not three) must be implemented by every
diagram module; everything else has a working default or an `undefined` optional default.

✅ `packages/server/server/src/common/di/server-module.ts:46-122` — `ServerModule` is the
per-server (not per-diagram) DI module: `configureDiagramModule(diagramModule, ...additionalModules)`
(lines 61-68) registers a `DiagramModule` plus extra `ContainerModule`s (e.g. a layout module,
an MCP module — see the workflow example below) under its `diagramType`, stored in a
`Map<string, ContainerModule[]>`. `configure()` binds `GLSPServer` (default
`DefaultGLSPServer`), `ClientSessionFactory`, `ClientSessionManager`, the `GLSPServerListener` and
`GLSPServerInitializer` multi-bindings, `GlobalActionProvider`, and (if not already bound)
`InjectionContainer` as the current Inversify container.

◐ `client-session-module.ts` (same directory) was not read line-by-line; from the `DiagramModule`
doc comment ("Client session injectors are child injectors of a server injector") it is the glue
that creates one child container per `initializeClientSession` call, seeded with the matching
`DiagramModule`'s bindings plus a fresh `ModelState`/`ClientId`.

### `GModelFactory` and `ModelState`

✅ `packages/server/server/src/common/features/model/gmodel-factory.ts:18-60` —
`GModelFactory.createModel(): void` reads from the injected `ModelState` (typically holding the
loaded source model) and must call `this.modelState.updateRoot(newRoot)` (not shown in this
file, but documented: "produces a `GModelRoot`... and puts it into the `modelState`"). Invoked
after initial load and after every operation. `GModelFactoryNullImpl` (lines 55-60) is a no-op
for source models that already are the graph model.

✅ `packages/server/server/src/common/features/model/model-state.ts:23-101` — `ModelState` holds
`root: GModelRoot` (read-only getter; `updateRoot(newRoot)` is the only mutator, and it preserves
`revision` across updates, line 94-100), a string-keyed property bag (`set`/`get`/`setAll`/`clear`,
for ad hoc per-session data such as the loaded source model), `editMode`, `sourceUri`, `clientId`,
`isReadonly` (derived from `editMode === EditMode.READONLY`), and `index: GModelIndex` (the
id→element lookup `GModelFactory` is expected to populate via `index.indexRoot(newRoot)`, called
automatically inside `updateRoot`).

### `SourceModelStorage` (load and save)

✅ `packages/server/server/src/common/features/model/source-model-storage.ts:34-49` — two methods:
`loadSourceModel(action: RequestModelAction): MaybePromise<void>` (reads `action`'s options,
typically a `sourceUri` client option, and puts the loaded model into `ModelState`) and
`saveSourceModel(action: SaveModelAction): MaybePromise<void>` (persists from `ModelState`;
"Implementations are expected to throw an error if the save didn't work" — there is no boolean
return, failure is an exception).

### `DiagramConfiguration` (type hints, shape and edge hints, `animatedUpdate`, `needsClientLayout`, layout kind)

✅ `packages/server/server/src/common/diagram/diagram-configuration.ts:25-97` —
`ServerLayoutKind` enum: `AUTOMATIC` (server re-layouts on every change, overwriting stored
layout), `MANUAL` (only on an explicit `LayoutAction`), `NONE` (server never lays out; layout
must be stored in the model). `DiagramConfiguration` interface: `shapeTypeHints:
ShapeTypeHint[]`, `edgeTypeHints: EdgeTypeHint[]`, `layoutKind: ServerLayoutKind`,
`needsClientLayout: boolean` (if `true`, the client computes and reports bounds back via
`RequestBoundsAction`/`ComputedBoundsAction` before the model is actually sent — see
`ModelSubmissionHandler.submitModel`, below), `animatedUpdate: boolean` (client-side animation
flag for `UpdateModelAction`), `typeMapping: Map<string, GModelElementConstructor>` (type string
→ constructor, for deserializing `GModelElementSchema` JSON back into typed `GModelElement`
instances — see `getDefaultMapping()`).

Concrete example, ✅ `examples/workflow-server/src/common/workflow-diagram-configuration.ts:32-79`:
`typeMapping` starts from `getDefaultMapping()` (`packages/server/graph/src/default-types.ts:31-50`)
and adds the diagram's own type strings. `shapeTypeHints`/`edgeTypeHints` use helper factories
(`createDefaultShapeTypeHint`/`createDefaultEdgeTypeHint`, same file, lines 81-118) that default
`repositionable`/`deletable`/`resizable`/`reparentable`/`routable` to `true` and let a template
override per type — e.g. `{ elementTypeId: types.CATEGORY, containableElementTypeIds: [...] }`,
or a **dynamic** edge hint (`dynamic: true`) that defers the actual validity check to an
`EdgeCreationChecker` (§1, below) instead of a plain source/target type-id allowlist. This example
uses `layoutKind = ServerLayoutKind.MANUAL`, `needsClientLayout = true`, `animatedUpdate = true`.

### `OperationHandler` and its registry

✅ `packages/server/server/src/common/operations/operation-handler.ts:30-83` —
`abstract class OperationHandler`: `operationType: string` (abstract), optional `label`,
`handles(operation)` default implementation checks `modelState.root && operation.kind ===
this.operationType` (line 71-73 — note: a handler with no loaded root never handles anything),
`execute(operation)` calls `handles` then delegates to the abstract `createCommand(operation):
MaybePromise<Command | undefined>`. Returning `undefined` from `createCommand` means "no
change, do nothing" — not an error.

✅ `packages/server/server/src/common/operations/operation-action-handler.ts:28-94` —
`OperationActionHandler` is itself an `ActionHandler` (bound once per `DiagramModule`, handling
every operation kind registered via `Operations`). `execute(action)`: if
`modelState.isReadonly`, returns a `MessageAction.create(..., { severity: 'WARNING' })` instead
of running the operation (§1 "reporting failure", below) — readonly is enforced centrally, not
per-handler. Otherwise looks up the `OperationHandler` via `OperationHandlerRegistry
.getOperationHandler(operation)`, runs it, and if it returned a `Command`, executes that command
on the `CommandStack` (line 76: `this.commandStack.execute(command)`) and then calls
`ModelSubmissionHandler.submitModel('operation')` to produce the update actions. If no handler
matched (none registered for that `operation.kind`+conditions), returns `[]` silently — **not**
an error; only a totally unregistered action _kind_ throws (see `ActionDispatcher`, below).

◐ `operation-handler-registry.ts` was not read line-by-line; from its usage
(`OperationHandlerRegistry.getOperationHandler(operation)`, `OperationHandlerRegistryInitializer`
added as a `ClientSessionInitializer` in `DiagramModule.configureClientSessionInitializers`)
it's a per-session registry populated at session-open from the `OperationHandlerConstructor`
multi-binding, that picks the first handler whose `handles()` returns true for the dispatched
operation.

### `CommandStack` and undo/redo

✅ `packages/server/server/src/common/command/command-stack.ts:21-160` — `CommandStack` is a
classic linear undo/redo list of `Command` objects (not a stack of model snapshots): `execute`
pushes a command and truncates any old redo tail (lines 96-99), `undo`/`redo` move a `top`
cursor and call `command.undo()`/`command.redo()`, `isDirty` compares `top` to a `saveIndex` set
by `saveIsDone()` (called after a successful save), and — important for the undo-conflict
discussion in §7 — **if `command.execute()` throws, the entire stack is flushed** (`handleError`,
lines 154-159): there is no partial-failure recovery, a broken command wipes all history.
`DefaultCommandStack` is the only implementation shipped; nothing stops a diagram module from
binding a different `CommandStack` (`DiagramModule.bindCommandStack()`, overridable, defaults to
`DefaultCommandStack`).

✅ `packages/server/server/src/common/command/undo-redo-action-handler.ts:23-57` —
`UndoRedoActionHandler` is the thin bridge from the wire actions `UndoAction`/`RedoAction` to
`CommandStack.undo()`/`redo()`, followed by `ModelSubmissionHandler.submitModel('undo'|'redo')`
if the stack reports `canUndo()`/`canRedo()`. **This is the only way GLSP's undo protocol
actions reach the stack — there is no interface seam for delegating undo to an external store**;
a custom `CommandStack` implementation (bound via `DiagramModule.bindCommandStack()`) is the only
extension point. See §7 for how `@istar-ts/glsp` should use this.

### `ToolPaletteItemProvider`, `EdgeCreationChecker`, `ModelValidator`

✅ `packages/server/server/src/common/features/contextactions/tool-palette-item-provider.ts:34-88`
— abstract `ToolPaletteItemProvider` is a `ContextActionsProvider` whose fixed `contextId` is
`'tool-palette'` (line 38-40); it turns `getItems(args): PaletteItem[]` into `LabeledAction[]`.
`DefaultToolPaletteItemProvider` (lines 61-88) derives the palette automatically from every bound
`CreateOperationHandler` (a specialization of `OperationHandler` not shown here, but
distinguished by `CreateOperationHandler.is(handler)`), grouping into a `'Nodes'` and an
`'Edges'` top-level `PaletteItem`, and using each handler's `getTriggerActions()` for the
leaf `triggerNodeCreation`/`triggerEdgeCreation` actions. A diagram module can override
`bindToolPaletteItemProvider()` to replace this with a hand-written palette (e.g. with custom
grouping, icons, or sort order), or leave the default to get "the palette follows whatever
create-operation-handlers are bound" for free.

✅ `packages/server/server/src/common/features/type-hints/edge-creation-checker.ts:27-44` —
`EdgeCreationChecker.isValidSource(edgeType, sourceElement): boolean` and
`isValidTarget(edgeType, sourceElement, targetElement): boolean`, consulted only for edge type
hints marked `dynamic: true` (§1 "DiagramConfiguration" above); for non-dynamic hints the client
checks the allowlists itself and never asks the server.

✅ `packages/server/server/src/common/features/validation/model-validator.ts:27-106` —
`ModelValidator.validate(elements, reason?): MaybePromise<Marker[]>`.
`AbstractModelValidator` (lines 38-106) recurses into `element.children` automatically (so
override the three `do*Validation` hooks, not `validate` itself) and dispatches by `reason`:
`MarkersReason.LIVE` (debounced, after every operation — see `ModelSubmissionHandler.
performLiveValidation`, 100 ms by default), `MarkersReason.BATCH` (on-demand, can be expensive),
or any other custom string (adopter-defined validation triggers).

### Action handlers for `requestContextActions`, `requestTypeHints`, `requestCheckEdge`

✅ `packages/server/server/src/common/features/contextactions/request-context-actions-handler.ts:21-37`
— `RequestContextActionsHandler.execute` looks up a `ContextActionsProvider` in the
`ContextActionsProviderRegistry` by `action.editorContext.contextId` (`'tool-palette'` is the
built-in one; command palette and context menu are others, registered the same way) and returns
`SetContextActions.create(actions, { args: action.editorContext.args })`. An unregistered
`contextId` silently returns an empty action list, not an error.

✅ `packages/server/server/src/common/features/type-hints/request-type-hints-action-handler.ts:22-35`
— trivial: `SetTypeHintsAction.create({ shapeHints: diagramConfiguration.shapeTypeHints,
edgeHints: diagramConfiguration.edgeTypeHints })`. No filtering, no computation — whatever
`DiagramConfiguration` returns is sent verbatim.

✅ `packages/server/server/src/common/features/type-hints/request-check-edge-action-handler.ts:24-62`
— only calls into `EdgeCreationChecker` if the edge type hint for `action.edgeType` has
`dynamic: true` (line 39); otherwise `isValid` defaults to `true` unconditionally (line 41) —
i.e. for non-dynamic hints, **the server trusts the client's own allowlist check and doesn't
re-verify**. Throws `GLSPServerError` if `sourceElementId`/`targetElementId` don't resolve in
`ModelState.index`.

✅ The client side of a dynamic hint (`@eclipse-glsp/client` 2.8.0,
`lib/features/tools/edge-creation/edge-creation-tool.js`, `EdgeCreationToolMouseListener`):
`mouseOver` calls `canConnect`, which for a `dynamic` hint sends `requestCheckEdge` and returns
`false` until `checkEdgeTargetResult` arrives ("Temporarily mark the target as invalid while we
wait for the server response, so a fast-clicking user doesn't get a chance to create the edge in
the meantime"). `nonDraggingMouseUp` only takes a click when `this.currentTarget &&
this.allowedTarget`, and only then sends `createEdge`. So a click whose own pointer move starts
the check is dropped, and a refused target is never sent: the client reads `isValid` only, not
an istar-ts `reason`. `@istar-ts/glsp` therefore sends static edge hints and lets `createEdge`'s
rejection carry the reason (#105, its README). The edge-edit (reconnect) tool never asks
`requestCheckEdge`; it reads an edge's `repositionable` as `reconnectFeature`
(`ApplyTypeHintsCommand.applyEdgeTypeHint`), and reconnects by click: the handle, then the new
end (a drag resets the candidate end on every move).

### How a handler reports a failure to the client

◐/✅ Three distinct mechanisms, confirmed in source, not unified:

1. **`MessageAction`** (toast/notification, no model change) — e.g.
   `OperationActionHandler.execute` for the readonly case
   (`packages/server/server/src/common/operations/operation-action-handler.ts:48-53`):
   `MessageAction.create(message, { severity: 'WARNING' })`. ◐ the `MessageAction` type itself
   lives in `@eclipse-glsp/protocol` and was not read line-by-line, but its shape (`message`,
   `severity: 'INFO'|'WARNING'|'ERROR'|'FATAL'|'NONE'`) is used consistently across the handlers
   read above.
2. **Markers** (`SetMarkersAction`) — validation issues attached to specific elements, via
   `ModelValidator`/`ModelSubmissionHandler.performLiveValidation`
   (`packages/server/server/src/common/features/model/model-submission-handler.ts:183-190`).
   This is the closest GLSP equivalent to istar-ts's `GoalDiagnostic`; see §7.
3. **`RejectAction`** (`kind: 'rejectRequest'`) — ✅
   `packages/common/protocol/src/action-protocol/base-protocol.ts:155-183`. This is a
   **transport-level** response to a malformed or unroutable _request_ (e.g. a `requestId` with
   no matching pending request, or an explicit throw inside a request handler that the
   `ActionDispatcher` turns into a reject — see `DefaultActionDispatcher.doRequest`,
   `packages/server/server/src/common/actions/action-dispatcher.ts:387-391`: a `RejectAction`
   rejects the pending `Promise` with an `Error`). **There is no `RejectAction` equivalent for
   operations** — an `Operation` that an `OperationHandler` silently declines to handle (returns
   `undefined` from `createCommand`) just produces no model change and no client-visible
   feedback at all, other than whatever `MessageAction`/marker the handler chooses to add itself.
   This is the "GLSP operations are fire-and-forget" gap `docs/action-protocol.md` already
   documents from the istar-ts side.

---

## 2. GModel

✅ `packages/server/graph/src/gmodel-element.ts:33-?` — `GModelElement` base: `type: string`
(view lookup + serialization discriminator), `id: string` (must be unique across the whole
model; duplicates are a _rendering-phase_ error, not caught at construction), `cssClasses:
string[]`, `children: GModelElement[]` (containment — this _is_ how nesting/parenting is
serialized: a plain nested-array JSON tree, not parent-id references), and a `parent` back-link
maintained automatically. `GModelRoot` (same file, used as the root class by `GGraph`) is the
only kind of element allowed with no parent.

✅ Concrete builders, each `extends GModelElementBuilder`/`GShapeElementBuilder` with a
fluent `.id().type().add(child)...build()` API:

- `GGraph` (`packages/server/graph/src/ggraph.ts:27-62`) — the root, `type = 'graph'`
  (`DefaultTypes.GRAPH`), has `position`/`size`/`layoutOptions` (it implements `GBoundsAware`
  and `GLayoutable`).
- `GNode` (`gnode.ts:21-41`) — `type = 'node'` (`DefaultTypes.NODE`), extends `GShapeElement`
  (so has `position: Point`, `size: Dimension`, `layoutOptions?: Args`, `resizeLocations?`), and
  implements `GEdgeLayoutable` + `GLayouting` (optional `layout?: string`, e.g. `'vbox'`/`'hbox'`/
  `'freeform'` — a Sprotty client-side layout algorithm name, resolved client-side, not by the
  server unless `ServerLayoutKind.AUTOMATIC`/`MANUAL` with a `LayoutEngine` is configured).
- `GEdge` (`gedge.ts:19-81`) — `type = 'edge'` (`DefaultTypes.EDGE`), `sourceId`/`targetId`
  (string ids, resolved against the client's rendered elements — **not** object references on
  the wire), `routingPoints: Point[]`, optional `routerKind`.
- `GLabel` (`glabel.ts:22-50`) — `type = 'label'` (`DefaultTypes.LABEL`), `text: string`,
  `alignment: Point`, implements `GAlignable` + `GEdgeLayoutable` (so a label can be placed
  relative to an edge, e.g. a dependency's "D" or a contribution's label).
- `GCompartment` (`gcompartment.ts:20-34`) — `type = 'comp'` (`DefaultTypes.COMPARTMENT`),
  a layout-only grouping container (`layout?: string`), no own rendering — used for structuring
  a node's children (e.g. an icon + header row, a resizable body).
- `GPort` (`gport.ts:20-26`) — `type = 'port'` (`DefaultTypes.PORT`), a `GShapeElement` with no
  extra fields; an edge-anchor point on a node, not used by every diagram language.

✅ Type-string convention — `packages/common/protocol/src/model/default-types.ts:20-52`:
built-ins are bare kebab/colon strings (`'graph'`, `'node'`, `'edge'`, `'port'`, `'label'`,
`'comp'`, `'comp:header'`), and the **shape sub-kind convention is `'node:<shape>'`** (the file
defines `'node:circle'`, `'node:rectangle'`, `'node:diamond'` as the only three built-in
examples). A diagram module is free to invent its own type strings as long as a) they're
registered in `DiagramConfiguration.typeMapping` for server-side deserialization and b) the
client has a matching `configureModelElement(context, type, modelClass, viewClass)` registration
(§4). The workflow example's own types
(`examples/workflow-server/src/common/util/model-types.ts`, not read in full, used via `types.*`
in the excerpts above) follow the same `kind:subkind` shape (e.g. `types.LABEL_HEADING`,
`types.WEIGHTED_EDGE`), confirming this is convention, not an enforced rule.

✅ Layout options example — `examples/workflow-server/src/common/graph-extension.ts:52,82,123,164`
— `layout('vbox')`/`layout('hbox')`/`layout('freeform')` plus `addLayoutOptions({ hAlign:
'center', hGrab: false, vGrab: false })` / `{ hAlign: 'left', hGrab: true, vGrab: true }`. These
option keys (`hAlign`, `hGrab`, `vGrab`, and elsewhere `paddingRight`, a corner-radius `Args`
helper `ArgsUtil.cornerRadius(5)`) are **Sprotty client-side layout engine** parameters, not
server-computed bounds — consistent with `needsClientLayout: true` in the matching
`DiagramConfiguration`.

### Containment and size/position serialization

✅ `children` is a plain array nested inside the parent's JSON object (no separate edge/parent-id
table) — this is visible directly in the `GModelElement` field above and in every builder's
`.add(child)` call. `position`/`size` are plain `{x,y}`/`{width,height}` objects on the element
itself (`GShapeElement`, `gshape-element.ts:22-30`), present even when `needsClientLayout: true`
— in that case the server-sent value is a _hint_ the client may recompute and report back (see
"how `updateModel` is triggered" below), not authoritative.

### How `updateModel` is triggered after a command

✅ `packages/server/server/src/common/features/model/model-submission-handler.ts:120-169` —
`ModelSubmissionHandler.submitModel(reason?, layout?)` is the single chokepoint every mutating
action handler calls after changing the model (`OperationActionHandler.submitModel`,
`UndoRedoActionHandler.undo`/`redo`, `RequestModelActionHandler` for the initial load). It always
calls `GModelFactory.createModel()` first (line 121), bumps `ModelState.root.revision`, then
branches:

- if `DiagramConfiguration.needsClientLayout` is `true` (the common case): returns
  `[RequestBoundsAction.create(root), SetDirtyStateAction.create(...)]` — the server does _not_
  send `UpdateModelAction` directly; it asks the client to compute bounds first
  (`RequestBoundsAction` → client replies `ComputedBoundsAction` →
  `ComputedBoundsActionHandler`, bound in every `DiagramModule`, line 220 of
  `diagram-module.ts` — not read in full, but its presence in the default action-handler list
  confirms this round trip is unconditional when `needsClientLayout` is set).
- otherwise: `submitModelDirectly()` — runs the `LayoutEngine` if `ServerLayoutKind.AUTOMATIC`,
  serializes, and sends either `SetModelAction` (first load, matching a pending
  `RequestModelAction`'s `requestId` as `responseId`) or `UpdateModelAction` (every subsequent
  change, with `animate: diagramConfiguration.animatedUpdate`).

This means: **for a diagram module with `needsClientLayout: true` (the default most examples
use), a single operation does not produce one `UpdateModelAction` — it produces a
`RequestBoundsAction`/`ComputedBoundsAction` round trip that only then yields the update.** This
matters for #74's `modelToGModel`/`updateModel`-push plan: `@istar-ts/glsp` can sidestep the
round trip entirely by setting `needsClientLayout: false` (the epic's own plan already says
"Sizes come from kind defaults, so no `requestBounds` round trip is needed" — this confirms that
decision is the right lever, not an incidental detail).

---

## 3. Lifecycle and transport

### The five JSON-RPC methods and `ActionMessage`

✅ `packages/common/protocol/src/client-server-protocol/glsp-server.ts:26-109` — `GLSPServer`
interface, five methods, exactly matching `docs/action-protocol.md`'s own list:

```ts
interface GLSPServer {
  initialize(params: InitializeParameters): Promise<InitializeResult>;
  initializeClientSession(params: InitializeClientSessionParameters): Promise<void>;
  disposeClientSession(params: DisposeClientSessionParameters): Promise<void>;
  process(message: ActionMessage): void;
  shutdown(): void;
}
```

`initialize` must be the first call; subsequent calls with the same `applicationId`/
`protocolVersion` resolve to the original `InitializeResult` (idempotent), a mismatch rejects.
`process` is the one-envelope-for-everything method: every action, in both directions, after
init, goes through `process`/the matching client-side `GLSPClientProxy.process`. ✅ protocol
version constant: `packages/common/protocol/src/client-server-protocol/glsp-client.ts:176` —
`export const protocolVersion = '1.0.0';`.

✅ `ActionMessage` shape — `packages/common/protocol/src/action-protocol/base-protocol.ts:53-70`:

```ts
interface ActionMessage<A extends Action = Action> {
  clientId: string;
  action: A;
}
```

✅ `RejectAction` shape, same file, lines 155-183:

```ts
interface RejectAction extends ResponseAction {
  kind: 'rejectRequest';
  message: string;
  detail?: string;
}
```

### Server-side launchers

✅ Node socket/WebSocket — `examples/workflow-server/src/node/app.ts:1-61`. Both launchers come
from `@eclipse-glsp/server/node`: `SocketServerLauncher` (plain TCP/stdio-ish socket,
`launcher.start({ port, host })`) and `WebSocketServerLauncher`
(`launcher.start({ port, host, path: 'workflow' })`). Both take the same
`launcher.configure(serverModule, ...additionalModules)` call, so switching transport is a CLI
flag (`options.webSocket`), not a different server wiring. `reflect-metadata` is imported as the
very first line of the file (`import 'reflect-metadata';`) — required before any Inversify
`@injectable()`/`@inject()` decorator runs; see §8 risk table.

✅ Browser worker launcher — `examples/workflow-server/src/browser/app.ts:1-54`. Uses
`WorkerServerLauncher` from `@eclipse-glsp/server/browser` (a separate subpath export from the
Node one — the package has Node- and browser-specific entry points) and
`createAppModule({ logLevel })` (browser variant). The whole server — DI container, diagram
modules, layout engine configured with `isWebWorker: true`, an MCP bridge
(`McpWorkerBridge`) — runs **inside a Web Worker**, with `launcher.start({})` resolving only when
the worker's connection closes (comment at line 49: "Resolves only on connection close — must be
the last await"). This is the exact file that `examples/workflow-server-bundled-web` bundles
into a single `wf-glsp-server-webworker.js` (✅ confirmed via its `package.json`: `"main":
"./wf-glsp-server-webworker.js"`, built by `pnpm -C ../workflow-server build`).

### How a page connects to the worker

✅ `examples/workflow-standalone/src/browser/app.ts:1-44` — the client-side counterpart:

```ts
const workerProvider = new GLSPWebWorkerProvider('wf-glsp-server-webworker.js');
workerProvider.listen({ onConnection: initialize, logger: console });

async function initialize(connectionProvider: MessageConnection): Promise<void> {
  glspClient = new BaseJsonrpcGLSPClient({ id, connectionProvider });
  container = createContainer({
    clientId,
    diagramType,
    glspClientProvider: async () => glspClient,
    sourceUri: 'example1.wf',
  });
  await container.get(DiagramLoader).load();
}
```

`GLSPWebWorkerProvider` (from `@eclipse-glsp/client`) wraps a `new Worker(url)` and a
`vscode-jsonrpc` `MessageConnection` over `postMessage`/`onmessage`, so the JSON-RPC framing is
identical to the Node socket/WebSocket path — only the transport underneath differs. This is
the template for a browser-only istar-ts+GLSP demo with no server process at all.

### The startup sequence a standalone client sends

✅ `packages/client/client/src/base/model/diagram-loader.ts:176-234` —
`DiagramLoader.load(options)`, numbered as the actual call sequence in code:

1. Run every registered `IDiagramStartup.preLoadDiagram()` hook (sorted by `rank`).
2. `actionDispatcher.initialize?.()`.
3. Run `preInitialize()` hooks.
4. **`initialize`**: if the `GLSPClient` has no cached `initializeResult` yet, call
   `glspClient.initializeServer({ applicationId, protocolVersion: '1.0.0', ... })`
   (`initialize()` JSON-RPC method).
5. **`initializeClientSession`**: `GLSPModelSource.configure(glspClient)` calls
   `glspClient.initializeClientSession(...)` (✅ confirmed via
   `packages/client/client/src/base/model/glsp-model-source.ts:126-140`, not read in full but the
   call is unambiguous at line 140).
6. Run `preRequestModel()` hooks.
7. **`process` / `requestModel`**: dispatch `RequestModelAction.create({ options: { sourceUri,
diagramType, ... }, requestId })` — this is an `Action` sent via the `process` method, _not_
   a sixth JSON-RPC method.
8. Run `postRequestModel()` hooks (fired right after the request is dispatched, _not_ after the
   server's reply arrives).
9. Await `ModelInitializationConstraint.onInitialized()` — resolves once the matching
   `SetModelAction` response has actually been applied client-side.
10. Run `postModelInitialization()` hooks.

`disposeClientSession` and `shutdown` are not part of this startup sequence — they're called on
diagram-close/application-close respectively, not read in further detail here (out of scope for
a startup-sequence listing).

---

## 4. Standalone client

### Container construction, `configureDefaultModelElements`

✅ `examples/workflow-standalone/src/common/di.config.ts:36-53` —
`createContainer(options)` builds an Inversify `Container` via `createWorkflowDiagramContainer`
(diagram-specific factory, below), passing: `createDiagramOptionsModule(options)` (binds
`IDiagramOptions` — `clientId`, `diagramType`, `glspClientProvider`, `sourceUri`, `editMode`),
an object `{ add: [...feature modules], remove: toolPaletteModule }` (the standalone app adds
task-editing/accessibility/title-bar/context-menu/window-resize modules and _removes_ the
tool-palette module — standalone drops the palette UI that an IDE host would provide
differently), and `STANDALONE_MODULE_CONFIG` (a constant from `@eclipse-glsp/client`, not read in
detail — bundles whatever "pure browser, no IDE host" wiring the framework needs, by name alone
it is the standalone-specific counterpart to a Theia/VS Code module set).

✅ `examples/workflow-glsp/src/workflow-diagram-module.ts:59-99` — the actual
`FeatureModule` a diagram language provides. The pattern:

```ts
configureDefaultModelElements(context); // binds every built-in type (graph, node, edge, label, comp, port...)
configureModelElement(context, 'task:automated', TaskNode, RoundedCornerNodeView);
configureModelElement(context, 'label:heading', GLabel, GLabelView, { enable: [editLabelFeature] });
overrideModelElement(context, DefaultTypes.EDGE, GEdge, WorkflowEdgeView); // replace a *default* type's view
configureModelElement(context, 'edge:weighted', WeightedEdge, WorkflowEdgeView);
overrideModelElement(context, DefaultTypes.GRAPH, GGraph, GLSPProjectionView);
```

`configureDefaultModelElements(context)` must run **before** any `configureModelElement` calls
for custom types (it's called first in the snippet above) — it's what registers the built-in
type strings (`'graph'`, `'node'`, `'edge'`, `'label'`, `'comp'`, `'port'`, etc.) to their stock
model classes and views. `configureModelElement(context, type, ModelClass, ViewClass, options?)`
registers a **new** type string; `overrideModelElement(context, type, ModelClass, ViewClass)` is
the same call for a type `configureDefaultModelElements` already registered (i.e. replacing the
Sprotty default edge/graph view, not adding a new type).

### Default views, registering a custom view

◐ The built-in view classes referenced above (`RectangularNodeView`, `RoundedCornerNodeView`,
`DiamondNodeView`, `GLabelView`, `GCompartmentView`, `StructureCompartmentView`,
`GLSPProjectionView`) were seen only as imports from `@eclipse-glsp/client` in
`workflow-diagram-module.ts`, not read at their definitions — their names and usage pattern
(`configureModelElement(context, type, ModelClass, ViewClass, featureOptions?)`) are ✅ confirmed,
their internal rendering logic is not. A custom view for a new type is: write a class
implementing Sprotty's `IView` (`render(model, context): VNode`), then
`configureModelElement(context, 'my:type', MyModelClass, MyView)`.

### Connecting to a worker or a WebSocket

✅ Worker: see §3 "How a page connects to the worker" (`GLSPWebWorkerProvider` + `BaseJsonrpcGLSPClient`).
◐ WebSocket: not read in a standalone-client example (the repo's `workflow-standalone` only
demonstrates the worker path); by analogy with the server-side `WebSocketServerLauncher` and the
`vscode-jsonrpc`-based `BaseJsonrpcGLSPClient` constructor (`{ id, connectionProvider }`) the
client-side counterpart is a `vscode-jsonrpc` `MessageConnection` created over a `WebSocket`
instead of a `Worker`'s `postMessage`, handed to the same `BaseJsonrpcGLSPClient`. Not verified
against a concrete file.

### Minimum dependencies and bundler notes

✅ `examples/workflow-standalone/package.json` — runtime deps: `@eclipse-glsp/client`,
`reflect-metadata`, `vscode-jsonrpc`; dev-only: `esbuild`, `inversify` (listed as a _dev_
dependency here specifically because `@eclipse-glsp/client` declares it as a peer dependency —
the app must supply its own compatible `inversify` version). **Upstream's own `workflow-standalone`
example is bundled with `esbuild`, not Vite** — there is no Vite usage anywhere in `glsp-core`
(confirmed by `grep -rl '"vite"' examples dev-packages --include=package.json`: no hits). The
brief's "Vite" ask cannot be answered from upstream source; the following is ◐ general knowledge
about Inversify + Vite, not glsp-core-sourced: Inversify 6.x uses legacy (`experimentalDecorators`)
decorators and `reflect-metadata` for constructor-parameter type reflection; Vite's dev server
(esbuild-based transform) supports `experimentalDecorators` but not `emitDecoratorMetadata`
reliably across all injection patterns unless `@swc/plugin-transform-legacy-decorator` or
`vite-plugin-inversify`-style tooling is added, and `reflect-metadata` must be imported exactly
once, early, before any decorated class is evaluated (a common Vite pitfall is it being
tree-shaken or re-ordered by code-splitting). See §8 for how this interacts with istar-ts's own
tooling.

---

## 5. `server-mcp`

✅ How a server opts in — `examples/workflow-server/src/common/mcp/workflow-mcp-diagram-module.ts:1-39`
and `examples/workflow-server/src/node/app.ts:43-48`. A diagram module gets MCP by adding a
_second_ `ContainerModule` alongside the `DiagramModule` in `configureDiagramModule(...)`:

```ts
const serverModule = new WorkflowServerModule().configureDiagramModule(
  new WorkflowDiagramModule(() => GModelStorage),
  new ElkLayoutModule({ algorithms: ['layered'], layoutConfigurator: WorkflowLayoutConfigurator }),
  new WorkflowMcpDiagramModule(), // <- this is the opt-in
);
```

`WorkflowMcpDiagramModule extends DefaultMcpDiagramModule` (from `@eclipse-glsp/server-mcp`),
overriding only `bindLabelProvider`/`bindModelSerializer`/`bindElementTypesProvider` to plug in
diagram-specific knowledge of where labels live and how to serialize for an LLM. At the
_server_ level (not diagram level), a separate `WorkflowMcpServerModule` and
`node-mcp-server-launcher`/`web-mcp-server-launcher` wire up the actual MCP transport (not read
in detail here — out of scope for #74, which targets the GLSP wire protocol, not MCP).

✅ What the module needs from the `DiagramModule` —
`packages/server/server-mcp/src/common/modules/mcp-diagram-module.ts:91-236`:
`AbstractMcpDiagramModule.configure()` binds, **per client session** (it is itself loaded inside
`configureDiagramModule`, so it shares the diagram session's container): `McpIdAliasService`,
`McpLabelProvider`, `McpModelSerializer`, `ElementTypesProvider`, and three
`InstanceMultiBinding`s of handler constructors (tool/resource/prompt), each with its own
`Registry`/`Factory`/`RegistryInitializer` triad following the exact same pattern as
`OperationHandlerRegistry` in `DiagramModule` (§1) — confirming MCP handlers are _not_ special,
they're session-scoped multi-bindings resolved against the live `ClientSession.container` just
like operation handlers. `@experimental` is on the class doc comment (lines 243-246): "Option
names, schema shapes, and handler contracts MAY change in minor releases" — a direct risk, see
§8.

✅ The tool list — default `configureToolHandlers` (lines 202-220):
`CreateNodesMcpToolHandler`, `CreateEdgesMcpToolHandler`, `DeleteElementsMcpToolHandler`,
`SaveModelMcpToolHandler`, `ValidateDiagramMcpToolHandler`, `DiagramModelMcpToolHandler`,
`QueryElementsMcpToolHandler`, `CountElementsMcpToolHandler`, `ModifyNodesMcpToolHandler`,
`ModifyEdgesMcpToolHandler`, `UndoMcpToolHandler`, `RedoMcpToolHandler`,
`GetSelectionMcpToolHandler`, `SetSelectionMcpToolHandler`, `SetViewMcpToolHandler`,
`LayoutMcpToolHandler` (self-skips via `isSupportedByDiagramType()` when no `LayoutEngine` is
bound — the one handler that's conditional on diagram capabilities, not just always-on). Default
resource handlers: `DiagramPngMcpResourceHandler`, `DiagramSvgMcpResourceHandler`. Default prompt
handlers: none at the diagram scope (two diagram-type-agnostic prompts —
`describe-diagram`, `suggest-improvements` — are bound server-scope instead, per the comment at
line 230).

---

## 6. `e2e/playwright`

### Page objects and capabilities

✅ `e2e/playwright/src/glsp/app/app.po.ts:83-162` — `GLSPApp` is the framework's entry point,
constructed in one of two modes (`GLSPAppOptions`, a discriminated union on `type`):

- `{ type: 'page', page: Page }` — plain Playwright `Page`, used against a standalone/browser
  app with no IDE host.
- `{ type: 'integration', integration: Integration }` — an `Integration` abstraction (not read
  in detail; the constructor comment shows it supplies `integration.page` and
  `integration.prefixRootSelector(selector)`, implying IDE-hosted modes — Theia/VS Code webview —
  need a selector prefix the plain page mode doesn't) that also optionally supplies a
  `contextMenuLocator` if it implements `ContextMenuIntegration`.

`GLSPApp`'s constructor immediately builds every page object off the same root locator:
`graph` (a `GLSPSemanticGraph`, i.e. `GLSPGraph` — nodes/edges/labels by id or type),
`labelEditor`, `toolPalette`, `popup`, `globalCommandPalette`, `contextMenu` (or
`GLSPContextMenuNotSupported` if the integration doesn't support one). The root selector
defaults to `'body'` and narrows to `div.sprotty:not(.sprotty-hidden)` — i.e. it specifically
locates the live (non-hidden) Sprotty diagram widget, which matters when several diagram
instances/tabs exist in the same page (IDE host case).

### Configuring `GLSPApp` against a standalone app

✅ `e2e/workflow-e2e/tests/workflow.spec.ts:1-18` is the entire upstream spec file for the
workflow example: `defineStandaloneWorkflowSuites(test)` — a shared suite-definition function
(not read in detail; lives in `e2e/workflow-e2e/src/index.ts`) that is handed the Playwright
`test` fixture and presumably constructs `new GLSPApp({ type: 'page', page })` internally against
a `page`-mode `fixture.config` (webserver config — `e2e/workflow-e2e/configs/webserver.config.ts`,
not read — almost certainly a `playwright.config.ts` `webServer` entry that starts the standalone
build and points Playwright's `baseURL` at it). This is the "**page mode**" story: for a
`@istar-ts/glsp` cross-client e2e (S4 in the epic), the equivalent is pointing a Playwright
`webServer` at whatever dev server serves `examples/glsp-client`'s built standalone app, then
`new GLSPApp({ type: 'page', page })`.

### SVG metadata attributes it relies on

✅ Written by the **client**, not the test framework —
`packages/client/client/src/features/svg-metadata/metadata-placer.ts:26-45`
(`MetadataPlacer implements IVNodePostprocessor`, a Sprotty VDOM decorator run on every render):

| Attribute                          | Present on                             | Value                                                                         |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `data-svg-metadata-api`            | the `GModelRoot`'s SVG element only    | `true` (a marker that this diagram was rendered with metadata support at all) |
| `data-svg-metadata-type`           | every element                          | `element.type` (the GLSP type string, e.g. `'node'`, `'task:automated'`)      |
| `data-svg-metadata-parent-id`      | every non-root (`GChildElement`)       | the DOM id of `element.parent`                                                |
| `data-svg-metadata-edge-source-id` | `GEdge` elements, if `source` resolved | the DOM id of the edge's source element                                       |
| `data-svg-metadata-edge-target-id` | `GEdge` elements, if `target` resolved | the DOM id of the edge's target element                                       |

✅ Read side — `e2e/playwright/src/glsp/graph/graph.po.ts:265` locates newly-created elements by
`` `[data-svg-metadata-type="${elementType}"]:not(${ignore.join(',')})` ``, and three other sites
in the same file (lines 94, 140, 177) read a child's plain DOM `id` attribute (the
`domHelper.createUniqueDOMElementId` value, not a `data-svg-metadata-*` one — ids are also used
directly for by-id locators). So: type lookups go through the metadata attribute, identity/graph
lookups go through the DOM `id` the client's `DOMHelper` already assigns. A GLSP-wire-compatible
`@istar-ts/glsp` + stock `@eclipse-glsp/client` pairing gets this metadata for free (it's emitted
by the stock client, not by the server); nothing in `@istar-ts/glsp` needs to produce or know
about these attributes.

---

## 7. Mapping table — GLSP piece → istar-ts piece

`docs/action-protocol.md` already has a GLSP-concept-to-istar-ts-concept table written from the
istar-ts side; this table is the inverse direction (GLSP _implementation_ classes, with file:line,
→ istar-ts equivalent, with a call/shim/conflict verdict for #74's adapter).

| GLSP piece                                                                                                                    | istar-ts piece                                                                                                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommandStack`/`Command` (`packages/server/server/src/common/command/command-stack.ts:21-160`)                                | `ModelStore.transaction`/`undo`/`redo` (`packages/core/src/store.ts:114-120`)                                                                               | **Shim, not direct call.** GLSP's stack is a list of reversible `Command` objects (`execute`/`undo`/`redo` methods, each a closure over a mutation); istar-ts's store has **no command objects at all** — `transaction(fn)` groups synchronous mutations into one undo step by diffing/snapshotting the model, and `undo()`/`redo()` restore a snapshot. A `CommandStack` implementation for `@istar-ts/glsp` wraps each `OperationHandler.createCommand` result as a `Command` whose `execute()` calls `store.transaction(() => <the store calls the handler already made>)` and whose `undo()`/`redo()` call `store.undo()`/`store.redo()` **unconditionally** — i.e. the shim's "command" doesn't actually replay a reverse mutation, it just proxies to whichever edge of the store's own history is next. This works _only_ if every `OperationHandler.createCommand` call corresponds 1:1 with exactly one `store.transaction`, and nothing else calls `store.undo()`/`redo()`/`transaction()` outside that shim (see "the undo conflict" below). |
| `OperationHandler`/`OperationActionHandler` (`...operations/operation-handler.ts:30-83`, `operation-action-handler.ts:28-94`) | `ModelStore` mutators + `createActionDispatcher`'s operation branch (`packages/actions/src/dispatcher.ts:201+`)                                             | **Direct call, through a handler-per-operation-kind shim.** istar-ts's dispatcher already does, in one place, everything GLSP splits across many `OperationHandler` subclasses: validate (`canLink`, `validateModelProperties`), run exactly one `store.transaction`, and return an `ActionResult`. One `OperationHandler` subclass per GLSP operation kind (`CreateNodeOperation`, `CreateEdgeOperation`, `DeleteOperation`, `ChangeBoundsOperation`, `ChangeContainerOperation`, `ReconnectEdgeOperation`, label-edit, compound) can each just call `dispatcher.dispatch(theEquivalentIstarAction)` and translate the `ActionResult` into a `Command                                                                                                                                                                                                                                                                                                                                                                                                  | undefined` (§7's row above) — no business logic duplicated, pure translation. |
| `GModelFactory`/`GModelSerializer` (`...features/model/gmodel-factory.ts`, not shown: serializer)                             | nothing today — `modelToFlow` (react) derives React Flow nodes, never GModel                                                                                | **New code needed, no conflict.** `#74`'s own plan (`modelToGModel(model, metamodel)`) is exactly a `GModelFactory` implementation; it has no istar-ts analogue to call into — it's genuinely new, informed by the metamodel (`metamodelOf`) and kind defaults (`DEFAULT_ELEMENT_SIZE`, `packages/core/src/metamodel.ts:102`) for sizing without `needsClientLayout`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DiagramConfiguration` (type/shape/edge hints) (`...diagram/diagram-configuration.ts:51-97`)                                  | `typeHintsFor` (`packages/actions/src/hints.ts:72`)                                                                                                         | **Direct call, wrapped.** `typeHintsFor` already derives shape/edge hints from a `Metamodel` — `@istar-ts/glsp`'s `DiagramConfiguration.shapeTypeHints`/`edgeTypeHints` getters call it directly and reshape the result to GLSP's `ShapeTypeHint[]`/`EdgeTypeHint[]` field names (likely already close, since `docs/action-protocol.md` states `typeHintsFor` was written "GLSP's names and shapes where the concept is the same").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `EdgeCreationChecker` (`...type-hints/edge-creation-checker.ts:27-44`)                                                        | `ModelStore.canLink` / `canLink()` (`packages/core/src/store.ts:71-75`, `packages/core/src/constraints.ts:82-199`)                                          | **Direct call.** `canLink(model, source, target, kind)` returns a `LinkCheck` (ok/fail with a reason code); the checker's two methods are a thin split of the same one-call check (`isValidSource` = call with no target yet, `isValidTarget` = call with both). No shim needed beyond mapping `LinkCheck`'s `{ ok: false, code, ... }` to a plain `boolean`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ToolPaletteItemProvider` (`...contextactions/tool-palette-item-provider.ts:34-88`)                                           | `contextActionsFor` + `PaletteDescription` (`packages/actions/src/hints.ts:161`, `packages/core/src/palette.ts`, `packages/dsm3-{kaos,nfr}/src/palette.ts`) | **Direct call.** `contextActionsFor` already turns a `PaletteDescription` into `LabeledAction[]`, which is what `RequestContextActionsHandler` (§1) expects `ContextActionsProvider.getActions` to return — a `ToolPaletteItemProvider.getItems()` override just calls `contextActionsFor(palette, args)` and returns it (possibly re-grouped into GLSP's two-level `PaletteItem` tree, since `contextActionsFor`'s flat shape and GLSP's nested one may not match 1:1 — not verified here).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ModelValidator`/markers (`...validation/model-validator.ts:27-106`)                                                          | `GoalDiagnostic` + `diagnosticToMarker`/`markerToDiagnostic` (`packages/actions/src/markers.ts:6-36`)                                                       | **Direct call, already written.** `diagnosticToMarker` exists and does exactly this translation (`kind` ← `severity`, `label`/`description` ← `message`+`source`). A `ModelValidator` implementation calls `validateModel`/`validateModelProperties`/the dispatcher's own `options.diagnostics` hook and maps each `GoalDiagnostic` through `diagnosticToMarker`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GLSPServer.process`/`ActionDispatcher` (`...actions/action-dispatcher.ts`)                                                   | `createActionDispatcher`'s `dispatch` (`packages/actions/src/dispatcher.ts:201+`), `HANDLED_ACTION_KINDS` (`packages/actions/src/actions.ts:578`)           | **Shim at the transport boundary, direct call underneath.** `docs/action-protocol.md` already names this gap: istar-ts's shipped transport is one-JSON-RPC-method-per-`action.kind`, GLSP's is five methods with one `ActionMessage` envelope. #44 (referenced in both docs) is the dedicated issue for that envelope; once it lands, a GLSP `process` handler is a one-line call into the existing `dispatch`, using `HANDLED_ACTION_KINDS` to compute `InitializeResult.serverActions` at `initialize` time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DiagramConfiguration.typeMapping` / metamodel                                                                                | `metamodelOf`/`extendMetamodel` (`packages/core/src/model.ts:212`, `packages/core/src/metamodels.ts:749-774`)                                               | **Direct call.** The metamodel is already "a value" per CLAUDE.md; `typeMapping` just needs one entry per `metamodelOf(model).elements`/`.links` kind, built once per metamodel (iStar 2.0, KAOS, NFR), not per model instance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Manifests & contributions (the paper) ↔ `@eclipse-glsp/server`'s Inversify modules

`docs/papers/metin-bork-2025.md` §4.1.2 (Fig. 4) and §5.1.1 (Table 1, Table 2, Fig. 8) describe
the reference architecture's **manifest**/**contribution** pattern: every feature module has a
manifest that "defines the contributions the module makes" and "registers implementations into
the DI container against a contribution's exposed operations"; a contribution "exposes
operations other modules register implementations against." BIGUML (the paper's Java
proof-of-concept) realizes this with Google Guice. `@eclipse-glsp/server` (TypeScript — what
istar-ts actually depends on) realizes the _same concepts_ with Inversify, using different
concrete classes:

| Paper's vocabulary                                                                                                                             | `@eclipse-glsp/server` (TypeScript/Inversify)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Where (✅ read above)                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Feature module                                                                                                                                 | `ContainerModule` (an Inversify `ContainerModule`; every `GLSPModule` subclass is one)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `packages/server/server/src/common/di/glsp-module.ts:36-68`                                                           |
| **Manifest** — "defines the contributions the module makes," binds implementations into the container                                          | A `DiagramModule`/`ServerModule`/`AbstractMcpDiagramModule` subclass's `configure()` method plus its overridable `bind*()`/`configure*()` hooks. The abstract `bind*()` methods (e.g. `bindDiagramConfiguration()`, `bindSourceModelStorage()`) are the manifest's _declared requirements_; a subclass's overridden method body is the manifest _fulfilling_ them.                                                                                                                                                                       | §1 (`diagram-module.ts:130-373`), §5 (`mcp-diagram-module.ts:91-236`)                                                 |
| "Manifests can install other manifests"                                                                                                        | `ServerModule.configureDiagramModule(diagramModule, ...additionalModules: ContainerModule[])` — composes a `DiagramModule` with e.g. a layout module and an MCP module under one `diagramType`.                                                                                                                                                                                                                                                                                                                                          | §1 (`server-module.ts:61-68`), §5's `WorkflowServerModule` example (`examples/workflow-server/src/node/app.ts:43-47`) |
| **Contribution** — "exposes operations other modules register implementations against"                                                         | A multi-bound service identifier, configured via `MultiBinding<T>`/`InstanceMultiBinding<T>` (`AbstractMultiBinding.add/remove/rebind`, `packages/server/server/src/common/di/multi-binding.ts:27-89`). The contribution _point_ is the symbol (e.g. `OperationHandlerConstructor`); "contributing" is calling `binding.add(MyHandler)` inside an overridden `configure*Handlers(binding)` hook, which the base class then finalizes with `binding.applyBindings(context)` (`GLSPModule.configureMultiBinding`, `glsp-module.ts:64-67`). | §1                                                                                                                    |
| Single-instance (non-multi) contribution, e.g. the paper's `DiagramConfiguration`/`ToolPalette`/`PropertyPalette` core contributions (Table 2) | `applyOptionalBindingTarget(context, Symbol, this.bindXyz())` — an overridable `bind*()` method that defaults to `undefined` (no contribution) unless a subclass returns a `BindingTarget`.                                                                                                                                                                                                                                                                                                                                              | §1 (`diagram-module.ts:338-372`)                                                                                      |

Row-by-row against the paper's own Table 2 (Contributions excerpt, §5.1.1): `CreateOperation`/
`DeleteOperation` (Core→Diagram) ↔ the `OperationHandlerConstructor` multi-binding
(`configureOperationHandlers`, overridden per diagram, e.g.
`WorkflowDiagramModule.configureOperationHandlers`, §1); `DiagramConfiguration` (Core→Diagram) ↔
the required `bindDiagramConfiguration()` single-instance contribution; `ToolPalette`
(Core→Diagram) ↔ `bindToolPaletteItemProvider()`. One structural difference worth flagging: the
paper's BIGUML splits per-concern contribution _types_ finely (`ReconnectEdgeContribution`,
separate from `CreateOperationContribution`); the TypeScript server does not — reconnecting an
edge is just another entry in the same `OperationHandlerConstructor` multi-binding (a
`ReconnectEdgeOperation`-handling `OperationHandler` subclass), not a distinct contribution
mechanism. `PropertyPaletteContribution` (Tool tier, Table 2) has no `@eclipse-glsp/server`
equivalent in anything read for this document — a property-palette-equivalent feature, if one
exists, is client-side (`@eclipse-glsp/client`) tooling, out of scope for the server packages
read in §1 and §5. ◐ not confirmed by reading the client's tool-feature modules.

**For #80** (building istar-ts dialect contributions "that way," per the orchestrator's framing):
the target is not `@eclipse-glsp/server`'s Inversify machinery directly — that belongs entirely
to `@istar-ts/glsp` (#74's S1, not yet built), per CLAUDE.md's "GLSP, Sprotty and Inversify
dependencies go only into `@istar-ts/glsp`." Today's contribution point for a dialect is
`IstarExtension` (`packages/react`, instantiated in `examples/playground/src/extensions/`) — a
**plain object**, not a DI container; it has no manifest class, no multi-binding, no `bind`/
`rebind`. The cleanest seam, mirroring both the paper's own vocabulary and §7's `MultiBinding`
mechanics above without pulling Inversify into `@istar-ts/core`/`@istar-ts/react`/the dialect
packages: `@istar-ts/glsp` defines **one `DiagramModule` per metamodel** (iStar 2.0, KAOS, NFR),
whose overridden `configureOperationHandlers`/`configureContextActionProviders`/etc. hooks
iterate that metamodel's registered `IstarExtension`s and call `binding.add(...)` with a small
adapter class per extension-contributed capability (e.g., a custom link kind needing its own
`CreateEdgeOperation` handler, or a dialect's `PaletteDescription` feeding
`bindToolPaletteItemProvider()`). `IstarExtension` stays the plain-object contribution
_declaration_ — exactly as it is today, no new dependency — and the one place that "registers
implementations into the DI container against a contribution's exposed operations" (the paper's
own phrase) is `@istar-ts/glsp`'s adapter code, never the dialect package itself. This is a
recommendation for #80 to validate against its own concrete shape, not a decision already
made by #74.

### The undo conflict, in detail

GLSP's `CommandStack` (§1) and istar-ts's `ModelStore` undo (§7 row 1) are **both** real, mutually
exclusive undo implementations — the risk is not "there is no undo", it's "there are two, and
GLSP's protocol gives every client (`UndoAction`/`RedoAction`, `UndoRedoActionHandler`,
`packages/server/server/src/common/command/undo-redo-action-handler.ts:23-57`) a hard-wired path
to _its_ stack, with **no interface seam to redirect that to `store.undo()`/`store.redo()`
directly** — `UndoRedoActionHandler` is not overridable per se (it's one of the fourteen
default-bound `ActionHandler`s in `DiagramModule.configureActionHandlers`, but it talks only to
the injected `CommandStack`, nothing else).

Recommendation, to keep **one** undo stack (`ModelStore`'s, per `docs/action-protocol.md`'s
existing "Undo" section and the epic's own open decision "one shared stack, or one per client" —
this doc recommends shared, matching today's single-editor assumption): bind a custom
`CommandStack` (via `DiagramModule.bindCommandStack()`, an explicit override point,
`diagram-module.ts:284-286`) whose `execute(command)` ignores GLSP's own list bookkeeping and
instead calls through to whatever the `OperationHandler` already did inside `store.transaction`
(i.e. the "command" this custom stack receives is a no-op/already-applied marker — the real
mutation happened when the `OperationHandler` ran, not when the stack's `execute` runs), and
whose `undo()`/`redo()` call `store.undo()`/`store.redo()`, and `canUndo()`/`canRedo()` call
`store.canUndo()`/`store.canRedo()`. This satisfies `UndoRedoActionHandler`'s contract (it only
calls `commandStack.canUndo()`/`undo()`/`canRedo()`/`redo()`, §1) **without** GLSP's own command
list ever existing as a second source of truth — `DefaultCommandStack`'s internal `commands[]`
array, `top`, and `saveIndex` bookkeeping (lines 78-88 of `command-stack.ts`) are simply never
instantiated. The one sharp edge: `DefaultCommandStack.handleError` flushes the whole stack on
any exception during `execute()` (§1) — a custom `CommandStack` must decide its own
error-recovery story, since `store.transaction`'s rollback-on-throw semantics (`docs/action-protocol.md`
cross-reference: `ModelStore.transaction`, `packages/core/src/store.ts:110-114`, "If `fn` throws,
the model is rolled back") already cover the same case one level down, and duplicating
GLSP's flush-everything behavior on top would be redundant and possibly double-undo.

---

## 8. Risks

| Risk                                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inversify version + decorators                     | ✅ `@eclipse-glsp/server` peer-depends on `inversify@^6.1.3` and `reflect-metadata@^0.2.2` (`/tmp/glsp-core` `packages/server/server/package.json`, read directly). Inversify 6.x needs legacy `experimentalDecorators: true` (not TC39 decorators) and, for constructor-parameter injection without explicit `@inject()` on every param, `emitDecoratorMetadata: true` + a `reflect-metadata` import before any decorated class loads. istar-ts's `tsconfig.base.json` has **neither flag set**, `isolatedDeclarations: true`, and uses `tsdown`/oxc for `.d.ts` emission (not `tsc`) — oxc's decorator support targets the stage-3 (TC39) proposal, not TypeScript's legacy `experimentalDecorators` metadata emission, and `emitDecoratorMetadata` is a full-program, type-checking-dependent transform that per-file/isolated declaration tooling (oxc, tsdown/rolldown) is not built to do. ◐ not verified against oxc's actual decorator transform output, but the design tension (isolated, per-file compilation vs. a transform that needs the whole program's type graph) is structural, not a version-pinning problem. | Confine `inversify`/`reflect-metadata`/`experimentalDecorators` to `@istar-ts/glsp` and `examples/glsp-client` only (already the epic's stated constraint). Give that package its own `tsconfig.json` with `experimentalDecorators: true`, and verify early (a one-file spike) whether tsdown/oxc actually emits correct decorator metadata for Inversify's `@injectable()`/`@inject()` before committing to the package's build pipeline — if not, that package alone may need `tsc`'s own emitter instead of tsdown, which CLAUDE.md's "no eslint/prettier/tsup" rule doesn't explicitly forbid (it names tsdown as the project default, not a hard requirement for every package) but should be called out as a deviation if taken. |
| ESM/CJS                                            | ◐ not directly inspected in `glsp-core`'s build output; inferred from `"module": "ESNext"`/`"moduleResolution": "bundler"` already in istar-ts's `tsconfig.base.json`, and Inversify 6.x's own dual-package history (older Inversify majors shipped CJS-only; 6.x ships ESM+CJS but `reflect-metadata`'s side-effect-only import pattern is a classic ESM/CJS interop trap — a bundler that tree-shakes side-effect imports, or dual-loads the module under both specifiers, can end up with `Reflect.getMetadata` undefined at the one call site that needs it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Smoke-test `@istar-ts/glsp` under both `pnpm vitest` (its own package, ESM) and the playground's Vite build before trusting the dependency works; keep the `import 'reflect-metadata'` side-effect import as the literal first line of the package's entry point, matching every upstream launcher file read in §3.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Bundle size                                        | ◐ not measured. `@eclipse-glsp/client` + `@eclipse-glsp/sprotty` + `inversify` + `reflect-metadata` is a non-trivial addition; upstream's own `workflow-standalone` ships this as a dedicated bundle (`esbuild`, not part of a larger app), suggesting upstream itself treats this as "its own bundle," not something meant to be merged into an existing app's main chunk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | If `examples/glsp-client` is a separate Vite entry/app (not a lazy-loaded route inside `examples/playground`), this risk is contained by construction — recommend exactly that, matching upstream's own separation and CLAUDE.md's "GLSP ... dependencies go only into `@istar-ts/glsp` and `examples/glsp-client`" constraint.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `isolatedDeclarations` vs. Inversify's own `.d.ts` | ◐ not verified; Inversify and `@eclipse-glsp/*` are consumed as compiled dependencies (their own `.d.ts`, not re-compiled by istar-ts's isolatedDeclarations rule, which only applies to _istar-ts's own_ exported source) — so this is likely a non-issue for consuming them, but **`@istar-ts/glsp`'s own exports** (e.g. a `DiagramModule` subclass, an `OperationHandler` subclass) must still satisfy isolatedDeclarations' "explicit return/type annotations on exported functions and constants" rule, which is straightforward for class-based Inversify code (methods/fields are already explicitly typed in every upstream example read above) — low risk in practice.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | No action beyond the normal isolatedDeclarations discipline CLAUDE.md already requires project-wide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| MCP API stability                                  | ✅ `@experimental` on `AbstractMcpDiagramModule`'s own doc comment (§5): "Option names, schema shapes, and handler contracts MAY change in minor releases until the feature graduates from experimental status."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Treat `@istar-ts/glsp`'s own MCP integration (if any is attempted under this epic — the epic itself doesn't scope MCP in) as follow-on, not part of S0–S4; pin `@eclipse-glsp/server-mcp` exactly (no `^`) if adopted before graduation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Repo consolidation churn                           | ✅ (see "Version note" at the top of this document) `glsp-core` is actively being reorganized (`packages/{client,common,server}/<name>` nesting, `e2e/playwright` merge) on `main`, unreleased.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pin `@eclipse-glsp/server`/`@eclipse-glsp/client`/`@eclipse-glsp/protocol`/`@eclipse-glsp/graph` to the released `2.8.x` line (not `next`) for `@istar-ts/glsp`'s actual `package.json`, per the epic's decision; re-read this document's file paths against whatever version is actually installed before relying on a path, since only the npm package _contents_ (not these doc's upstream source paths) matter for the real dependency.                                                                                                                                                                                                                                                                                            |
| Protocol-spec page vs. source disagreement         | ✅ noted in the sources table: the hosted protocol docs page, when machine-summarized, describes `requestModel` as if it were a sixth top-level JSON-RPC method and omits `process`; the actual `GLSPServer` interface (§3) has exactly five methods, `process` being the one generic envelope `requestModel` (an `Action`) travels through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Treat `glsp-core`'s own `glsp-server.ts` interface, not the prose documentation site, as authoritative for protocol shape — already the approach taken throughout this document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## Verify

- `pnpm format:check` — this document is prose only; run after any edit to confirm oxfmt has no
  opinion on `docs/glsp/framework-notes.md` (markdown is typically untouched by oxfmt, but the
  issue's verify step asks for it explicitly).
- Every upstream path cited above with a line range was opened directly, at
  `glsp-core@b76da01d843f7256b3b54dff91f78bd8c307ded6` (or the explicitly marked `[v2.8.0]`
  commit `12b54a932f41f9f05c98126f85742c9a587f740c`), via a throwaway shallow clone in `/tmp`
  — **never copied into this repository**, per CLAUDE.md.
