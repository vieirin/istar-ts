- **actions:** fixed a flaky `createMirrorStore` test (`two remote clients interleaving edits`):
  it compared `toPistar` snapshots taken at different real times, which stamp a fresh `saveDate`
  on a model with none of its own, so a wall-clock second crossed between two snapshots of the
  same content could make an otherwise-passing comparison fail (#228).
