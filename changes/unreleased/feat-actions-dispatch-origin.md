- **actions:** `dispatch(action, { origin? })` echoes `origin` back as `origin` on every
  `sourceModelChanged` and `setDirtyState` the action causes — each change of a `compound`, both
  events of an undo or redo — so a listener can tell which surface or client caused a change
  without tracking it itself. Carried through the transport (`createRemoteDispatcher` →
  `connectDispatcher`) and by `createMirrorStore`'s dispatcher; `@istar-ts/react`'s
  `dispatcherFor(surface)` passes `origin: surface`, and the playground's `tagClient` passes its
  client tag. `ActionDispatcher.dispatch`'s second argument is optional: existing callers are
  unaffected. `docs/action-protocol.md` and the dispatcher's doc comment now pin the local
  dispatcher's synchronous-apply guarantee (operations, `compound`, `glspUndo`/`glspRedo`, guards
  and postGuards all apply before `dispatch`'s promise is even created to resolve) and spell out
  that it does not hold for a remote dispatcher or a mirror, where `origin` is the portable way
  to correlate a dispatch with its changes (#213).
