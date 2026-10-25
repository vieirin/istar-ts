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
  `applyLabelEdit` (`"<id>"` for a name, `"<id>#<key>"` for a custom property; an empty name on a
  link removes it), `compound`, and `istar.addLeg`, `istar.removeLeg`, `istar.setCollapsed`,
  `istar.updateDiagram`, `istar.updateProperties`, `istar.updateDisplay` (an element's `display`
  patch), `istar.setLinkValue` (an existing link's contribution value).
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

## Mirror store

`createMirrorStore(remote)` is a read-only `ModelStore` whose model follows a dispatcher that
lives elsewhere (a worker, a server, a `createRemoteDispatcher` port), so anything that renders a
`ModelStore` (`<IstarCanvas>`, the inspector) can show it:

```ts
import { createActionDispatcher, createMirrorStore } from '@istar-ts/actions';

// Where the model lives: push the model with each change (`sendModel`), then serve it.
connectDispatcher(port, createActionDispatcher(store, { sendModel: true }));

// In the page:
const mirror = createMirrorStore(createRemoteDispatcher(otherPort), { metamodel });
await mirror.ready; // the first `requestModel` answered
await mirror.dispatcher.dispatch(action); // resolves once the mirror shows the change
```

- **Updates.** It asks for the model once (`requestModel`), then follows `sourceModelChanged`.
  With `sendModel`, the notification carries the new model as `newRoot` (piStar JSON) and the
  mirror applies it as it arrives; without it, the mirror answers each notification with a
  `requestModel`. The update is the whole file, re-parsed: on the largest fixture (smartHome, 237
  ids, 48 KB of JSON) a pushed update costs about 3 ms (`toPistarObject` 0.3 ms, the structured
  clone 0.5 ms, `parsePistar` 2.2 ms), a re-requested one about 7 ms over a `MessageChannel`. An
  element, link or diagram equal to the one it replaces keeps its old object, and so does the
  metamodel while the file's `"metamodel"` block is unchanged.
- **Order.** Changes apply in the order the remote sends them, whoever made them.
  `mirror.dispatcher` is the remote with one guarantee added: `dispatch` resolves after the mirror
  shows what the action did, so code that selects a created id, or rolls back a rejected one,
  sees the model it expects. With a `sendModel` remote the plain remote already has that order (a
  change's notification arrives before its result). A rejected action changes nothing, mirror
  included.
- **Writes.** Every mutation (`addElement` … `replace`, `load`, `transaction`, `clearHistory`)
  throws a `ModelOperationError`: dispatch to the remote. `undo`/`redo` dispatch `glspUndo` /
  `glspRedo`, so there is one undo stack, the remote's. `canUndo`/`canRedo` are counted from the
  notifications heard since the mirror connected; earlier edits aren't counted.
