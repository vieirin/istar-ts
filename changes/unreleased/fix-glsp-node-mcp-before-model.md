- **glsp:** on the Node launcher's shared-model sessions, an MCP tool call made before the GLSP
  client's own `requestModel` now still acts on the model (#225) — the GModel root is built as
  soon as the session is created, since a shared model is already there, instead of only once a
  client asks for it. Previously `create-nodes` (and every other tool) reported success while
  creating nothing.
