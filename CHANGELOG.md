# Changelog

Versions are published from GitHub release tags; see the release notes for full details.

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
