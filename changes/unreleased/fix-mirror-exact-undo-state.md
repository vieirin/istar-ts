- **actions:** a mirror store's `canUndo()` and `canRedo()` are now exact (not an estimate) when
  the dispatcher sends them: a `createActionDispatcher` with `sendModel: true` now includes
  `canUndo` and `canRedo` fields in each `sourceModelChanged` notification, and a mirror reads
  them instead of counting notifications (#178).
