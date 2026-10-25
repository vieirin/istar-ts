# fix(glsp-client): palette refreshes after metamodel-changing load

Custom `IstarToolPalette` extends the stock GLSP client's ToolPalette to force palette refresh on every model update, not just for dynamic items. The server's palette follows the loaded model's metamodel (#97), so after a file-declared kind is loaded, the client now requests a fresh palette.

Added e2e test: palette refresh without remounting the client.
