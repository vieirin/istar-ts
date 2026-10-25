# fix(glsp-client): Ctrl/Cmd+Z reliably undoes regardless of focus

`mountGlspClient` now installs a `document`-level keydown fallback for Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z (or Ctrl+Y off Mac). The stock client's own shortcut
(`GLSPUndoRedoKeyListener`) only fires through sprotty's `KeyTool`, which listens on the
diagram's own SVG element, so it stopped working once a palette click, a toolbar button or a
host page's own control took focus elsewhere (#102). The fallback skips text inputs/editable
content and any keystroke the diagram (or, on `/both.html`, the React canvas's own shortcut)
already handled, so a keystroke undoes exactly once on the shared stack.
