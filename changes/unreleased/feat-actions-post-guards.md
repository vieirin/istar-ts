- **actions:** `ActionDispatcherOptions.postGuards?: ActionPostGuard[]` run after each operation
  is applied (and after each operation of a `compound` one, plus once more on the compound's own
  result), inside the same `store.transaction`, seeing `(operation, modelAfter, modelBefore)`. An
  `error` diagnostic rolls the transaction back exactly like a pre-guard's: the model is
  untouched, there is no undo entry, and no `sourceModelChanged` fires; other severities come
  back with `ok: true` as warnings, merged after `guards`' own. Works through the transport
  (`createRemoteDispatcher`) and for a mirror (`createMirrorStore`) the same as `guards`, and is
  documented in `docs/action-protocol.md` next to it (#203).
