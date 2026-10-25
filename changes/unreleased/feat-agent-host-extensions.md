- **actions:** `HostContextProvider` and `HostTool`, a host's context (static text, or a function
  of the model) and tools (name, JSON Schema, handler, `readOnly`) for the agent: opaque data
  plus a handler, the same values for every backend. A read-only tool's dispatcher takes requests
  only (#175).
- **glsp:** `mcp: { hostTools, context, dataMode }` on every MCP launcher (Node, in-page,
  worker): host tools become session-scoped diagram tools next to the istar ones, through the
  session's dispatcher (guards, one undo stack; a refusal is the usual typed `rejected` error),
  and context providers session-scoped resources (`glsp://diagrams/{sessionId}/context/<name>`).
  Resources server-mcp lists as tools are now marked `readOnlyHint: true`. Host tools need zod
  4.2 or later (`z.fromJSONSchema`): the `zod` peer range is now `^4.2.0` (#175).
- **agent:** `runAgent`'s `context` and `getModel` add the host's providers to the system prompt
  as sections after `system` (`systemPromptWith`); `createActionToolRegistry` and
  `createActionChangeSet` take `hostTools`, and Propose mode replays what a host tool dispatched
  (`ToolResult.dispatched`) (#175).
- **playground:** the agent drawer's system prompt gets a "kinds summary" section from the active
  model's metamodel, as an example host context provider (#175).
