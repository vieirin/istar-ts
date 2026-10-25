- **actions:** `istar.changeLinkKind { linkIds, elementTypeId }` changes the kind of a set of
  links at once, keeping their ids, source, target, order in the file, name, value, custom
  properties and display; `canLink` checks each listed link's new kind against its unchanged
  source and target, with the other listed links excluded, so toggling e.g. every AND-refinement
  link into a goal to OR together (goal-controller's `setRefinement`) round-trips byte-identical
  to goal-controller's own text rewrite. `istar.setFileMetamodel { block }` sets or removes the
  model file's own `"metamodel"` block through `withFileMetamodel`, rejecting a malformed block,
  a collision with the host's kinds, or dropping a kind an element or link still uses; a host's
  own dialect checks run as an `ActionGuard` on this operation's kind. Both are one undo step,
  all or nothing, in `HANDLED_ACTION_KINDS` and `docs/action-protocol.md` (#199, #200).
- **glsp:** `change-link-kind` MCP tool, next to `set-link-value`.
- **playground:** `describeOperation` and the script console's templates cover both new kinds.
