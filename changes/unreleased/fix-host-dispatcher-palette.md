- **actions:** `createActionDispatcher`'s `palette` option also accepts a function, evaluated on
  each `requestContextActions` (so a host can track its registry/extensions, or an
  `IstarExtension`'s own `palette`). With no option, the default now follows the model's
  metamodel (`paletteFromMetamodel`, moved from `@istar-ts/glsp`), not iStar 2.0's palette
  regardless of dialect (#202).
- **react:** `IstarProvider` re-requests type hints and the palette when `extensions` (and the
  registry it produces) change, not only on a new dispatcher or metamodel; its own dispatcher's
  palette now tracks the current registry/extensions instead of the ones it was created with
  (#202).
