- **core:** fix `toPistar` ratcheting an actor's saved box upward forever across repeated
  serialize→parse round trips (e.g. through a mirror store, or opening and resaving a file).
  `toPistar`/`toPistarObject` now write an actor's `x`/`y`/`display.width`/`display.height` as a
  pure projection of the model, never derived from its children.
- **core:** `actorBounds` (the box actually drawn) now floors on the actor's stored
  `display.width`/`display.height` when present, falling back to the kind's default size, then
  grows to enclose its children — so the drawn box still expands and shrinks around children as
  before, but a stored size is never lost. `@istar-ts/react`'s canvas and `@istar-ts/gmodel`'s
  GModel (and so GLSP) go through `actorBounds`, so they stay consistent with each other.
