- **glsp:** kinds a file's own `"metamodel"` block declares (`fileMetamodel: true`, e.g.
  `fixtures/extensions/*`) can now be created through GLSP, and are offered in its palette, type
  hints and the MCP `element-types` tool (#97). Create operations now route by operation kind
  only (`IstarOperationHandlerRegistry`), not by a type list fixed from the contribution's
  metamodel at session start; `translateOperation` still rejects a genuinely unknown type with a
  diagnostic. Type hints and the palette (`IstarRequestTypeHintsActionHandler`,
  `IstarToolPaletteItemProvider`, `effectivePaletteFor`) are derived from the session's loaded
  model's metamodel; a shared store's load that extends the metamodel mid-session re-sends
  `setTypeHints` to every connected client. `/glsp.html`'s fixture picker gained an "iStar 2.0 —
  file metamodel" entry.
