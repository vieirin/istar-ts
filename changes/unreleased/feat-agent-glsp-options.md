- **agent:** `@istar-ts/agent/glsp`'s `GlspMcpBackendOptions` gets `postGuards`, `hostTools` and
  `context`: `postGuards` reaches the scratch dispatcher `openScratch` builds, so a host's
  `ActionPostGuard`s (#203) refuse at preview time, on the scratch session, instead of only at
  `apply`; `hostTools`/`context` (#175) are forwarded as `mcp: { hostTools, context }` to both the
  scratch and the live GLSP MCP server, so a host's own tools and context providers are served
  next to the istar ones on either session, and a host can use `openGlspMcpSession` as its only
  MCP server. All three are optional and read fresh per run, like `guards`/`schemas` (#239).
