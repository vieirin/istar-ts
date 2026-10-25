- **react:** `<IstarCanvas>` renders from the GModel (#165, G2 of #143): its React Flow nodes and
  edges come from `@istar-ts/gmodel`'s `modelToGModelSchema`, the graph the GLSP server sends,
  through the new `gmodelToFlow(schema, metamodel, registry)`, instead of `modelToFlow`'s own walk
  over the model, so both clients draw one graph. Kinds are read from `args.kind`, never from the
  GModel type. Node and edge components draw the `element`/`link` the GModel carries
  (`ElementNodeData.element`, `IstarEdgeData.link`: kind, `customProperties`, `display` and
  `extra` from `args`, names and values from labels); the inspector still reads the model by id.
  The canvas passes its registry's sizes to the GModel (`registrySizes`), as a GLSP contribution
  for the same host does. Two visible changes: every link that some link kind may target now has
  an anchor (an NFR argument can be drawn to any link, not only to one already argued about), and
  a collapsed actor's elements are left out of the flow graph rather than hidden in it.
  `modelToFlow` stays one release as a `@deprecated` wrapper over `gmodelToFlow`. On smartHome
  (237 ids) the derivation takes 0.19 ms instead of 0.03 ms, and a drag or a create re-render is
  unchanged (about 20 ms and 26 ms in jsdom). Docs: `docs/glsp.md` ("One graph for both clients")
  and `docs/action-protocol.md`.
