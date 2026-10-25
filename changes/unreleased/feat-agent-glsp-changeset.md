- **agent:** `@istar-ts/agent/glsp` publishes backend A's (GLSP MCP) Propose-mode
  `ChangeSetTarget`: `createGlspChangeSet`/`openGlspMcpSession`, moved from the playground's
  private `glspMcpBackend.ts`, with `describeOperation` for the review's plain-words preview.
  `@istar-ts/glsp` and `@modelcontextprotocol/sdk` are this subpath's own optional peer
  dependencies, so the package root stays GLSP-free (#232).
- **playground:** the agent drawer switches to `@istar-ts/agent/glsp`, removing its private copy.
