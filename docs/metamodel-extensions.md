# Design note: extensible metamodel

Status: implemented on `metamodel-extensions`. The API is documented in the core and react READMEs
("Extending the metamodel"). This note records why it looks the way it does.

## Problem

piStar-ext ([iStar 2020, CEUR Vol-2641 paper 6](https://ceur-ws.org/Vol-2641/paper_06.pdf);
[code](https://github.com/guiRodrigues/pistar-supporting-creation-istar-extensions), commit
`830a4e3`) lets a modeller add constructs to iStar. The paper's example is iStar4RationalAgents,
with new nodes Planning and Plan. A construct has:

- a name;
- an SVG path;
- Node or Link;
- for links, the kinds it may connect and a line style.

istar-ts couldn't represent any of them:

- the kinds were closed unions and per-kind tables;
- `parsePistar` threw on unknown types;
- `canLink` only knew iStar 2.0.

goal-controller's stress test
(`packages/definitions/docs/pistar-ext-support.md`) listed exactly these gaps.

## Decisions

**A metamodel is a value.** `ISTAR_2_0` is built from the existing constants (`ELEMENT_KINDS`,
`NODE_KIND_INFO`, `LINK_KIND_INFO`, …), which stay exported and unchanged.
`extendMetamodel(base, extension)` returns a new metamodel and never mutates `base`. Every API
that takes a metamodel defaults to `ISTAR_2_0`, so code that never mentions one behaves exactly as
before.

**`behavesLike` instead of copying rules.** piStar-ext generates an `isValid` for each new link by
copying OR-refinement's checks and replacing the source/target lists. Here, a new kind names the
kind whose rules it follows:

- The iStar 2.0 checks compare _effective_ kinds. A Planning that behaves like a Task passes Task's
  rules: it can refine and be refined, be a dependum, and need resources.
- A link that behaves like OR-refinement counts as one for the rules that look at other links: no
  mixing with AND, and no refining a depender.

This keeps the upstream rules in one place and their messages identical.

**Declarative link rules for new links.** These are piStar-ext's source/target lists, plus the
iStar 2.0 Guide's node-link constraints as defaults:

- same actor (page 14);
- no dependum;
- no self link;
- one link of the kind per pair.

Each default can be turned off. An optional `check(context)` predicate covers anything else.
Dependency-category kinds must behave like `istar.DependencyLink`, because their dependum makes
source/target rules ambiguous.

**Namespaced kinds, `pistarType` for the file.** Kinds are `namespace.Name`, and `istar.` is
reserved, so an extension can never shadow or redefine an iStar 2.0 kind. piStar-ext, however,
saves new constructs as `istar.<Name>`, so a kind may declare the `type` it uses on disk:

- a kind _with_ `pistarType: 'istar.Planning'` reads and writes piStar-ext's files;
- a kind _without_ it writes its namespaced name, which plain piStar rejects.

Collisions are checked on names and on piStar types alike.

**The metamodel lives beside the model.** A model read or created with a metamodel is associated
with it in a `WeakMap` (`metamodelOf`, `withMetamodel`). Operations and store snapshots
(undo/redo) carry the association. Putting it in the model would have changed the model's shape,
and hosts deep-compare models and snapshots. It would also have risked reaching JSON and disk.
The cost: a model rebuilt with an object spread falls back to iStar 2.0. Then `toPistar` throws
`PistarWriteError` for the unknown kinds rather than writing them wrongly, and `withMetamodel`
restores the association.

**Types stay narrow by default.** `ElementKind`, `LinkKind` and the other exports are unchanged.
`IstarModel`, `IstarElement`, `IstarLink`, `ModelStore`, `Metamodel`, `IstarRegistry`,
`IstarCanvasProps` and `Tool` gained kind parameters that default to the iStar 2.0 unions.
`extendMetamodel` infers the new kinds' literal types.

Overloaded functions (`parsePistar`, `createEmptyModel`, `createModelStore`, `createRegistry`) are
written so that existing code types exactly as before:

- the iStar 2.0 signature comes last, because TypeScript resolves a function reference against the
  last overload (e.g. `useIstarStore(createEmptyModel)`, `texts.map(parsePistar)`);
- the generic signatures require an inference source, either a typed model or an explicit
  `metamodel`.

Type tests pin all of this.

**Presentation stays in react.** Core has no DOM. The SVG path (`ElementKindConfig.shape`) and the
line style (`LinkKindConfig.line`) belong to the react registry, completed for the model's
metamodel by `registryForMetamodel`.

Without them, rendering follows piStar:

- an extended node with no shape is piStar's `DefaultNode`, a dashed box with its «stereotype»;
- an extended link looks like the kind it behaves like, or is a continuous line with an open arrow;
- `pathBounds` scales path data to the element without a DOM, as JointJS's `resetOffset` does.

## Not done

- **Importing piStar-ext's construct definitions.** They live in the browser's localStorage, not in
  the model file; the file only has an `extension` block for stereotypes, tagged values and
  groupers. A host must supply the matching extension. Reading those definitions (or a JSON export
  of them) into a `MetamodelExtension` is a small follow-up.
- **piStar-ext's stereotypes and tagged values on actors and links.** They round-trip as unknown
  keys (`extra`). Displaying and editing them is a react concern, for an extension `component`
  and `inspector`.
- **OCL constraints.** Not in piStar-ext either. The `check` predicate is the hook for named checks.
