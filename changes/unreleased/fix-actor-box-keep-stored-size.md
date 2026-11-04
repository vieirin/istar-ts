- **core:** `toPistar`/`toPistarObject` now write an actor's box as the union of its stored
  position/size (when the loaded file had a `display` size for it) and the tight box enclosing its
  children, instead of the tight box alone. This corrects 0.16.1 (#260), which shrank a stored
  actor size that already enclosed its children down to the children's tight bounds.
