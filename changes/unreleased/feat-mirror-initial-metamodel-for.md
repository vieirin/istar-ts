- **actions:** `createMirrorStore`'s `MirrorStoreOptions` gains `initial` (a parsed model, or a
  piStar file parsed the same way as a pushed one) shown until the remote's first `requestModel`
  answers, instead of an empty model — replaced once it does, unless the remote's model is equal
  — and `metamodelFor` (`(file: PistarFile) => Metamodel`), resolving the root a pushed or
  re-requested file is read with per file (e.g. by its `tool`, with `detectFramework`) instead of
  a fixed `metamodel`, so a mirror can follow a host-side `store.replace` that switches a model's
  root metamodel. The mirror itself stays dialect-agnostic: resolving a file's root is left to
  `metamodelFor`. Default behaviour (a fixed `metamodel`, an empty initial model) is unchanged
  (#250).
