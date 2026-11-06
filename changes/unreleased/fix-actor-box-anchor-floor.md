- **core:** an actor's saved box now stays enclosing its children *and* keeps the position the
  user gave it: `actor.x`/`y` becomes the union of the kind's default-size box at the actor's
  anchor (`display.anchor` when present, else the actor's own `x`/`y`) and its non-actor
  children's box (padding 0) — maintained by every operation that changes an actor's content
  (`refreshActorBoxes`, built on `childrenBox` and the new `unionBox`). `display.anchor` is
  written only while a child reaches left of/above the actor's own position, and dropped once
  none does, so a file whose children fit inside the default box at the actor's position carries
  no `anchor` key at all; moving the actor itself shifts its `x`/`y`, any `display.anchor` and
  its children by the same delta. A stored `display` size still floors on the kind's default,
  grown to enclose the children. Because `x`/`y`, `anchor` and size are all written to the file
  and read back, host, mirror and a reopened file always compute the identical box, and nothing
  ratchets: moving a child out and back restores it exactly. An actor with no non-actor children
  keeps its existing `x`/`y`, anchor and size. `toPistarObject` stays a pure projection of the
  model's `x`/`y`/`display` (as #276 made it), since the model itself is now always correct.
