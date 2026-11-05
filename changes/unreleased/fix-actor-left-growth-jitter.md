- **react:** fix `IstarCanvas` flickering an actor's boundary when a child is dragged past its
  left (or top) edge over a store with latency (a mirror store, e.g. `#266`). `onNodeDragStop`
  now computes a drag's new position from the held, optimistic model (`pendingMoves`), not the
  store's possibly-stale one, and a resolved dispatch no longer clears a newer, still-pending
  hold on the same element that a later drag placed on top of it.
