- **react:** an actor is now selected on a drag that starts on its symbol, not just a click, so a
  few px of pointer jitter between mousedown and mouseup no longer leaves it unselected. Raised
  React Flow's `nodeClickDistance` default to 3 for the same reason, and exposed it and
  `nodeDragThreshold` on `IstarCanvasProps`.
