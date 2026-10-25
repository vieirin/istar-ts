# GLSP server and client

[#74](https://github.com/vieirin/istar-ts/issues/74) adds a second front end: a stock
[GLSP](https://eclipse.dev/glsp/) client (Sprotty-based, `@eclipse-glsp/client` 2.8.x) talking
JSON-RPC to a GLSP server (`@eclipse-glsp/server` 2.8.x) built around istar-ts's existing
dispatcher. The React Flow canvas (`@istar-ts/react`) stays the primary, embeddable client;
`@istar-ts/core` and `@istar-ts/react` take no GLSP dependency. This follows the reference
architecture of Metin & Bork, "A reference architecture for the development of GLSP-based web
modeling tools" (SoSyM 24(6), 2025) — transcribed at
[docs/papers/metin-bork-2025.md](papers/metin-bork-2025.md) — and names its terms below.

## The architecture, in the paper's terms

The paper's §4.1.1 splits a GLSP tool into **core** (language-independent), **tool**
(generic UI features: palette, validation, markers) and **diagram** (language-specific)
modules, wired together through **manifests and contributions** (§4.1.2) over Inversify DI.
`@istar-ts/glsp` ([packages/glsp](../packages/glsp)) follows this on the GLSP server's own
container (see its README's "Feature tiers, manifests and contributions" for the concrete
classes):

| Tier    | Here                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| core    | `IstarDiagramModule`: `IstarModelState`, `IstarSourceModelStorage`, `IstarGModelFactory`, `IstarDiagramConfiguration`.  |
| tool    | `IstarToolPaletteItemProvider`, `IstarRequestCheckEdgeActionHandler`, `IstarModelValidator`, `IstarLabelEditValidator`. |
| diagram | An `IstarGlspContribution` (metamodel, palette, type overrides, property schemas), bound by `IstarContributionModule`.  |

The core classes `@inject(IstarGlspContribution)` rather than subclassing it per dialect, so a
new dialect is a value, not a new class. `contributionFor(metamodel, options?)` builds one from
any metamodel at runtime (iStar 2.0, KAOS, NFR, or a host's own `extendMetamodel` result);
`ISTAR_GLSP`, `KAOS_GLSP`, `KAOS_OBSTACLES_GLSP` (`@istar-ts/glsp/kaos`) and `NFR_GLSP`
(`@istar-ts/glsp/nfr`) are calls to it. `configureIstarDiagram(serverModule, contribution)`
installs both manifests under the contribution's diagram type.

Every GLSP edit — from either client — goes through the same istar-ts action dispatcher as the
React Flow canvas: one set of `canLink` guards, one undo stack, one `isDirty`. This is the
paper's **flow similarity** (§4.1.4): the same conceptual edit flow regardless of which client
triggered it. See `@istar-ts/glsp`'s README ("The write side") for the operation-to-action
translation, undo/redo (`glspUndo`/`glspRedo`), and how rejections and guard warnings surface
as GLSP markers and messages, since GLSP itself has no failure response to an operation.

### Deliberate differences from the paper

- **One file holds both the semantic model and its layout.** The paper's reference
  architecture keeps a source model and its GModel notation apart (§4.1.3); istar-ts's piStar
  file format requires absolute positions alongside the semantic data, so there is nothing to
  keep apart. `modelToGModelSchema(model, { types, sizes })` (`@istar-ts/gmodel`) derives the
  GModel from that one file on every read; it is never stored separately.
- **No model server.** The paper's rule of thumb is to add one past roughly 30 metamodel
  elements (§6.6/"The '~30 metamodel elements' rule"); iStar 2.0 is under that, KAOS with
  obstacles is close. `IstarModelState` holds one in-memory `ModelStore` per session (or a
  shared one, see "Hosting" below); this is revisited if a dialect grows past the threshold.
- **One shared undo stack**, not one per client. `IstarCommandStack` keeps no commands of its
  own: `undo`/`redo` dispatch `glspUndo`/`glspRedo` on the shared dispatcher, so an edit made
  through one client and undone through another is gone for both. [docs/action-protocol.md](action-protocol.md)
  documents this for the existing dispatcher API; it holds for GLSP sessions too.
- **React Flow, not Sprotty, is the primary client.** The stock `@eclipse-glsp/client` in
  `examples/glsp-client` is a second front end connected to the same server, for parity testing
  and for showing both clients on one model (`/both.html`, below) — not a replacement for
  `<IstarCanvas>`.

### One graph for both clients

Both clients draw the same GModel ([#143](https://github.com/vieirin/istar-ts/issues/143)):
`modelToGModelSchema` (`@istar-ts/gmodel`, GLSP-free) builds it; the GLSP server sends it on the
wire, and `<IstarCanvas>` derives its React Flow nodes and edges from it with `gmodelToFlow`
(`@istar-ts/react`, [#165](https://github.com/vieirin/istar-ts/issues/165)) instead of walking
the model itself. So the two clients can't disagree on structure or geometry: which elements
are drawn, nesting, collapsed actors, links on links, and every element's box. React passes its
registry's sizes (`registrySizes(registry)`) as the GModel's `sizes`, as a GLSP contribution
for the same host does, so a kind the registry resizes is the same size in both (#154). The
playground's `test/gmodel-flow.test.ts` checks this for every fixture against the server's own
`setModel`, and `e2e/cross-client.spec.ts` compares the drawn boxes on `/both.html`.

`@istar-ts/react` depends on `@istar-ts/gmodel`, never on `@istar-ts/glsp` or Inversify. The
canvas reads each element's and link's kind from `args.kind`, never from the GModel type, and
the node and edge components draw what the GModel carries:

| What the canvas draws                                                           | From                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Which nodes and edges exist, nesting (`parentId`), positions, sizes, origins    | GModel nodes, edges and their `position`/`size`      |
| Collapsed actors, dependums                                                     | `cssClasses` (`collapsed`, `dependum`)               |
| Names, a link's value and name                                                  | `label` children (`<id>_label`, `<id>_value`)        |
| Kind, `customProperties`, `display`, `extra` (the components' `element`/`link`) | `args`                                               |
| A link's vertices                                                               | `routingPoints`                                      |
| Which links have an anchor that links may target                                | `node:link-anchor` nodes                             |
| Components, icons, titles, line styles, frameless actors (`boundary: false`)    | the registry (presentation)                          |
| Where an anchor sits on its link                                                | the registry's drawing: the middle of the drawn link |
| What the inspector edits, and the canvas's own edits (drag, resize, connect)    | the model, by id                                     |

An anchor's position is React's own because React draws links border to border, round an
actor's symbol and smoothly through vertices (piStar's look), while Sprotty draws polylines:
the GModel's anchor sits on the polyline, React's on the line React draws, so a link targeting
it ends on the drawn line in each client.

## Running it

### The worker and Node servers

A Web Worker host (`@istar-ts/glsp/browser`'s `startIstarGlspWorker`) and a Node WebSocket host
(`@istar-ts/glsp/node`'s `startIstarGlspServer`) are both built on `createIstarServerModules`.
See `packages/glsp`'s README ("Hosting") for the full API, including the in-page route
(`serveIstarGlsp`, no socket, over a `MessageChannel`) and the opt-in MCP server
(`{ mcp: true }`) on all three launchers. From the command line:

```sh
pnpm --filter @istar-ts/glsp serve <file.txt> [--port 8081] [--diagram istar|kaos|nfr] [--mcp]
```

This builds the package and serves one file as a shared model over `ws://127.0.0.1:8081/istar`;
`saveModel` writes it back to disk (`diskPistarFiles`, path-confined to the given root).

### The example client

`examples/glsp-client` is a stock `@eclipse-glsp/client` (standalone, no Theia/VS Code), wired
up by `mountGlspClient` (`examples/glsp-client/src/mountGlspClient.ts`) with default Sprotty
views plus iStar-specific ones (`istar-views.ts`) and element type hints (`elementTypes.ts`).
The playground serves it two ways:

- **`/glsp.html`** — the stock client alone, over a fixture picker (iStar 2.0, KAOS or NFR
  "welcome" fixtures). The default connection is in-page (`serveIstarGlsp`, shared with the
  client through a `MessageChannel`); `?server=worker` uses the Vite module worker
  (`examples/playground/src/glsp/worker.ts`); `?server=ws://host:port/path` connects to the
  Node launcher above. `?debug=actions` logs the client/server action traffic to the console.
- **`/both.html`** — `<IstarCanvas>` and the stock client side by side over one `ModelStore`
  and one dispatcher (`BothApp.tsx`, `examples/playground/src/both/`), wrapped twice
  (`tagClient`) so the shared action log tells "React" edits from "GLSP" ones; undoing either
  client's last edit undoes the other's too, since it's one undo stack. The agent drawer
  (below) is a third tagged client on the same dispatcher.

```sh
pnpm dev   # playground; open /glsp.html or /both.html
```

### The agent drawer

The agent drawer (`examples/playground/src/agent/`, [#126](https://github.com/vieirin/istar-ts/issues/126))
is a chat panel that drives the model through the istar MCP tools over its own headless GLSP
session on the shared dispatcher (`glspMcpBackend.ts`'s backend A), tagged `"Agent"` in
`/both.html`'s action log like the React and GLSP clients. It builds its `IstarGlspContribution`
from the active model's own metamodel at runtime (`contributionFor`, plus the active
`IstarExtension`'s palette and schemas, if any) rather than a hard-coded dialect switch, so any
extension's kinds and link rules reach the agent. See `@istar-ts/glsp`'s README ("MCP") for the
three istar-specific MCP tools (`set-properties`, `set-link-value`, `check-edge`) that fill the
gap `@eclipse-glsp/server-mcp` has no equivalent for, and
[docs/agent/verification.md](agent/verification.md) for how the drawer verifies its own tool
calls.

## How a dialect contributes

A dialect package (`@istar-ts/dsm3-kaos`, `@istar-ts/dsm3-nfr`, or a host's own
`extendMetamodel` result) needs no GLSP-specific code to reach either client. It contributes:

- its **metamodel** (element/link kinds, `canLink` constraints, default sizes);
- its **palette** (`AnyPaletteDescription`, the same one `@istar-ts/react` uses for the
  canvas's palette panel) — or none, and `contributionFor` derives a flat one from the
  metamodel's own kinds;
- its **property schemas**, for custom-property validation on both clients;
- optional **type overrides**, where a kind's GModel type string differs from the default
  `node:<kind>` / `edge:<kind>` rule.

`contributionFor(metamodel, { diagramType, palette?, schemas?, types? })` turns those into an
`IstarGlspContribution`; `configureIstarDiagram` binds it into a `ServerModule` under its
diagram type. `@istar-ts/glsp/kaos` and `@istar-ts/glsp/nfr` (separate entry points, so the
package root never needs `@istar-ts/dsm3-kaos` or `@istar-ts/dsm3-nfr`) show the pattern for
`KAOS_GLSP`, `KAOS_OBSTACLES_GLSP` and `NFR_GLSP`. No part of `@istar-ts/glsp`'s core or tool
tier hardcodes a dialect's kinds, so KAOS and NFR work without adapter changes — the same rule
CLAUDE.md states for `@istar-ts/react`'s registry.

## Protocol and limitations

[docs/action-protocol.md](action-protocol.md) describes istar-ts's own action dispatcher and
protocol, used by both the React Flow canvas and (through `@istar-ts/glsp`) the GLSP server;
its "Limitations, by design" section is the place to check what is and isn't wire-compatible
with a stock GLSP client today.
