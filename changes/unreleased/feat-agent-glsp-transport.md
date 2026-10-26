- **agent:** `@istar-ts/agent/glsp`'s change set no longer keys steps by `ToolResult` identity: a
  scratch step's result carries its `stepId` and an `undo`/`redo`'s its `undoDescription`, so
  `changeSet.step`/`describeUndo`/`apply` work on copies (structured clones, JSON) of the results
  too. New `serveGlspMcpSession(port, getOptions)` and `connectGlspMcpSession(port)` serve a
  `GlspMcpSession` over a `MessagePort`-like channel (a worker next to the model, the page running
  the agent): live calls, Propose → review → apply, and undo/redo mirroring (#248).
- **agent, glsp:** a session's or `serveIstarGlsp({ shared })`'s dispatcher may be any
  `ActionDispatcher`: one without `isDirty` (a `createRemoteDispatcher`) is adapted with the new
  `withDirtyState` from `@istar-ts/actions`, its dirty state tracked from `setDirtyState`
  notifications. Closing a session while its live validation waits on an async dispatcher no
  longer raises an unhandled "ActionQueue is stopped" (#249).
