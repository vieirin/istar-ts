# @istar-ts/glsp

A [GLSP](https://eclipse.dev/glsp/) server diagram module for istar-ts models, built on
`@eclipse-glsp/server` 2.8. A stock GLSP client opens a piStar file and sees it as a GModel.
GLSP, Inversify and `reflect-metadata` stay inside this package; it never depends on React.

This is the read side ([#80](https://github.com/vieirin/istar-ts/issues/80)): GModel, diagram
configuration, loading and saving. Operation handlers, undo and the palette provider come next
([#81](https://github.com/vieirin/istar-ts/issues/81)), launchers and hosts after that
([#82](https://github.com/vieirin/istar-ts/issues/82)).

```ts
import { ContainerModule } from 'inversify';
import { ServerModule } from '@eclipse-glsp/server';
import { ISTAR_GLSP, PistarFiles, configureIstarDiagram, memoryPistarFiles } from '@istar-ts/glsp';
import { KAOS_GLSP } from '@istar-ts/glsp/kaos';

const serverModule = new ServerModule();
configureIstarDiagram(serverModule, ISTAR_GLSP); // diagram type 'istar'
configureIstarDiagram(serverModule, KAOS_GLSP); // diagram type 'kaos'

// The host says where files come from (a Node host reads the disk, a worker its page).
const host = new ContainerModule((bind) => {
  bind(PistarFiles).toConstantValue(memoryPistarFiles(new Map([['model.txt', text]])));
});
// …load serverModule and host into the launcher's container, as GLSP's launchers do.
```

A client then sends `requestModel` with `{ sourceUri: 'model.txt' }` and gets `setModel`.

## The GModel

`modelToGModel(model, { types })` is a pure function of the model and its metamodel
(`metamodelOf`):

- **Types**, one rule: element kind `K` → `node:K`, link kind `K` → `edge:K` (hubs, legs and ends
  included), unless the contribution's `types` overrides the kind. Besides those: `graph` (the
  root), `label`, and `node:link-anchor`. `gmodelTypes(metamodel, overrides)` lists them all and
  maps them back to kinds.
- **Ids** are the model's: one `GNode` per element, one `GEdge` per link. Labels are
  `<id>_label` (names) and `<id>_value` (a link's value, e.g. a contribution's `help`).
- **Actors** are containers. The actor's node sits at its boundary's top-left corner: the kind's
  default size at the actor's `x`/`y`, grown to hold its elements plus 10px, as the React canvas
  and piStar draw it. Its elements are children, at `child.x - boundary.x`,
  `child.y - boundary.y`. A collapsed actor is a 60×60 node without children; its elements'
  dependency links end on it and their other links are hidden, as in piStar.
- **Dependums** are top-level nodes (class `dependum`); an n-ary link's **hub** is a small node.
- **Sizes and positions** come from the model (absolute `x`/`y`, `display` sizes, the kind's
  default size), so `needsClientLayout` is `false` and updates need no bounds round trip.
- A link that **targets a link** (NFR's Argument) ends on an anchor node on the middle of that
  link (`<id>_anchor`), as DSM3-goals draws it. Links of kinds that may be targeted all get one.
- **Custom properties** are not copied into `args`: GLSP uses `args` for rendering options.

The piStar file is both the semantic model and its layout, so the notation is derived from it,
not stored beside it: a deliberate difference from Metin & Bork's separate source model and
representations (§4.1.3, [docs/papers/metin-bork-2025.md](../../docs/papers/metin-bork-2025.md)).

## Feature tiers, manifests and contributions

After the reference architecture's tiers (§4.1.1) and its manifests and contributions through DI
(§4.1.2, bigUML §5.1.1), on the GLSP server's own Inversify container:

| Tier    | Here                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core    | `IstarDiagramModule`, the manifest binding `IstarModelState`, `IstarSourceModelStorage`, `IstarGModelFactory` and `IstarDiagramConfiguration`. Generic over the metamodel. |
| tool    | Nothing yet (palette provider and validation arrive with #81).                                                                                                             |
| diagram | An `IstarGlspContribution`: the dialect's data (metamodel, palette, type overrides, property schemas), bound by its manifest `IstarContributionModule`.                    |

The core classes `@inject(IstarGlspContribution)`, so a dialect never subclasses them, and dialect
packages export plain values. `configureIstarDiagram` installs both manifests (plus any further
modules) under the contribution's diagram type. Contributions: `ISTAR_GLSP` (default),
`KAOS_GLSP` and `KAOS_OBSTACLES_GLSP` from `@istar-ts/glsp/kaos`, `NFR_GLSP` from
`@istar-ts/glsp/nfr` (they need `@istar-ts/dsm3-kaos` or `@istar-ts/dsm3-nfr`, optional peers).

`IstarModelState` holds one `ModelStore` for the whole session and the action dispatcher over it.
Loading a file `load`s that store (clearing its history) rather than replacing it, so a
`CommandStack` that maps GLSP's undo onto `store.undo()`/`store.redo()` can wrap it.

## Decorators

Inversify 6 needs TypeScript's legacy decorators. This package alone sets
`experimentalDecorators`; tsdown (oxc) emits them, and every constructor parameter has an
explicit `@inject(TOKEN)`, so no `emitDecoratorMetadata` (which needs whole-program types). The
entry point imports `reflect-metadata` first.
