- **core:** `toPistar`/`toPistarObject` now write an actor's `x`/`y` (and, when the loaded file
  already had a `display` size for it, its `width`/`height`) from the box enclosing its children,
  like piStar's `_updateActorBoundary`, instead of the actor's stale stored position — a child
  moved outside its actor no longer gets left out of the saved boundary. `actorBounds` takes a new
  optional `padding` parameter (default unchanged) so callers that serialize a model can ask for
  the unpadded box piStar actually saves.
