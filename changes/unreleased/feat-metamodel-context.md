- **actions:** `metamodelContext`/`metamodelContextText`/`metamodelContextProvider`, a built-in,
  dialect-agnostic `HostContextProvider` describing a model's own metamodel (element and link
  kinds, containment, link rules and value sets, property schemas), rendered as compact,
  deterministic markdown (#240).
- **glsp:** every MCP launcher (Node, in-page, worker) carries the built-in metamodel context
  provider by default, before a host's own `context`; opt out with `metamodelContext: false`
  (#240).
- **agent:** `runAgent`'s system prompt (`systemPromptWith`) and `@istar-ts/agent/glsp`'s
  `openGlspMcpSession`/`createGlspChangeSet` include the built-in metamodel context provider by
  default too, same opt-out (#240).
- **playground:** drops its own "kinds summary" host context provider, now covered by the
  built-in one (#240).
