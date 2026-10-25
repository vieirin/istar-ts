# @istar-ts/gmodel

The GModel ([GLSP](https://eclipse.dev/glsp/)'s notation model) of an istar-ts model, as plain
schema JSON: the one graph both `@istar-ts/glsp`'s server and any other client draw. Framework-free:
it depends on `@istar-ts/core` and `@istar-ts/actions` only, with no GLSP, Sprotty, Inversify or
React.

```ts
import { parsePistar } from '@istar-ts/core';
import { modelToGModelSchema } from '@istar-ts/gmodel';

const graph = modelToGModelSchema(parsePistar(text));
// { id: 'istar-graph', type: 'graph', children: [{ id, type: 'node:istar.Actor', position,
//   size, args: { kind: 'istar.Actor', customProperties: { … } }, children: [...] }, …] }
```

`@istar-ts/glsp`'s `IstarGModelFactory` turns this schema into its root with GLSP's
`GModelSerializer`, so `setModel` and `updateModel` carry exactly this JSON (plus the root's
`revision`).

## The schema

GLSP's wire shape, declared here (`GGraphSchema`, `GNodeSchema`, `GEdgeSchema`, `GLabelSchema`):
every element has `id`, `type`, `children` and `cssClasses`; nodes have `position` (relative to
their parent node) and `size`; edges `sourceId`, `targetId` and absolute `routingPoints`; labels
`text`, and either a `position` (on a node) or an `edgePlacement` (on an edge). `isGNodeSchema`,
`isGEdgeSchema` and `isGLabelSchema` tell them apart without reading `type`.

- **Kinds.** Every node and edge that stands for an element or link carries its kind verbatim in
  `args.kind`. Read the kind there, never from `type`.
- **Types** say how an element is drawn. One rule: element kind `K` → `node:K`, link kind `K` →
  `edge:K`, unless `options.types` overrides the kind. Besides those: `graph`, `label`, and
  `node:link-anchor`. `gmodelTypes(metamodel, overrides)` lists them and maps them back. The type
  stays `node:<kind>` rather than the bare kind: GLSP's types follow `<basic>:<sub>`, the GLSP
  client's views are registered by it, and an override replaces it anyway.
- **Element fields** the graph doesn't model, verbatim in `args`: `customProperties` (string values,
  unknown keys kept), `display` and `extra` (the file's unknown keys). GLSP types `args` as
  primitives; these three are objects, which the wire carries unchanged.
- **Ids** are the model's. Labels are `labelId(id)` (`<id>_label`, names) and `valueLabelId(id)`
  (`<id>_value`, a link's value such as a contribution's `help`).
- **Actors** are containers at their boundary's corner (core's `actorBounds`), their elements
  children. A collapsed actor is a 60×60 node without children; its elements' dependency links
  end on it and their other links are hidden, as in piStar.
- **Dependums** are top-level nodes (class `dependum`); an n-ary link's hub is a small node.
- **Sizes** come from `display` width/height, else `options.sizes`, else the kind's size in the
  metamodel.
- A link that **targets a link** ends on that link's anchor node (`linkAnchorId(id)`), on its
  middle. Every link of a kind some link kind may target has one.

Nothing in the package names a dialect: kinds, categories, sizes and the kinds a link may target
all come from the model's metamodel (`metamodelOf`), so iStar 2.0, KAOS, NFR and any
`extendMetamodel` result go through the same code.
