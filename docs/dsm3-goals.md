# Design note: DSM3-goals frameworks (KAOS, NFR)

Status: implemented for issue [#7](https://github.com/vieirin/istar-ts/issues/7), in four
steps: root metamodels (#8) and hub links, link targets and `detectFramework` (#9) in core;
hubs and link-anchored links in react (#10); and the two framework packages,
`@istar-ts/dsm3-kaos` and `@istar-ts/dsm3-nfr`, with the playground. DSM3's three welcome
models open, render and save byte for byte. This note records why the port looks the way it
does. The "Decisions" log at the end was appended to as the work went.

## Problem

[DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/) is João Pimentel's generic version of
piStar's core. One editor runs three goal-modelling languages, each described by four files:
iStar 2.0, KAOS and the NFR Framework. istar-ts could only represent iStar 2.0 and its
extensions:

- `ISTAR_2_0` was the only root metamodel, and its builder was private;
- link rules could only name element kinds, so NFR's Argument link (a Claim pointing at another
  link) had no target to name;
- every link had exactly one source, while a KAOS refinement joins several sub-goals through one
  circle (DSM3's "split link", saved as a hub with legs and an end);
- `parsePistar` assumed iStar, and the canvas refused to put a node outside an actor, while KAOS
  and NFR have no actors at all.

iStar behaviour and the existing fixtures must stay byte-for-byte unchanged.

## DSM3's four files and their counterparts

Each DSM3 language is a folder of four scripts loaded into the same piStar core. Each maps onto
one layer of istar-ts:

| DSM3 file                    | What it holds                                                                                                           | istar-ts counterpart                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `language_*_metamodel.js`    | prefix, version, node and link kinds, default `customProperties`, `sourceMultiplicity`, `possibleLabels`, `targetsLink` | `metamodel.ts`: a root declaration given to core's `defineMetamodel`; defaults in `properties.ts` (core `defineProperties`) |
| `language_*_constraints.js`  | one `isValid(source, target)` per link kind                                                                             | declarative `LinkRules` in the same declaration, plus a `check` predicate where the rules can't say it                      |
| `language_*_shapes.js`       | JointJS shapes: polygons, paths, dash arrays, link markers, midpoint glyphs                                             | `shapes.ts` (`ShapeSpec`s and marker paths) and the react registry parts of `extension.ts`                                  |
| `language_*_ui.metamodel.js` | toolbar labels, tooltips and status texts                                                                               | palette entries in `extension.ts`                                                                                           |

The split is the same as for metamodel extensions (see
[metamodel-extensions.md](metamodel-extensions.md)): kinds and rules in core, presentation in
react. A framework package ships both halves, and a host passes its `kaosExtension` or
`nfrExtension` to the canvas.

## Decisions

**D1. A root metamodel is a value too.** `defineMetamodel(declaration)` builds a root from the same
element and link declarations `extendMetamodel` takes. A root also carries:

- `framework`, its id (`istar-2.0`, `kaos`, `nfr`);
- `prefix`, the namespace it reserves;
- `file`, hints for new files: `tool`, `istar`, extra top-level keys such as
  `metamodelVersion`, and the top-level key order.

`ISTAR_2_0` becomes `defineMetamodel(ISTAR_2_0_DECLARATION)` and behaves exactly as before.
Kind validation is shared between both builders, so error messages don't change. Root node kinds
default to DSM3's `canBeInnerElement`, `canBeDependum` and `canBeOnPaper` all true.

**D2. Hub links mirror DSM3's generated kinds.** DSM3's `setupSplitLinks` turns a link kind with
`sourceMultiplicity: -1` into three kinds: `<Kind>Hub`, `<Kind>Start` and `<Kind>End`. istar-ts
does the same for `arity: 'n'`. The hub is an ordinary element of a generated kind, and the legs
and end are ordinary links, so the model shape, store events, undo and layout need almost
nothing new. A link with `sources: string[]` was rejected: it would have touched every
source/target comparison in core and react. `'node'` and `'*'` selectors never match a hub. That
reproduces DSM3's rule that only a leg may point at a hub. The file keeps DSM3's entry shape,
`{hub, starts, end}`, byte for byte.

**D3. Links may target links.** A rule's `targets` may contain the selector `'link'` or a link
kind. `IstarLink.target` stays a string id, resolved against elements first and links second.
The canvas draws such a link to the target link's midpoint, as DSM3's `virtualTarget` does.

**D4. The file says which framework it is.** `detectFramework(json, roots)` matches the first
element or link `type` prefix against each root's `prefix`. A file with no types falls back to a
unique match on `tool`. Nothing is hard-coded per framework.

**D5. Fixtures are DSM3's own examples.** The three welcome models of the DSM3 site (KAOS, NFR,
iStar 2.0) are extracted, pretty-printed and committed under `fixtures/dsm3/`. They round-trip
byte for byte. One test exists per `isValid` branch of DSM3's two `constraints.js` files.

**D6. React renders hubs and link-anchored links.** The provider completes the registry for any
non-iStar root, and drops iStar's kinds from it, so the KAOS palette has no Actor. Hubs get a
circle component and an inspector that edits the refinement's properties. Legs draw without a
marker; the end draws like the base link. A node kind with `info.canBeOnPaper` may be added on
empty canvas. A link targeted by another link gets an invisible anchor node at its midpoint,
shown only while a link-targeting tool is active.

**D7. One package per framework.** `@istar-ts/dsm3-kaos` and `@istar-ts/dsm3-nfr` each export the
root (`KAOS`, `NFR`), its declaration, its kind names, typed property schemas (KAOS only;
NFR declares none), shapes, and an `IstarExtension` with the react registry parts. Kinds,
labels, sizes and rules live in the declaration; shapes, markers, glyphs and palette entries
in the extension. They depend on `@istar-ts/core` and `@istar-ts/react`; the `./metamodel`
subpath of each (`src/headless.ts`) re-exports the React-free part, built for `import` and
`require` like core, so CommonJS tooling can load a root without React. Every rule
sets `sameActor: false`, since neither language has actors. `Description`, which every DSM3
element carries, is a plain string that round-trips. The packages don't inject it into new
elements, as piStar doesn't.

The KAOS package also has an obstacle analysis extension (`kaosObstacleAnalysis`,
`KAOS_OBSTACLES`; issue [#20](https://github.com/vieirin/istar-ts/issues/20)). **Its file types
are istar-ts's, not DSM3's**: `kaos.Obstacle`, `kaos.ObstacleRefinementLinkHub`, `…Start`,
`…End`, `kaos.ObstructionLink` and `kaos.ResolutionLink` don't exist in DSM3-goals, and its KAOS
editor doesn't know them. The `Kind` key on Domain property is ours too. A model
without obstacles is still a plain DSM3 file. See "Obstacle analysis" below.

**D8. The playground shows all three.** A "Frameworks" group in the switcher holds KAOS and NFR.
Opening a file picks its root with `detectFramework` before parsing.

## Obstacle analysis (issue #20)

goal-controller's KAOS stress test (goal-controller#181) needs obstacles, and Cailliau's models
(KAOSTools, ADS) need properties on refinement legs. Every property those works use falls into
one of three layers, and only the first belongs here:

| Layer                                                         | Where                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| KAOS the language: kinds, links, rules, text keys             | `@istar-ts/dsm3-kaos`                                         |
| A tool's or method's vocabulary (which values `Type` takes)   | a dialect (goal-controller), as enums over these text keys    |
| An analysis's quantities (probabilities, RSR, ESR, estimates) | that engine's dialect; strings on disk, untouched by istar-ts |

So no quantitative key and no enumeration lives in istar-ts. What it provides:

- **Generic support (core, react).** A schema may name a generated kind (`HubPartKind<K>`:
  `<K>Hub`, `<K>Start`, `<K>End`), legs keep their `customProperties`, and `HubPartInspector`
  shows a leg's own schema below the hub's. Two value hints, both optional:
  `prop.number({ max: 1 })` reads `0.2`, `.2` (CAIRIS, KAOSTools) and `20.00%` (KAOSTools) and
  writes a value back as read; `prop.reference({ kinds })` holds an element id, with a picker
  and a dangling-id check in `validateModelProperties`. istar-ts declares neither; a dialect
  does (a resolution's anchor, a refinement's context, a leg's probability). Formulas stay
  `prop.string`.
- **`kaosObstacleAnalysis`.** `Obstacle` (keys `Description`, `FormalSpec`, `Category`), the
  n-ary `ObstacleRefinementLink` (sub-obstacles and domain properties join at a hub, as in a
  goal refinement; several hubs on one obstacle are its OR alternatives), `ObstructionLink`
  (obstacle → goal or domain property, one per pair), `ResolutionLink` (goal → obstacle, one
  per pair, keys `ResolutionType` and `Anchor`). A domain hypothesis isn't a new kind: the
  book and Objectiver distinguish it from an invariant on one concept, so Domain property gets
  an optional `Kind` key. A refinement pattern isn't a new key either: DSM3's hub already has
  `Tactic` (milestone-driven, case-driven, …), and `SysRef` is RE'11's system reference, the
  design option the refinement belongs to.
- **`fixtures/dsm3/kaos-las.txt`.** KAOSTools' London Ambulance model
  (`Parsing.Tests/Examples/las.kaos`, github.com/ancailliau/KAOSTools at `6a25d84`, MIT per its
  readme) drawn by hand in the KAOS file format: 10 goals, 6 obstacles, 5 domain properties,
  3 agents, two milestone refinements, a case refinement whose legs carry `Probability` `.8`
  and `.2` as las.kaos writes them, the top obstacle's three OR alternatives, an obstruction
  and a resolution. Three things are not in las.kaos, and are there to exercise the structure
  only: `RSR` `0.95` and `ESR` `0.9277` on the root goal (the RE'12 figures goal-controller#182
  checks against), and the resolution's `ResolutionType` `mitigation` with an `Anchor` on the
  goal the obstacle obstructs. No istar-ts schema declares `Probability`, `RSR` or `ESR`:
  the fixture proves the file carries an engine's quantities untouched. It round-trips byte
  for byte.

### Limitations, by design

These are left for the goal-controller side to encode or defer:

- `customProperties` maps strings to strings. A **keyed multi-valued** property (RE'15's
  estimate per expert, `probability[e4] (q10, q50, q90)`) has to be encoded in the key
  (`Probability.e4`), and a **structured** value (a distribution with parameters, FSE'04's
  objective function with `Modal`, `Target`, `Current`) in the string. Core won't grow a
  structured property type for one engine; if two engines need the same shape, revisit.
- **Experts, calibrations, design options and evidence** (RE'15, RE'11, HASE'11) are not model
  elements. They are project resources on the goal-controller side.
- **Per-environment definitions** (in CAIRIS a goal's definition differs per environment) have
  no counterpart. A CAIRIS importer flattens them to one environment and reports the rest.
- **The object model and operations** (entities, associations, attributes, predicates;
  `DomPre`/`ReqTrig`; `Monitors`/`Controls`) are a later extension. `Anchor`-style references
  prepare for `Monitors` referencing an object attribute.
- **Malicious agents and anti-goals** (ICSE'04) are not included. They would be a later
  extension, if a user asks.
- **No formula language and no checker** in istar-ts, as before.

## Provenance and licence

The example models and the shapes come from the DSM3-goals web tool at
<https://www.cin.ufpe.br/~jhcp/dsm3goals/>, read on 2026-10-16:

- example models: `app_ui_kaosexample.js`, `app_ui_nfrexample.js`, `app_ui_istar2example.js`
  (the `istar.models.welcome` object of each);
- shapes and markers: `language_kaos_shapes.js`, `language_nfr_shapes.js`;
- kinds, rules and labels: `language_{kaos,nfr}_{metamodel,constraints,ui.metamodel}.js`;
- hub generation and the file format: `app_istarcore_{fileManager,istarFunctions,metamodelManager}.js`.

The pages name João Pimentel as author. **No licence is stated** on the site or in the
scripts. piStar itself is MIT, and DSM3-goals is derived from it, but that doesn't license
DSM3's own additions. The polygon coordinates, the cloud path, the marker paths and the example
models are reproduced as data, with this attribution. If the author objects or a licence turns
out to forbid it, the fallback is hand-written fixtures and re-drawn shapes; the code doesn't
depend on the exact values.

## Decisions log

Dated entries, appended as the work goes. Each says what was decided and why.

- **2026-10-16**: The two packages declare their kind names as string-literal unions in
  `kinds.ts`, separate from `metamodel.ts`. The schemas, shapes and registry parts can then be
  typed before `defineMetamodel` lands in core. `metamodel.ts` will check its declaration
  against the same unions.
- **2026-10-16**: Shapes are written as data with an optional `dash` and `strokeWidth`, matching
  `KindShape`'s hints from D1. Until react's `ShapeSpec` draws them, a dashed Softgoal or Claim
  renders solid. No code changes when react catches up.
- **2026-10-16**: Each package converts DSM3's polygon `points` to path data with a small local
  helper, so the coordinates stay as DSM3 wrote them. Once react exports `polygonPath`, the
  packages switch to it and the local copy is deleted.
- **2026-10-16**: Goal kinds default every DSM3 property to `''`, as DSM3's metamodel does, so a
  new goal has the same keys as one made in DSM3. Softgoal's `Type` defaults to `softgoal`.
- **2026-10-16**: The NFR package has no `properties.ts`. DSM3's NFR metamodel declares no
  custom properties, and `Description` round-trips as a plain string anyway.
- **2026-10-16**: The KAOS refinement schema's kind is the hub kind, `kaos.RefinementLinkHub`,
  because DSM3 saves the properties on the hub. The registry carries it on the
  `kaos.RefinementLink` entry, where the hub inspector will read it.
- **2026-10-16**: Conflict and Responsibility assignment draw no marker. Their DSM3 glyph is a
  `labelComponent`: a 32×32 SVG whose origin sits on the link's midpoint, so DSM3's glyph paths
  are used unchanged.
- **2026-10-16**: Palette titles keep DSM3's wording but say "drag from … to …", since the
  canvas connects by dragging. NFR's label groups are `nfr-contributions` and
  `nfr-correlations`, so they never merge with iStar's `contributions` group.
- **2026-10-16**: Until core has `defineMetamodel`, the package tests complete the registry
  for an `extendMetamodel(ISTAR_2_0, …)` stand-in with the same kind names. The PR that adds
  `metamodel.ts` replaces the stand-in with the real root.
- **2026-10-17**: goal-controller's mocha + ts-node (CommonJS) dialect suite could not `require`
  the framework packages (ESM-only, and their index loads React). Each gets a `./metamodel`
  subpath with ESM and CJS builds instead of making the whole package dual-format, since the
  extension needs React and `@istar-ts/react` stays ESM-only.
- **2026-10-17**: `typesVersions` on the two framework packages, since TypeScript's `node10`
  resolution ignores `exports` and goal-controller's lib compiles with `module: commonjs`.
- **2026-10-16**: The release workflow publishes core, react, dsm3-kaos, dsm3-nfr in that
  order. The two new packages need an npm trusted publisher each, which the repository owner
  creates on npmjs.com.
- **2026-10-16** (agent-blue, PR1, core root metamodels):
  1. `isCustomPropertiesRecord` recognises a model object by a namespaced `kind` (one that
     contains `.`) plus a numeric `x` or a string `source` and `target`. A bag such as
     `{kind: 'plain', source, target}` stays a bag.
  2. A complete `info` in a declaration is kept as given, so `NODE_KIND_INFO` keeps its object
     identity. A partial one merges over the defaults. Root defaults are inner, dependum and on
     paper all true. Extension defaults are piStar-ext's: inner and dependum true, on paper false.
  3. In a root, giving both `rules` and `behavesLike` is an error ("needs at most one of
     behavesLike or rules"). A root link may give neither, and then uses the built-in checks. A
     root dependency-category link may skip `behavesLike` only when it has no rules.
  4. A root link with neither rules nor built-in checks is accepted when it is defined;
     `canLink` then fails with `unknown-link-kind`. Checking against the built-in checks at
     definition time would create an import cycle.
  5. `defineMetamodel` validates `name` (non-empty) and `prefix` (`/^[A-Za-z_][\w-]*$/`).
  6. `ISTAR_2_0_DECLARATION.file` writes `pistar.2.1.0` and `2.0` literally, because importing
     them from `model.ts` would be a cycle. A test asserts they match.
  7. The namespace reserved against extensions is the root's `prefix`. Roots may declare kinds
     in any namespace.
- **2026-10-16**: With PR1 on main, the packages' shapes are typed as core's `KindShape`, which
  now has `dash` and `strokeWidth`. The local shape interfaces are gone, and react's
  `ShapeSpec` is the same type.
- **2026-10-16**: `KAOS` and `NFR` are declared with `defineMetamodel`. Labels and sizes live
  in the declaration, and the extensions no longer repeat them. Shapes stay in the extensions,
  as plain data the registry draws, so the declarations carry kinds and rules only.
- **2026-10-16**: Until core has n-ary links, `kaos.RefinementLink` is declared as an ordinary
  link with DSM3's source rules. `nfr.ArgumentLink` is left out of `NFR` until links can
  target links; its kind name, label and palette entry are ready.
- **2026-10-16**: DSM3's "NFR softgoal towards an Operationalization" rule is a `check`
  predicate, `notNfrToOperationalization(reason)`, carrying DSM3's message for each link kind.
  Self links, Claims and duplicates are caught by the declarative rules with core's messages.
- **2026-10-16**: Both packages export `DSM3_FILE_KEYS`, DSM3's top-level key order. The two
  copies are identical. A shared home would be core, or a third package, and that choice is
  left to review.
- **2026-10-16**: `DSM3_FILE_KEYS` stays duplicated in the two packages, with a comment saying
  it mirrors DSM3's `fileManager` key order. Core stays framework-neutral, and a shared package
  would be overkill for one constant.
- **2026-10-16** (agent-blue, PR2, core hub links, link targets, `detectFramework`):
  1. Leg and end rules use `sameActor: false`. The base kind's `sameActor` holds between each
     leg's source and the end's target, since the hub has no parent.
  2. A hub has exactly one end; a second end is a `duplicate-link`. The end kind carries the
     base kind's `info` and `line`; the leg kind has `info: {}`.
  3. The base kind's `check` runs only when `canLink` or `connect` uses the base kind towards an
     element that isn't a hub. It is not copied onto legs.
  4. The hub kind has a circle path in viewBox `0 0 20 20`, labels "<base label> hub", "… leg"
     and "… end", and `info` inner false, dependum false, on paper true.
  5. `connect` with the base kind puts `input.id` and `customProperties` on the hub, and
     `label` and `name` on the end. `result.link` is the end for a new hub, or the new leg.
     `result.hub` is the hub link. The hub's name is `''`. n-ary kinds never try reversed.
  6. `canLink` towards a hub of another kind returns `hub-target` directly.
  7. `incomplete-hub` issues use the hub id as `linkId` and the base kind as `kind`.
  8. Parsing is tolerant: `starts` may be empty and `end` absent. The writer emits an entry for
     incomplete or orphan hubs, and writes a second end as a plain link.
  9. Generated kinds aren't inferred into the metamodel's kind unions. Roots list them in
     `defineMetamodel`'s type arguments.
  10. Only `targets` may name links; a link selector in `sources` is an error.
  11. iStar 2.0's built-in rules refuse a link target: `invalid-target`, "must be an element,
      not a link".
  12. DSM3's Argument uniqueness looks for a ContributionLink between the Claim and the link,
      which never matches (an upstream slip); istar-ts allows one Argument per Claim and link.
      DSM3 refuses a Refinement towards a hub; istar-ts adds a leg instead.
  13. Tests assert constraint codes, not DSM3's message texts, except the NFR→Operationalization
      messages, which the `check` reuses.
  14. The playground lists `fixtures/dsm3/*`. Until the packages land, its KAOS and NFR files
      fail to parse as iStar 2.0.
- **2026-10-16** (PR3, react):
  1. A hub's registry label is its base link's label, so the hub inspector is titled
     "Refinement".
  2. `HubInspector` uses the hub kind's own `properties` if it has them, otherwise the base link
     kind's.
  3. `modelToFlow` places link anchors on the straight-line middle of the target link. The drawn
     link ends on the live middle, which also follows curved links; only the drop target sits
     on the chord.
  4. Anchor nodes come after every other node. Only models with links that target links take
     the new layout path, and a snapshot pins iStar 2.0's layout.
  5. `checkConnection` maps an anchor node to its link in one place, which covers
     `isValidConnection`, the connection hint and `onConnectEnd`. `onConnect` maps it too.
  6. The drag gesture itself has no jsdom test; it needs real pointer events. The store side is
     tested in core and the anchor mapping through `checkConnection`.
- **2026-10-16** (PR4, packages and playground):
  - KAOS's kind types include the generated `kaos.RefinementLinkHub`, `…Start` and `…End`
    (`KaosElementKind`, `KaosLinkKind`). The declaration is typed with the declared kinds only.
  - The refinement schema is registered on the hub kind, which the inspector and
    `validateModelProperties` read. It is also on the `kaos.RefinementLink` entry, from which
    react takes a new hub's defaults when connecting.
  - The KAOS package uses react's `polygonPath`; its own copy is gone.
  - NFR's Contribution and Correlation take their per-label palette entries from react's
    defaults, one group per kind. The extension no longer builds its own.
  - The NFR→Operationalization `check` ignores link targets (`isLinkRef`).
  - The playground maps `fixtures/dsm3/kaos-*` and `nfr-*` to their framework and `istar2-*` to
    plain iStar 2.0. A file opened from disk switches framework only when `detectFramework`
    finds another root than the active one, so an iStar 2.0 file keeps the active extension.
- **2026-10-16** (PR4 review): `DSM3_TOOL` and `DSM3_FILE_KEYS` move to core, next to
  `PISTAR_TOOL`, as DSM3-goals' file conventions. This reverses the earlier decision to keep the
  key list duplicated: core already owns DSM3's `{hub, starts, end}` entry format, so DSM3's
  file conventions sit there too. Both packages import them and neither re-exports them.
- **2026-10-16** (PR4 review): DSM3's "must be an element" branches are tested per link kind. A
  link id as the source fails with `unknown-element`; as the target of a kind whose rules name
  elements only, with `invalid-target`.
- **2026-10-16** (issue #12, KAOS polish):
  - Selecting a leg or an end of an n-ary link inspects the whole link. Their registry entries
    get `HubPartInspector`, which renders the hub's `HubInspector` for the hub `hubOfLink` finds,
    with the hub's actions, schema and diagnostics. The selection stays on the leg or end, so the
    canvas still highlights what was clicked. A leg or end without a hub falls back to the
    default link inspector. This works for any `arity: 'n'` kind, and packages need no change.
  - `HubInspector` lists the link's sources, one per leg in link order, by element name, and
    its target, above the properties.
  - Palette icons for glyph links: `LinkKindConfig.icon` is used for a kind's entries that have
    no icon of their own; an entry's own icon still wins. `LinkIconStyle.glyph` draws a path at
    the icon line's middle, unrotated and scaled down, like the canvas's `labelComponent`.
    `kaosExtension` gives Conflict and Responsibility Assignment
    `linkIcon(kind, undefined, { marker: null, glyph })`. Rendering a `labelComponent` inside the
    icon was rejected: label components are HTML sized for the canvas, not for a 40×24 icon.
- **2026-10-17** (issue #20, obstacle analysis):
  1. `extendMetamodel` reserves the root's prefix, so the extension's kinds are
     `kaosObstacles.*` with `pistarType: 'kaos.*'`. The issue asked for `kaos.Obstacle` as the
     kind; that is the file type instead. `detectFramework` still recognizes the file as KAOS,
     since it matches on types.
  2. The obstacle parts live in `kaosExtension` with the rest of KAOS. With plain `KAOS` the
     registry has no such kinds and skips them, so one extension serves both metamodels. The
     playground's KAOS set reads files with `KAOS_OBSTACLES`.
  3. Obstruction ends in an open arrow with a bar behind it; Resolution is dashed (`6,3`) with
     the refinement's filled triangle. Neither exists in DSM3, so the choice is ours. Obstacles
     are DSM3's KAOS grey, as the issue asks, rather than Objectiver's red.
  4. Domain property's `Kind` is optional with no default, so the DSM3 welcome model saves
     byte-identically and new domain properties have DSM3's keys.
  5. `prop.number` accepts a percentage only when `max === 1`, as the issue specifies. `.2`
     was already accepted by `Number`. "Written back as read" is general: `write` keeps the
     current string whenever it parses to the patched value, for every type.
  6. The obstacle refinement's hub has no schema: no tool gives obstacle refinements keys of
     their own.
