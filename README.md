# istar-ts

TypeScript libraries for [iStar 2.0](https://istarwiki.org/) goal models, ported from
[piStar](https://github.com/jhcp/piStar).

| Package                                     | What it is                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@istar-ts/core`](packages/core)           | Framework-free model: typed metamodel, iStar 2.0 link constraints, piStar-compatible JSON (de)serialization, an undoable store, and typed custom-property schemas.                          |
| [`@istar-ts/react`](packages/react)         | A React Flow–based canvas for editing iStar models, with a registry that lets you override how each element kind renders, its default properties, its inspector form and its palette entry. |
| [`@istar-ts/dsm3-kaos`](packages/dsm3-kaos) | KAOS goal models from [DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/): metamodel, property schemas, shapes and a registry extension for the canvas.                                  |
| [`@istar-ts/dsm3-nfr`](packages/dsm3-nfr)   | NFR Framework models from [DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/): metamodel, contribution labels, shapes and a registry extension for the canvas.                           |
| [`@istar-ts/glsp`](packages/glsp)           | A GLSP server diagram module on `@eclipse-glsp/server` (read side so far): the model as a GModel, type hints, and dialect contributions for iStar 2.0, KAOS and NFR. No React.              |

Files saved by the piStar web tool load and save byte-for-byte compatibly, including arbitrary
`customProperties` and keys the library does not know about.

Both packages default to iStar 2.0 exactly as the piStar tool implements it. Dialects that add
element or link kinds (such as piStar-ext's iStar4RationalAgents) are supported through
`extendMetamodel`: see "Extending the metamodel" in the package READMEs and
[docs/metamodel-extensions.md](docs/metamodel-extensions.md). Other goal languages that share
piStar's core, KAOS and the NFR Framework as DSM3-goals defines them, come as their own packages
(see [docs/dsm3-goals.md](docs/dsm3-goals.md)). `@istar-ts/dsm3-kaos` also has an obstacle
analysis extension (`KAOS_OBSTACLES`). Its file types (`kaos.Obstacle`,
`kaos.ObstacleRefinementLink*`, `kaos.ObstructionLink`, `kaos.ResolutionLink`) are istar-ts's,
not DSM3-goals': DSM3's KAOS editor doesn't know them.

## Development

```sh
pnpm install
pnpm test        # vitest (all packages)
pnpm typecheck   # tsc (TypeScript 7)
pnpm lint        # oxlint
pnpm format      # oxfmt
pnpm build       # tsdown → packages/*/dist
pnpm dev         # playground app (examples/playground)
```

## Releasing

Versions come from git tags; don't edit `version` in `package.json` (it stays
`0.0.0-development`). To release, publish a GitHub release with a semver tag, e.g. `v0.2.0`
(`gh release create v0.2.0 --generate-notes`). The [Release workflow](.github/workflows/release.yml)
runs the full check, stamps that version on every package and publishes them to npm through
npm trusted publishing (each package trusts `vieirin/istar-ts` / `release.yml` / environment
`publish`); no npm token is involved. Run the workflow manually with an existing tag to finish a
release where a package failed to publish. Pre-release tags like `v0.3.0-beta.1` go to the `next` dist-tag.

## Credits

The metamodel, link constraints, element shapes and file format are derived from
[piStar](https://github.com/jhcp/piStar) by João Pimentel and contributors, released under the
MIT License. See [LICENSE](LICENSE).
