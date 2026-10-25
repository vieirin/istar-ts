- **actions:** `istar.updateModelExtra { set?, remove?, tool? }` sets or removes the model's own
  top-level keys that core keeps in `model.extra` (e.g. a dialect's `metamodelVersion`), keeping
  other extra keys and their order, and appending a new key where `toPistar` would place it;
  `tool` sets or, with `null`, removes the model's own `tool` field in the same undo step. Both
  `set`/`remove` reject a key core models itself (`actors`, `orphans`, `dependencies`, `links`,
  `display`, `tool`, `istar`, `saveDate`, `diagram`) or `"metamodel"` (`istar.setFileMetamodel`'s
  own). `istar.replaceModel { model, fileMetamodel? }` replaces the whole model from a piStar
  save file as one undo step — ids, order and extra keys come from the given file, so a parse →
  `toPistar` round trip of the result is byte-identical to it; parsed with `parsePistar` under
  the dispatcher's own metamodel, with pre-guards and postGuards running against it like any
  other operation, and a parse error rejecting with a typed diagnostic, model untouched. Both are
  one undo step, in `HANDLED_ACTION_KINDS` and `docs/action-protocol.md` (#217, #218).
- **playground:** `describeOperation` and the script console's templates cover both new kinds.
