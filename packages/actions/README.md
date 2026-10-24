# @istar-ts/actions

A typed, checked, undoable way to edit an istar-ts model from anywhere: the canvas, a language
server's quick fix, a CLI, an LLM agent. A subset of the
[GLSP action protocol](https://eclipse.dev/glsp/documentation/protocol/) over a `ModelStore`,
framework-free, depending only on `@istar-ts/core`.

```ts
import { createModelStore } from '@istar-ts/core';
import { createActionDispatcher } from '@istar-ts/actions';

const store = createModelStore(model);
const dispatcher = createActionDispatcher(store, {
  guards: [(operation, model) => /* host rules */ []],
});

const result = await dispatcher.dispatch({
  kind: 'createNode',
  elementTypeId: 'istar.Goal',
  containerId: actorId,
  location: { x: 120, y: 80 },
});
if (result.ok) console.log(result.createdIds);
else console.log(result.diagnostics); // GoalDiagnostic[]; the model is untouched

dispatcher.subscribe((action) => {
  if (action.kind === 'sourceModelChanged') refresh();
});
```

- **Operations** (one undo step each): `createNode`, `createEdge` (a dependency creates its
  dependum and two links), `deleteElement`, `changeBounds`, `changeContainer`, `reconnectEdge`,
  `applyLabelEdit` (`"<id>"` for a name, `"<id>#<key>"` for a custom property), `compound`, and
  `istar.addLeg`, `istar.removeLeg`, `istar.setCollapsed`, `istar.updateDiagram`,
  `istar.updateProperties`.
- **Requests**: `requestModel` (the piStar file), `requestTypeHints` (from the metamodel),
  `requestCheckEdge` (`canLink`), `requestContextActions` (the palette, `DEFAULT_PALETTE` unless
  the `palette` option says otherwise), `requestMarkers` (link and property issues, and the host's
  diagnostics, as GLSP markers).
- `glspUndo`, `glspRedo`, `saveModel` (through the `save` option), and the notifications
  `sourceModelChanged` and `setDirtyState` sent to subscribers.

Every action and result is plain JSON, so an `ActionDispatcher` can live across a
`postMessage`.

## Transport

`connectDispatcher`/`createRemoteDispatcher` carry an `ActionDispatcher` over a
`MessagePort`-like object (`{ postMessage, onmessage }` — a DOM `MessagePort` or a worker fits),
framed as JSON-RPC 2.0: a dispatch is a request (`method` = the action's `kind`, `params` = the
action), answered with the `ActionResult` as `result`; `subscribe` events go server to client as
notifications. A rejection (`ok: false`) is a normal result, not a JSON-RPC error — only a
malformed frame or an unhandled exception is (`-32600`/`-32601`/`-32603`).

```ts
import { connectDispatcher, createRemoteDispatcher } from '@istar-ts/actions';

const dispose = connectDispatcher(serverPort, dispatcher); // server side
const remote = createRemoteDispatcher(clientPort); // client side, same ActionDispatcher interface
await remote.dispatch({ kind: 'createNode', elementTypeId: 'istar.Goal' });
```

This frames one JSON-RPC method per action kind, not yet GLSP's own five-method lifecycle
(`initialize`/`initializeClientSession`/`process`/`disposeClientSession`/`shutdown`); see
[`docs/action-protocol.md`](https://github.com/vieirin/istar-ts/blob/main/docs/action-protocol.md)
for the GLSP mapping, the gap, and [#44](https://github.com/vieirin/istar-ts/issues/44).
