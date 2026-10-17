# @istar-ts/core

Framework-free TypeScript library for [iStar 2.0](https://istarwiki.org/) goal models: a typed
metamodel, piStar-compatible JSON load/save, iStar link constraints, an immutable undoable model
store, and optional typed schemas for `customProperties`. No DOM or React dependency — **ESM
only**.

```sh
pnpm add @istar-ts/core
```

## Loading and saving piStar files

piStar save files are JSON. Use `parsePistar` to read them into an `IstarModel`, and `toPistar` (or
`toPistarObject`) to write back.

```ts
import { parsePistar, toPistar, validateModel } from '@istar-ts/core';
import { readFileSync, writeFileSync } from 'node:fs';

const text = readFileSync('model.pistar', 'utf8');
const model = parsePistar(text);

const issues = validateModel(model); // link constraint violations, like piStar on load
if (issues.length) console.warn(issues);

writeFileSync('model.pistar', toPistar(model));
```

**Round-trip guarantees:**

- Unknown JSON keys are kept on `extra`, `extraDisplay`, and per-element/link `extra`, and written
  back unchanged.
- Every `customProperties` value stays a **string** on disk (as in piStar).
- Files saved by the piStar web tool round-trip **byte-identically** through
  `toPistar(parsePistar(file))` when you do not edit the model.
- Pass `{ saveDate: new Date() }` when saving an edited model (piStar updates `saveDate` on save).
  Omit it to preserve the model’s existing `saveDate` on a load/save cycle; a file that had none
  keeps none until a save passes one.
- A model's metamodel and layout are kept beside it, in registries shared by every copy of
  `@istar-ts/core` in the process (ESM and CommonJS builds alike), so a model parsed by one copy
  is read correctly by another.
- A parsed file is written back with its own key order at every level (top level, each element,
  link, hub entry and the diagram), so files other tools wrote stay byte-identical. `inheritSourceLayout`
  carries that over to an edited model; the store does it on every edit.

```ts
toPistar(editedModel, { saveDate: new Date() });
```

## Metamodel

Kind names use the `istar.` prefix, matching piStar save files. Constants group actors, nodes, and
links:

| Constants               | Role                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `ACTOR_KINDS`           | `istar.Actor`, `istar.Agent`, `istar.Role`                           |
| `NODE_KINDS`            | `istar.Goal`, `istar.Quality`, `istar.Resource`, `istar.Task`        |
| `ACTOR_LINK_KINDS`      | `istar.IsALink`, `istar.ParticipatesInLink`                          |
| `DEPENDENCY_LINK_KINDS` | `istar.DependencyLink`                                               |
| `NODE_LINK_KINDS`       | refinements, `NeededByLink`, `QualificationLink`, `ContributionLink` |

`LINK_KIND_INFO` describes each link kind (fixed labels, whether direction is retried when adding,
contribution labels). `CONTRIBUTION_LABELS` is `['make', 'help', 'hurt', 'break']` — the allowed
values for a Contribution link’s `label`.

Type guards such as `isElementKind`, `isLinkKind`, and `isContributionLabel` narrow string values
from parsed files.

## Link constraints

`canLink(model, source, target, kind)` checks whether a link may be added. `source` and `target` may
be element ids or `IstarElement` objects (always resolved against the current model).

```ts
import { addElement, canLink, createEmptyModel } from '@istar-ts/core';

let model = createEmptyModel();
const { model: m1, element: actor } = addElement(model, { kind: 'istar.Actor', x: 0, y: 0 });
model = m1;

const check = canLink(model, actor.id, actor.id, 'istar.IsALink');
if (!check.ok) {
  console.log(check.code, check.reason); // e.g. 'self-link', 'you cannot make Is-A links...'
}
```

On success the result is `{ ok: true }`. On failure: `{ ok: false; code: ConstraintCode; reason: string }`.

The model store exposes the same check against its current snapshot: `store.canLink(source, target, kind)`.

## Model store

`createModelStore(initial?)` wraps an immutable `IstarModel` with editing APIs, undo/redo, and
change events.

```ts
import { createModelStore } from '@istar-ts/core';

const store = createModelStore();
const actor = store.addElement({ kind: 'istar.Actor', x: 100, y: 100 });
const goal = store.addElement({
  kind: 'istar.Goal',
  x: 150,
  y: 150,
  parent: actor.id,
});

store.connect({ kind: 'istar.AndRefinementLink', source: goal.id, target: goal.id }); // rejected

const dep = store.addDependency({
  depender: goal.id,
  dependee: actor.id,
  dependum: { kind: 'istar.Resource', name: 'Data' },
});
if (dep.ok) {
  // dep.dependum, dep.links — two DependencyLink halves around the dependum
}

store.undo();
store.redo();
```

- **Elements:** `addElement`, `updateElement`, `moveElement`, `nestElement`, `removeElement` /
  `removeElements`, `setCollapsed`.
- **Links:** `connect`, `addDependency`, `updateLink`, `disconnect` (removing one dependency half
  removes the whole dependency).
- **`transaction(fn)`** groups edits into one undo step and one event; rolls back if `fn` throws.
- **`subscribe(listener)`** + **`getModel()`** match React’s `useSyncExternalStore` contract.
- **`replace(model)`** swaps the model as a single undoable edit; **`load(model)`** replaces it and
  clears history (like opening a file in piStar).

For controlled editors, the **`operations`** module exposes the same edits as pure functions (`addElement`,
`connect`, `addDependency`, …) that return a new `IstarModel` without mutating the input.

## Typed custom properties

Core does not hardcode domain-specific properties. Optional schemas layer typed read/write on top
of string maps via `defineProperties` and `prop.*` builders (`string`, `number`, `boolean`, `enum`).

```ts
import {
  defineProperties,
  prop,
  validateModelProperties,
  type InferProperties,
} from '@istar-ts/core';

const resourceSchema = defineProperties(
  'istar.Resource',
  {
    type: prop.enum(['bool', 'int'] as const),
    initialValue: prop.string(),
  },
  {
    validate: (v) =>
      v.type === 'bool' &&
      v.initialValue !== undefined &&
      !['true', 'false'].includes(v.initialValue)
        ? [{ key: 'initialValue', message: 'must be true or false' }]
        : v.type === 'int' && v.initialValue !== undefined && !/^-?\d+$/.test(v.initialValue)
          ? [{ key: 'initialValue', message: 'must be an integer' }]
          : [],
  },
);

const { values, issues } = resourceSchema.read({ type: 'bool', initialValue: 'false' });
const next = resourceSchema.write(
  { type: 'bool', initialValue: 'false', legacy: 'keep' },
  { initialValue: 'true' },
);
const defaults = resourceSchema.defaults();

const modelIssues = validateModelProperties(model, [resourceSchema]);
```

`read` / `validate` accept `customProperties`, a full element/link, or `undefined`. `write` merges
patches, preserves unknown keys, and serializes typed values back to strings. A value that
didn't change keeps its string as read (`.2` stays `.2`).

Two optional hints:

- `prop.number({ min: 0, max: 1 })`: with `max: 1` (a probability) the reader also accepts a
  percentage, so `0.2`, `.2` and `20.00%` read as 0.2. A changed value is written in the form
  the old one was read in (`20.00%` → `35.00%`, `.2` → `.35`).
- `prop.reference({ kinds })`: the value is another element's (or link's) id. The schema only
  checks it isn't empty; `validateModelProperties` reports an id that isn't in the model, or
  whose kind isn't in `kinds`.

Formulas (a KAOS `FormalSpec`, a `BoundaryCondition`) stay `prop.string`: core has no formula
language.

A schema can be declared for the kinds an n-ary link generates (its hub, legs and end) like for
any kind; `HubPartKind<'kaos.RefinementLink'>` is `'kaos.RefinementLinkHub' |
'kaos.RefinementLinkStart' | 'kaos.RefinementLinkEnd'`. Legs keep their `customProperties` on
disk.

## Extending the metamodel

Everything above uses iStar 2.0, which is `ISTAR_2_0`, the default metamodel. Dialects that add
constructs, such as [piStar-ext](https://ceur-ws.org/Vol-2641/paper_06.pdf)'s iStar4RationalAgents
with its Planning and Plan nodes, are new metamodels built with `extendMetamodel`:

```ts
import { ISTAR_2_0, defineMetamodelExtension, extendMetamodel, parsePistar } from '@istar-ts/core';

const rationalAgents = defineMetamodelExtension({
  name: 'rationalAgents',
  elements: [
    // Follows the Task rules: it can refine and be refined, be a dependum, need resources…
    { kind: 'rationalAgents.Planning', behavesLike: 'istar.Task', pistarType: 'istar.Planning' },
    // A node with no rules of its own: only links that name it accept it.
    { kind: 'rationalAgents.Plan', category: 'node' },
  ],
  links: [
    {
      kind: 'rationalAgents.GeneratesLink',
      label: 'Generates',
      rules: { sources: ['rationalAgents.Planning'], targets: ['rationalAgents.Plan'] },
    },
    { kind: 'rationalAgents.AlternativeLink', behavesLike: 'istar.OrRefinementLink' },
  ],
});

const RATIONAL_AGENTS = extendMetamodel(ISTAR_2_0, rationalAgents);
const model = parsePistar(text, { metamodel: RATIONAL_AGENTS });
```

- **Element kinds** have a `category` (`node` or `actor`), a `label`, a `size` and, for nodes,
  `NodeKindInfo`. `behavesLike` names an existing kind whose link rules the new kind follows,
  and also sets its category and defaults.
- **Link kinds** either `behavesLike` an existing link kind (its rules, and its meaning for the
  other rules: an Alternative counts as an OR-refinement, so it can't be mixed with AND), or
  declare `rules`:
  - `sources` / `targets`: kind names or the categories `node`, `actor`, `*`. A kind name also
    accepts kinds that behave like it.
  - `sameActor` (default true), `allowDependum` / `allowSelf` (default false), and `unique`
    (`'kind'` by default, `'any'`, or `false`).

  Either way, an optional `check(context)` predicate runs last. Dependency-category kinds must
  behave like `istar.DependencyLink`; `addDependency({ …, linkKind })` creates them.

- **Names.** Kinds are namespaced (`rationalAgents.Plan`). The root metamodel's prefix (`istar.` for
  iStar 2.0) is reserved for it, and a name or `pistarType` that collides with an existing one
  throws `MetamodelError`. Extensions
  stack, and a later one may build on an earlier one's kinds.
- **The model remembers its metamodel.** `parsePistar`, `createEmptyModel(undefined, { metamodel })`
  and `createModelStore(undefined, { metamodel })` associate it, and every operation and store
  snapshot (undo/redo included) keeps it, so `canLink`, `validateModel`, the store and `toPistar`
  need no extra argument. The association lives beside the model (`metamodelOf`), never in it:
  models keep their shape, and nothing reaches JSON or disk. A model rebuilt with an object
  spread loses it; `withMetamodel(model, metamodel)` restores it.
- **Predicates.** `isActor` / `isNode` answer for iStar 2.0 and take one argument, so they stay
  safe as `filter` callbacks. For extended kinds use `isActorIn(metamodel)` / `isNodeIn(metamodel)`,
  which return a predicate: `elements.filter(isActorIn(metamodelOf(model)))`.
- **Types.** `ElementKind`, `LinkKind` and the other iStar 2.0 exports are unchanged.
  `IstarModel<EK, LK>`, `ModelStore<EK, LK>` and `Metamodel<EK, LK>` default to them, and
  `extendMetamodel` types the new kinds (`ElementKindOf<typeof RATIONAL_AGENTS>`).

### On disk: `pistarType`

A kind is written with its name as `type` (`"type": "rationalAgents.Plan"`) unless it declares
`pistarType`. Each choice has a cost:

| Declaration                    | Written as            | Who can open the file                                                   |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------- |
| `pistarType: 'istar.Planning'` | `istar.Planning`      | istar-ts with the extension, and piStar-ext with the same construct     |
| no `pistarType`                | `rationalAgents.Plan` | istar-ts with the extension only; plain piStar rejects the unknown type |

piStar-ext writes its new constructs as `istar.<Name>`, so use `pistarType` to exchange files with
it. Note that piStar-ext keeps the construct _definitions_ (name, shape, source and target kinds)
only in the browser's localStorage, not in the model file. To read a piStar-ext file, the host must
supply the matching extension, otherwise its unknown types throw `PistarParseError`, as with any
unknown type. `toPistar` likewise throws `PistarWriteError` for a kind its metamodel doesn't know,
rather than writing a type that can't be read back.

See [docs/metamodel-extensions.md](../../docs/metamodel-extensions.md) for the design.

## Root metamodels

iStar 2.0 is one root metamodel: a whole modelling language rather than a dialect of another.
`defineMetamodel` builds others, such as the KAOS and NFR languages of
[DSM3-goals](https://github.com/vieirin/istar-ts/issues/7), from the same element and link
declarations that extensions use. `ISTAR_2_0` is itself `defineMetamodel(ISTAR_2_0_DECLARATION)`.

```ts
import { createEmptyModel, defineMetamodel, extendMetamodel, parsePistar } from '@istar-ts/core';

const KAOS = defineMetamodel({
  name: 'kaos', // the metamodel's name and framework
  prefix: 'kaos', // its namespace, reserved against extensions
  elements: [
    { kind: 'kaos.Goal', category: 'node', size: { width: 135, height: 36 } },
    { kind: 'kaos.Softgoal', behavesLike: 'kaos.Goal' },
    { kind: 'kaos.Agent', category: 'node' },
  ],
  links: [
    {
      kind: 'kaos.ResponsibilityAssignment',
      rules: { sources: ['kaos.Agent'], targets: ['node'], sameActor: false },
    },
  ],
  file: {
    tool: 'dsm3-goals',
    extra: { metamodelVersion: '1.0' },
    keys: [
      'actors',
      'orphans',
      'dependencies',
      'links',
      'display',
      'tool',
      'metamodelVersion',
      'saveDate',
      'diagram',
    ],
  },
});

const model = parsePistar(text, { metamodel: KAOS });
const blank = createEmptyModel(undefined, { metamodel: KAOS }); // tool "dsm3-goals", no "istar"
```

- **Declarations.** Kinds are declared in order, with the same validation and errors as
  `extendMetamodel`. `behavesLike` and link rules refer to kinds declared before them. A root may
  use any namespace. Nodes default to DSM3-goals' containment rules: inner element, dependum and
  on paper. A root's link kind may give neither `rules` nor `behavesLike`, as iStar 2.0's do:
  their rules are built into the library, and any other such kind accepts no link.
- **Identity.** `metamodel.framework` is the root's name (`istar-2.0`, `kaos`). `prefix` is its
  reserved namespace, so `extendMetamodel(KAOS, …)` rejects `kaos.*` kinds. Extensions keep both,
  and `file`; `name` gains the extensions' names (`kaos+ops`).
- **Files.** `file` describes the files of models that weren't read from one. `createEmptyModel`
  records `file.tool` (default `pistar.2.1.0`), `file.istar` only when set (iStar 2.0 sets
  `"2.0"`), and `file.extra` as extra top-level keys. `toPistar` orders top-level keys like the
  source file, else like `file.keys`, else like piStar.
- **Which root a file uses.** `detectFramework(text, [ISTAR_2_0, KAOS, NFR])` picks the root whose
  `prefix` is the namespace of the file's first `type` (`detectPrefix`). For a file without
  types, it picks the only root whose `file.tool` is the file's `tool`; otherwise it returns
  `undefined`.

### Hub links

A link kind with `arity: 'n'` has several sources and one target, like KAOS's AND-refinement. In a
model it is a hub element, a leg from each source to the hub, and an end from the hub to the
target, as DSM3-goals draws and saves it. The declaration generates the three kinds from the
base kind's name: `<kind>Hub`, `<kind>Start` (legs) and `<kind>End`.

```ts
const KAOS = defineMetamodel<KaosElementKind, KaosLinkKind>({
  // …
  links: [
    {
      kind: 'kaos.RefinementLink',
      arity: 'n',
      rules: {
        sources: ['kaos.BehavioralGoal', 'kaos.Softgoal'],
        targets: ['node'],
        sameActor: false,
      },
    },
  ],
});

const made = store.connect({ kind: 'kaos.RefinementLink', source: goalA, target: parent });
if (made.ok && made.hub) {
  // made.hub: { hub, legs: [leg], end }. The hub sits centred between goalA and parent.
  store.connect({ kind: 'kaos.RefinementLink', source: goalB, target: made.hub.hub.id }); // 2nd leg
}
```

- **Kinds.** The hub kind has `role: 'hub'` and `of` (the base kind), a 20×20 circle shape and
  `canBeOnPaper`. Legs and ends have `role: 'leg' | 'end'`. `parts` renames them and `hubSize`
  resizes the hub. Generated kinds aren't inferred into the metamodel's kind types, so name
  them in `defineMetamodel`'s type arguments if you need them typed.
- **Rules.** The `node`, `actor` and `*` selectors never match a hub. A link of another kind
  towards a hub fails with code `hub-target`. A source gets one leg per hub, and a hub has one
  end. The base kind's `sameActor` holds between each leg's source and the end's target.
- **Operations.** `connect` with the base kind creates the hub, a leg and the end, or adds a leg
  when the target is one of its hubs. `input.id` and `customProperties` go to the hub; `label` and
  `name` go to the end. `addLeg(model, hubId, source)` and `removeLeg(model, legId)` exist in
  operations and on the store. Removing a hub's end or its last leg removes the hub. Removing the
  hub removes its legs and end.
- **Queries.** Use `hubLinkOf(model, hubId)`, `hubOfLink(model, linkId)`,
  `isHubElement(metamodel, element)`, `elementCenter` and `defaultHubPosition`.
  `validateModel` reports a hub without an end or legs as `incomplete-hub`, with the hub's id as
  `linkId`.
- **On disk.** An entry in `links` holds `{ hub, starts, end }`, with no id of its own and no
  `text` on the hub, as DSM3-goals writes it. The entry's unknown keys are kept on the hub's
  `extra[HUB_ENTRY_KEY]` and written back. Hubs never appear in `orphans`.

### Links that target links

A link kind may point at another link, like NFR's Argument, which is a Claim about a Contribution.
Its `rules.targets` holds `link` (any link) or link kind names:

```ts
{ kind: 'nfr.ArgumentLink', rules: { sources: ['nfr.Claim'], targets: ['link'], sameActor: false } }
```

- **Checks.** `canLink(model, claim, contributionLinkId, 'nfr.ArgumentLink')` looks the target up
  among elements, then links. Element selectors never match a link, and link selectors never
  match an element. The self-link, dependum and same-actor rules don't apply to a link target.
  iStar 2.0's built-in rules refuse one.
- **Predicates.** `LinkRuleContext.target` is an `IstarElement` or an `IstarLink`, so narrow it
  with `isLinkRef`. `linkTargetOf(model, link)` returns what a link points at.
- **Models.** `validateModel` checks links that target links after the others, whatever their
  order in the file. Removing a link removes the links that target it. `linksOf(model, linkId)`
  lists them.

## A model's own metamodel

A file can declare the constructs it adds to iStar in a top-level `"metamodel"` block, so they
travel with the model. piStar-ext's "Add new" keeps them only in the browser's localStorage. The
block has the shape `extendMetamodel` takes, as JSON: no `check` predicates, and presentation hints
(`shape`, `textBox`, `line`), which `@istar-ts/react` draws.

```json
"metamodel": {
  "name": "iStar4RationalAgents",
  "elements": [
    { "kind": "ra4.Planning", "behavesLike": "istar.Task", "pistarType": "istar.Planning",
      "shape": { "path": "M 0 0 L 80 0 L 100 20 L 80 40 L 0 40 L 14 20 Z" } },
    { "kind": "ra4.Plan", "category": "node" }
  ],
  "links": [
    { "kind": "ra4.GeneratesLink", "label": "Generates",
      "rules": { "sources": ["ra4.Planning"], "targets": ["ra4.Plan"] }, "line": { "dash": "1,3" } }
  ]
}
```

```ts
import { fileMetamodelOf, parsePistar, toPistar, withFileMetamodel } from '@istar-ts/core';

// Read: the file's constructs extend `metamodel` (iStar 2.0 by default) before parsing.
const model = parsePistar(text, { fileMetamodel: true, metamodel: hostMetamodel });

fileMetamodelOf(model); // the block (only the file's constructs, never the host's)

// "Add new": constructs added at run time join the file and are written with it.
const extended = withFileMetamodel(model, { ...fileMetamodelOf(model)!, elements: [...] });
toPistar(extended); // writes the "metamodel" block
```

- **Opt-in.** Without `fileMetamodel: true`, the block is kept as an unknown key and not applied, as
  before, so no existing caller changes.
- **Collisions throw `MetamodelError`, naming the kind:**
  - a kind or `pistarType` the base or host metamodel already has;
  - the reserved `istar.` prefix;
  - a kind declared twice in the block.

  `validateFileMetamodel(block)` reports malformed blocks with their path
  (`metamodel.elements[1].kind must be a string`).

- **Round trip.** The block is written back exactly as read, including keys this library doesn't
  know (hosts keep dialect data, such as stereotypes or groupers, beside it). A model without one
  writes none.
- **`withFileMetamodel(model, block | null)`** replaces the file's constructs (or removes them with
  `null`). It keeps the host's, and refuses to drop a kind the model still uses. Load the result
  into a store (`store.load` or `store.replace`) to keep editing.
- `pistarType` works as for any extension, so `istar.<Name>` types on disk still read.

## Diagnostics

`GoalDiagnostic` (`{ elementId, key?, severity, message, source?, range?, code?, data? }`) is the
data shape for findings about elements and links. Analysers publish them per source to a
`createDiagnosticsStore()`; `getAll()` returns the union of every source, deduplicated by
`(elementId, key, message)`. `fromLspDiagnostics` and `fromNodeIdDiagnostics` adapt LSP and MutRoSe
diagnostics. Diagnostics are never part of the model and never serialized. `@istar-ts/react`
shows them as badges and in the inspector (see its README).

## Credits

The metamodel, link constraints, element shapes, and file format are derived from
[piStar](https://github.com/jhcp/piStar) by João Pimentel and contributors, released under the MIT
License.
