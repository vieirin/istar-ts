- **core:** an actor's `x`/`y` now always equals the tight origin of its non-actor children
  (padding 0), and a stored `display` size always equals the kind's default-size box there grown
  to enclose them — maintained by every operation that changes an actor's content
  (`refreshActorBoxes`, built on the new `childrenBox`) — so host and mirror stores never
  disagree about an actor's position, and nothing ratchets: the box is a pure function of the
  children, so moving one out and back restores it exactly. `toPistarObject` is back to a pure
  projection of the model's `x`/`y`/`display` (as #276 made it), since the model itself is now
  always correct. An actor with no children keeps its existing `x`/`y` and size. A loaded file's
  slack (a box larger than, or offset from, its children) survives a no-op round trip but is
  dropped by the first operation that changes the actor's content.
