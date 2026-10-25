- **glsp:** one MCP tool call is one undo step, all or nothing (#223), for every mutating tool
  (server-mcp's and istar's, host tools too) on the in-page, worker and Node launchers. A call's
  operations (`create-nodes` with `text`: the node, then its label) are applied to a draft of the
  model while the tool runs, then dispatched to the session's dispatcher as one `compound`: one
  undo step, one `sourceModelChanged`, guards and postGuards on the whole call. A rejected
  operation, or a tool error, applies nothing; the tool error no longer carries the tool's own
  answer, which described changes that were dropped. Calls on one session run one at a time.
- **actions:** `injectCreatedIds(operation, createdIds, model)`, moved from the playground: an
  accepted operation with the ids it created pinned as explicit ids.
