- **react:** `selectActorOnBodyClick` actors now drag by their body too, even with another
  element already selected, instead of only right after creation.
- **react:** an actor (symbol, or body with `selectActorOnBodyClick`) is now selected on pointer
  down, like any other node, instead of on click or once a drag crosses its threshold — closing a
  gap where a previously-selected node stayed highlighted while the actor was already being
  dragged.
