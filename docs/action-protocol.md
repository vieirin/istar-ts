# The action protocol

`@istar-ts/actions` is a typed, checked, undoable way to edit an istar-ts model from anywhere:
the canvas, a language server's quick fix, a CLI, an LLM agent. It is a **subset** of
[Eclipse GLSP's action protocol](https://eclipse.dev/glsp/documentation/protocol/) over a
`ModelStore` — the same action names and shapes where the concept matches, in-process first,
transportable later with no change to clients. It is not a GLSP server: no `GModel`, no layout,
no `@eclipse-glsp/*` dependency, no Sprotty client.

## GLSP concept ↔ istar-ts

| GLSP concept                                           | istar-ts                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Source model, operation handlers, undo/redo            | `ModelStore` operations, `transaction`, `undo`/`redo`, `ModelChange` events           |
| Diagram configuration (types, type hints, edge checks) | `Metamodel` (`rules`, `canLink`, `KindShape`/`KindLine`), `registryForMetamodel`      |
| Tool palette / context actions                         | `PaletteDescription` (`@istar-ts/core`), the react registry's entries derived from it |
| Markers                                                | `GoalDiagnostic`, `DiagnosticsStore`                                                  |
| GModel                                                 | `@istar-ts/gmodel`'s schema; the React Flow canvas renders from it (`gmodelToFlow`)   |
| Client                                                 | the React Flow canvas; a Sprotty client is not planned                                |

## Vocabulary

`IstarAction` (`packages/actions/src/actions.ts`) is a discriminated union on `kind`, GLSP's
names and shapes where the concept is the same, iStar extras namespaced `istar.*`.

**Operations** (GLSP), each one `store.transaction`, so one undo step: `createNode`,
`createEdge` (a dependency kind creates its dependum and two links, as `addDependency` does; an
n-ary kind adds a leg or a new hub), `deleteElement`, `changeBounds`, `changeContainer`
(`nestElement`), `reconnectEdge`, `applyLabelEdit` (an element's or link's name, or a
`customProperties` key via `labelId = "<id>#<key>"`), `compound` (one `store.transaction` over
a list; if one child is rejected, none is applied).

**Operations** (`istar.*`): `istar.addLeg`, `istar.removeLeg`, `istar.setCollapsed`,
`istar.updateDiagram`, `istar.updateProperties`, `istar.updateDisplay` (an element's `display`
patch — colour, the auto-grown height — merged like `ElementPatch.display`), `istar.setLinkValue`
(an existing link's contribution value, e.g. make/help/hurt/break; `null` clears it),
`istar.updateLinkDisplay` (a link's `display` patch — its bend points, `vertices` — merged like
`LinkPatch.display`; GLSP's counterpart is `changeRoutingPoints`).

**Requests/responses** (GLSP): `requestModel`/`setModel` (the model as piStar JSON, via
`toPistar`), `requestTypeHints`/`setTypeHints` (shape and edge hints derived from the
metamodel), `requestCheckEdge`/`checkEdgeTargetResult` (`canLink`), `requestContextActions`/
`setContextActions` (the palette, as `LabeledAction`s), `requestMarkers`/`setMarkers`/
`deleteMarkers` (`GoalDiagnostic` ↔ GLSP's `Marker`). Requests carry `requestId`; their response
carries it back as `responseId`.

**Other** (GLSP): `glspUndo`, `glspRedo`, `saveModel` (through the dispatcher's `save` option),
`setDirtyState`, `triggerNodeCreation`, `triggerEdgeCreation`.

### The wire name and the TS interface disagree on one action

The model-changed notification's **wire `kind` is `sourceModelChanged`**, but its **TypeScript
interface is named `ModelSourceChangedAction`** (`packages/actions/src/actions.ts`). This is
intentional — not a typo to fix, and not something to rename in code: the wire string stays
`sourceModelChanged` because that is the JSON a client already receives and matches on
(`action.kind === 'sourceModelChanged'`), while the exported type keeps GLSP's own interface
name for readers coming from the GLSP docs. When grepping the source or writing a transport
adapter, look for `sourceModelChanged`; when importing the type, import
`ModelSourceChangedAction`.

Every other action's `kind` string and TypeScript type name match (`createNode` /
`CreateNodeOperation`, `requestModel` / `RequestModelAction`, and so on).

## The dispatcher contract

`createActionDispatcher(store, options) → StoreActionDispatcher`. `dispatch(action)` returns an
`ActionResult`:

```ts
type ActionResult<R = never> =
  | {
      ok: true;
      createdIds: readonly string[];
      response?: R;
      diagnostics?: readonly GoalDiagnostic[];
    }
  | { ok: false; diagnostics: readonly GoalDiagnostic[] };
```

A rejection (`ok: false`) leaves the model untouched — same model object, no undo step — with
`GoalDiagnostic[]` saying why: an unknown element, a link `canLink` refuses, a guard, a broken
property schema. **GLSP has no equivalent of this.** Its action protocol is a one-way wire
format; the closest thing GLSP defines is `RejectAction { kind: 'rejectRequest', message,
detail? }`, and that answers a malformed or unroutable _request_ at the transport level (see
[the GLSP protocol docs](https://eclipse.dev/glsp/documentation/protocol/)), not a semantically
invalid _operation_ — GLSP operations are fire-and-forget from the protocol's point of view,
with validation left to the server's own UI feedback. `ActionResult` is this package's answer
to that gap: every operation, in-process or over the transport, gets a typed, synchronous
verdict.

`options.guards?: ActionGuard[]` run before each operation (and each operation of a `compound`
one, against the model as the previous ones left it). A guard returns `GoalDiagnostic[] | void`;
`severity: 'error'` rejects the operation, other severities are returned alongside a
success. This is the seat for a host's rules — goal-controller's shield, or any other
check on who sent the action and what it does.

### Worked example: a guard that blocks a kind

A guard sees every operation and the model before it (here: no `istar.Task` may be created, but
other diagnostics ride along as warnings). This mirrors
`packages/actions/test/dispatcher.test.ts` ("guards" → "an error blocks the operation; other
severities pass with the result"), and is itself a compiled test
(`packages/actions/test/docs.test.ts`), so it cannot drift from the real contract:

```ts
import { createModelStore, ISTAR_2_0 } from '@istar-ts/core';
import { createActionDispatcher } from '@istar-ts/actions';
import type { ActionGuard } from '@istar-ts/actions';

const noTasks: ActionGuard = (operation) => {
  if (operation.kind === 'createNode' && operation.elementTypeId === 'istar.Task') {
    return [{ elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' }];
  }
};

const store = createModelStore(undefined, { metamodel: ISTAR_2_0 });
const dispatcher = createActionDispatcher(store, { guards: [noTasks] });
const actor = await dispatcher.dispatch({ kind: 'createNode', elementTypeId: 'istar.Actor' });
if (!actor.ok) throw new Error('setup failed');

const rejected = await dispatcher.dispatch({
  kind: 'createNode',
  elementTypeId: 'istar.Task',
  containerId: actor.createdIds[0],
});
// rejected = { ok: false, diagnostics: [{ elementId: '', severity: 'error', message: 'no tasks here', source: 'shield' }] }
```

A guard is plain data in, plain data out — it never touches the store — so it works identically
whether the action came from the in-process dispatcher or across the transport.

## Transport

`connectDispatcher(port)` / `createRemoteDispatcher(port)` (`packages/actions/src/transport.ts`)
carry an `ActionDispatcher` over a `MessagePort`-like object (`{ postMessage, onmessage }` — a
DOM `MessagePort`, a `Worker`, or a WebSocket adapter fits), framed as JSON-RPC 2.0.

**As shipped, the transport frames one JSON-RPC method per action kind**: a dispatch is a
request with `method = action.kind` and `params = action`, answered with the `ActionResult` as
`result`; `dispatcher.subscribe` events go server → client as notifications with the same
`method = action.kind` shape. This is _not_ the five-method envelope GLSP's real wire protocol
uses. Per [the GLSP protocol docs](https://eclipse.dev/glsp/documentation/protocol/), a GLSP
server speaks exactly five JSON-RPC methods — `initialize`, `initializeClientSession`,
`disposeClientSession`, `process` (one envelope, `ActionMessage { clientId, action }`, used for
every action in both directions) and `shutdown` — never `method = action.kind`. **A stock GLSP
client cannot connect to this transport today.** [#44](https://github.com/vieirin/istar-ts/issues/44)
proposes adopting that five-method envelope (`serverActions`/`clientActionKinds` negotiated at
`initialize`/`initializeClientSession`, `rejectRequest` for malformed frames, `ActionResult`
kept for operations since GLSP has nothing to replace it with); until it lands, treat this
package's transport as istar-ts-to-istar-ts (or a hand-rolled bridge), not a GLSP endpoint.

No dependency on `vscode-jsonrpc`. A host that wants that framing bridges to it itself: write a
`MessagePortLike` adapter whose `postMessage` calls the `vscode-jsonrpc` connection's
`sendRequest`/`sendNotification` and whose `onmessage` is driven by the connection's
`onRequest`/`onNotification`, then hand that adapter to `connectDispatcher` or
`createRemoteDispatcher` exactly as a `MessagePort` would be.

## Undo

There is **one undo stack**, the `ModelStore`'s, shared by every client of a dispatcher —
whoever sent the edit, `glspUndo`/`glspRedo` unwind the same history. This matches today's
single-editor use (the canvas, or one remote worker demo) and is simpler than GLSP's
collaboration extension, which gives each client its own stack. A host that needs per-client
undo would need its own `ModelStore` per session; the dispatcher does not offer that today.

## Limitations, by design

- `@istar-ts/glsp` ([packages/glsp](../packages/glsp), [docs/glsp.md](glsp.md)) now serves a
  stock GLSP client, wire-compatible on `@eclipse-glsp/server`/`@eclipse-glsp/client` 2.8.x: a
  real GModel, type hints, the GLSP lifecycle and operation handlers. This package
  (`@istar-ts/actions`) and `@istar-ts/core`/`@istar-ts/react` still take no GLSP or Inversify
  dependency — the adapter is a separate package that wraps this dispatcher.
- The React Flow canvas renders from the shared GModel: `@istar-ts/gmodel` builds the schema
  the GLSP server sends, and `<IstarCanvas>` derives its nodes and edges from that same schema
  (`gmodelToFlow`, [#165](https://github.com/vieirin/istar-ts/issues/165)), so both clients draw
  one graph. This dispatcher still carries piStar JSON, not GModel: in process, the canvas
  builds the GModel from the store's model itself.
- The transport below (`connectDispatcher`/`createRemoteDispatcher`) is still not GLSP's own
  wire protocol (see **Transport** above); [#44](https://github.com/vieirin/istar-ts/issues/44)
  tracks adopting that five-method envelope for this package's transport specifically. A stock
  GLSP client talks to `@istar-ts/glsp` instead, not to this transport.
- No modeller-specific actions or guards in istar-ts; those are an `IstarExtension` and guard
  code in the host.
- One undo stack, not one per client (see **Undo** above).
