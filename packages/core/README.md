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
  Omit it to preserve the model’s existing `saveDate` on a load/save cycle.

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
patches, preserves unknown keys, and serializes typed values back to strings.

## Credits

The metamodel, link constraints, element shapes, and file format are derived from
[piStar](https://github.com/jhcp/piStar) by João Pimentel and contributors, released under the MIT
License.
