- **glsp:** `gmodelBounds` now builds its `modelToGModel` options with the same helper as
  `IstarGModelFactory`, so a contribution's `sizes` override (#154) is applied consistently to
  both; a host that overrides a kind's size no longer gets spurious `display` writes when moving
  elements inside an actor of that kind (#182).
