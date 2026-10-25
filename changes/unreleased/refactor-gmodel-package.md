- **gmodel:** new package `@istar-ts/gmodel`, a GLSP-free GModel builder (#164, G1 of #143).
  `modelToGModelSchema(model, { types, sizes })` returns plain GModel schema JSON (GLSP's wire
  shape, with its own types: no `@eclipse-glsp/*`, Sprotty, Inversify or React), and
  `labelId`, `valueLabelId`, `linkAnchorId`, `gmodelTypes`, `LINK_ANCHOR_TYPE` and the other GModel
  constants moved with it. Every element's node and link's edge now carries `args.kind` (the
  kind verbatim, whatever the type; the type stays `node:<kind>`/`edge:<kind>`) and the file's
  `customProperties`, `display` and unknown keys (`extra`) as they are. `@istar-ts/glsp` builds
  its root from that schema with GLSP's `GModelSerializer` and re-exports the moved names, so its
  API is unchanged; `gmodelBounds` reads the schema. Apart from `args`, the GModel on the wire
  (`setModel`, `updateModel`) is identical for every fixture, pinned by a snapshot recorded before
  the move.
