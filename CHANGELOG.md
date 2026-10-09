# Changelog

Versions are published from GitHub release tags; see the release notes for full details.

## 0.9.0

- **Link labels (react):** a link kind can have a `labelComponent` (`LinkKindConfig`, settable
  through an `IstarExtension`, extended kinds included). It is drawn as HTML at the link's middle,
  replaces that kind's default labels, and receives them (`labels.fixed`, `.value`, `.name`) along
  with the link, model, metamodel and selection. Use it for piStar-ext's
  `<<stereotype>> {tag = value}`. Without one, links are labelled exactly as before.
- `<IstarCanvas linkNames />` draws each link's `name`. It is off by default, because piStar
  shows link names only in its properties panel.
- The default link inspector edits the link's name, as piStar's properties panel does.

## 0.8.1

- **Fix:** `isActor` and `isNode` take one argument again, as in 0.7.0. In 0.8.0 they gained an
  optional `metamodel` parameter, so `elements.filter(isActor)` passed the array index as a
  metamodel: a type error, and a crash for untyped callers. For extended actor and node kinds use
  the new `isActorIn(metamodel)` / `isNodeIn(metamodel)`, which return a predicate.
- `validateModel`, `elementIcon`, `dependencyIcon`, `paletteSections` and `paletteEntryFor` (which
  also gained optional parameters in 0.8.0) list their 0.7.0 signature last and ignore a stray
  non-object argument, so they too are safe as array callbacks.

## 0.8.0

- Extensible metamodel: new element and link kinds (`extendMetamodel`, `ISTAR_2_0`), threaded
  through serialization, constraints, operations, the store and the React editor. See "Extending
  the metamodel" in the package READMEs and `docs/metamodel-extensions.md`.
