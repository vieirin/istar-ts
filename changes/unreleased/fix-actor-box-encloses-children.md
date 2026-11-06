- **core:** an actor's saved box (`actors[].x/y`, `display.width`/`height`) always encloses its
  children again after a child moves, without re-introducing the saved-size ratchet #276 fixed:
  operations now refresh a stored `display` size to the content box on every change to an actor's
  content (`refreshActorBoxes`, built on the new `actorContentBox`), and `toPistarObject` writes
  an actor's `x`/`y` from `actorBounds` (the enclosing origin) while copying `display.width`/
  `height` verbatim, never unioning a stored size with the children at save time.
