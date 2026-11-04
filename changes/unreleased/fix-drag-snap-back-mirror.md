- **react:** a dropped node no longer snaps back to its pre-drag position while its
  `changeBounds` dispatch is still pending (e.g. a mirror store waiting on a remote's echo);
  it holds the dropped position until the store's model agrees, or reverts if the dispatch is
  rejected (#266).
