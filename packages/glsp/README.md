# @istar-ts/glsp

A [GLSP](https://eclipse.dev/glsp/) server diagram module for istar-ts models, built on
`@eclipse-glsp/server` 2.8. A stock GLSP client opens a piStar file and sees it as a GModel.
GLSP, Inversify and `reflect-metadata` stay inside this package; it never depends on React.

The read side ([#80](https://github.com/vieirin/istar-ts/issues/80)): GModel, diagram
configuration, loading and saving. The write side
([#81](https://github.com/vieirin/istar-ts/issues/81)): operations, undo and model updates through
the istar-ts dispatcher, the palette, edge checks and markers. The hosts
([#82](https://github.com/vieirin/istar-ts/issues/82)): a Web Worker, a page and a Node
WebSocket server, a shared store, and an opt-in MCP server (see [Hosting](#hosting)).

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

| Tier    | Here                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core    | `IstarDiagramModule`, the manifest binding `IstarModelState`, `IstarSourceModelStorage`, `IstarGModelFactory` and `IstarDiagramConfiguration`. Generic over the metamodel.         |
| tool    | `IstarToolPaletteItemProvider`, `IstarRequestCheckEdgeActionHandler`, `IstarModelValidator`, `IstarLabelEditValidator` (`tools.ts`), all from the contribution and the dispatcher. |
| diagram | An `IstarGlspContribution`: the dialect's data (metamodel, palette, type overrides, property schemas), bound by its manifest `IstarContributionModule`.                            |

The core classes `@inject(IstarGlspContribution)`, so a dialect never subclasses them, and dialect
packages export plain values. `configureIstarDiagram` installs both manifests (plus any further
modules) under the contribution's diagram type. Contributions: `ISTAR_GLSP` (default),
`KAOS_GLSP` and `KAOS_OBSTACLES_GLSP` from `@istar-ts/glsp/kaos`, `NFR_GLSP` from
`@istar-ts/glsp/nfr` (they need `@istar-ts/dsm3-kaos` or `@istar-ts/dsm3-nfr`, optional peers).

`IstarModelState` holds one `ModelStore` for the whole session and the action dispatcher over it.
Loading a file `load`s that store (clearing its history) rather than replacing it, so a
`CommandStack` that maps GLSP's undo onto `store.undo()`/`store.redo()` can wrap it. A host can
bind its own store and dispatcher instead (`IstarSharedModel`, see [Hosting](#hosting)).

## The write side: one dispatcher, one undo stack

Every GLSP edit goes through the session's istar-ts dispatcher, so guards, rejections,
transactions and the undo stack behave exactly as for the React Flow canvas (flow similarity,
Metin & Bork §4.1.4).

- **Operations.** `createNode`, `createEdge`, `deleteElement`, `changeBounds`, `changeContainer`,
  `reconnectEdge`, `applyLabelEdit` and `compound` each have an `IstarOperationHandler`, which hands
  the operation to `translateOperation` and dispatches the result. The translation maps GModel
  types back to kinds, `<id>_anchor` to its link, the root to "no container", `<id>_label` to a
  name edit and `<id>_value` to `istar.setLinkValue`, and positions back to absolute ones:
  `createNode` locations are absolute (as GLSP sends them), `changeBounds` positions relative to
  the parent node (an actor moves by its boundary's offset), and `changeContainer`'s location is
  read relative to the new container. A size GLSP sends with an unchanged move isn't written to
  `display`. A dependency creates its dependum, an n-ary link its hub or a leg, with the args the
  React canvas sends. A `compound` is one istar-ts `compound`: one undo step, all or nothing.
  Operations with no istar-ts counterpart (`changeRoutingPoints`) are skipped.
- **Flat args.** GLSP's `args` are primitives, so the palette's presets travel as
  `customProperties.<key>`, `value` and `dependumKind` (`GLSP_ARGS`).
- **Undo.** `IstarCommandStack` keeps no commands: `undo`/`redo` dispatch `glspUndo`/`glspRedo`,
  `canUndo`/`canRedo` ask the store. An edit made through GLSP and undone by another client (or
  the reverse) is gone for both.
- **Dirty state** is the dispatcher's `isDirty`. GLSP's `saveModel` saves through the
  dispatcher's `saveModel` (the model state writes the file), so either path marks the model
  clean.
- **Updates.** After an accepted operation, undo or redo the session sends `updateModel` (no
  bounds round trip). Changes by the store's other clients are pushed too: `IstarStoreListener`
  hears the dispatcher and queues an internal `istar.storeChanged` on the session's action queue,
  answered with `updateModel`, or `setDirtyState` after another client's save.
- **Rejections.** GLSP has no failure answer to an operation: a rejected one (`{ ok: false }`, or
  an unknown id) sends the unchanged model again (so the client drops its feedback), a
  `message` (severity `ERROR`) and markers on the elements it names
  (`reason: 'istar.rejection'`), cleared by the next accepted edit. Guard warnings on an
  accepted edit are a `WARNING` message.
- **Client-bound actions** the client did not list in `clientActionKinds` (a `status` from
  live validation, a `message`) are dropped by `IstarClientActionForwarder`, not an error.

**For client authors:** GLSP sends a client only the action kinds it lists in
`initializeClientSession`'s `clientActionKinds`. Besides `setModel`, `updateModel` and
`setDirtyState`, list **`status`**, **`message`** and **`setMarkers`** (and `deleteMarkers`), or
rejections and validation never reach the user. A stock `@eclipse-glsp/client` lists every kind
its container handles (`GLSPModelSource`, `getHandledActionKinds`): `status` with the status
module, `setMarkers` with the validation module. In a standalone app `message` only reaches a
`FallbackActionHandler`, which logs it, so the app should bind a handler that shows it.

## Hosting

Three launchers, each a subpath, all built on `createIstarServerModules(options)` (the server
module with every contribution's diagram, plus the host's modules). Options shared by all:
`contributions` (default `[ISTAR_GLSP]`), `files` (`PistarFiles`), `shared`, and extra
`modules`/`diagramModules`.

### A shared store

By default each GLSP session has its own store, loaded by `requestModel`'s `sourceUri`. A host
that already has a model passes `shared: { store, dispatcher }` (an `IstarSharedModel`; the
token of the same name, `bindIstarSharedModel` binds it). Every session of that diagram type then
uses that store and dispatcher, and so does whatever else the host gives them to (a React Flow
canvas, a `connectDispatcher` port): one model, one undo stack, one dirty state.

- `requestModel` shows the shared model and reads no file (`sourceUri` is ignored).
- Saves go through the dispatcher, so to the host's `save` option.
- An edit is pushed exactly once to every session: the session that made it sends its own
  `updateModel`, and every other session hears it from the dispatcher as another client's
  change. This relies on the dispatcher applying an operation before its first `await`
  (`IstarModelState.ownChange` is per session), which `@istar-ts/actions` guarantees.
- A session's store listener unsubscribes when the session is disposed. A shared dispatcher is
  never disposed by a session; a session's own one is.

`createIstarSharedModel(contribution, { model, save })` makes a store and dispatcher set up as a
session's would be (the contribution's metamodel, palette and schemas), for hosts without one.

### In a Web Worker: `@istar-ts/glsp/browser`, `@istar-ts/glsp/page`

```ts
// worker.ts (a module worker)
import { startIstarGlspWorker } from '@istar-ts/glsp/browser';
void startIstarGlspWorker({ url: '/models/welcome.txt' }); // or { model: text }, { contribution }
```

The model lives in the worker, in one store every session shares. GLSP runs on the worker
itself, with the transport of upstream's `WorkerServerLauncher` (vscode-jsonrpc's
`BrowserMessageReader`/`Writer`, framework-notes §3), so a stock client connects with
`GLSPWebWorkerProvider`, or with a `MessageConnection` over the `Worker` it made. GLSP messages
sent while the model loads are kept until the server listens. Saves go to `files` (default in
memory) under `saveModel`'s `fileUri`, else `sourceUri` (default: the URL's file name).

The page reaches the same model as an istar-ts action client on a second port:

```ts
import { connectWorkerDispatcher } from '@istar-ts/glsp/page'; // no GLSP in the page's bundle
const dispatcher = connectWorkerDispatcher(worker); // posts { kind: 'istar.dispatcherPort', port }
await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Goal', location });
```

Built with Vite (`test/vite-build.test.ts`), the worker chunk is about 534 kB minified (135 kB
gzip); the page's `@istar-ts/glsp/page` code is under 2 kB.

### In the page: `serveIstarGlsp`

```ts
import { serveIstarGlsp } from '@istar-ts/glsp/browser';
const { port1, port2 } = new MessageChannel();
serveIstarGlsp(port2, { shared: { store, dispatcher } }); // the canvas's own store
// The stock client: createMessageConnection(new BrowserMessageReader(port1),
//   new BrowserMessageWriter(port1)) as BaseJsonrpcGLSPClient's connectionProvider.
```

One call per GLSP client. **This is the route for a page that shows a React Flow canvas and a
stock GLSP client side by side** (#85): `<IstarCanvas>` renders from a `ModelStore` in the page,
so sharing that store with the GLSP server needs no syncing at all. The worker route would leave
the page with only a remote dispatcher and no store for the canvas to render. The cost is the
GLSP server on the page's main thread, on that page only.

### In Node: `@istar-ts/glsp/node`

```ts
import { diskPistarFiles, startIstarGlspServer } from '@istar-ts/glsp/node';
const server = await startIstarGlspServer({ files: diskPistarFiles('models'), port: 8081 });
server.url; // ws://127.0.0.1:8081/istar
```

Upstream's `WebSocketServerLauncher`: every connection gets its own GLSP server (with `shared`,
all of them edit the host's model). `diskPistarFiles(root)` refuses paths outside `root`. The
host defaults to `127.0.0.1`.

`pnpm --filter @istar-ts/glsp serve <file.txt> [--port 8081] [--diagram istar|kaos|nfr] [--mcp]`
builds the package and serves one file as a shared model; `saveModel` writes it back.

### MCP

`startIstarGlspServer({ mcp: true })` (or `{ port, route, name }`) adds
`@eclipse-glsp/server-mcp`'s server and diagram modules: an MCP server on `127.0.0.1`, no
authentication, started with each connection's first `initialize` whether or not the client
asks for it, its URL returned as `initialize`'s `mcpServer.url` (port 0, a free one, by default).
Off by default. `@eclipse-glsp/server-mcp` is an optional peer dependency pinned to `2.8.0`:
upstream marks it `@experimental` (framework-notes §5, §8). Node only; the browser launchers
have no MCP.

## Decorators

Inversify 6 needs TypeScript's legacy decorators. This package alone sets
`experimentalDecorators`; tsdown (oxc) emits them, and every constructor parameter has an
explicit `@inject(TOKEN)`, so no `emitDecoratorMetadata` (which needs whole-program types). The
entry points (`index`, `node`, `browser`) import `reflect-metadata` first; `page` imports none of
GLSP, Inversify or `reflect-metadata`.
