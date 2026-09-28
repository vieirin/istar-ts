# istar-ts

TypeScript libraries for [iStar 2.0](https://istarwiki.org/) goal models, ported from
[piStar](https://github.com/jhcp/piStar).

| Package                             | What it is                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@istar-ts/core`](packages/core)   | Framework-free model: typed metamodel, iStar 2.0 link constraints, piStar-compatible JSON (de)serialization, an undoable store, and typed custom-property schemas.                          |
| [`@istar-ts/react`](packages/react) | A React Flow–based canvas for editing iStar models, with a registry that lets you override how each element kind renders, its default properties, its inspector form and its palette entry. |

Files saved by the piStar web tool load and save byte-for-byte compatibly, including arbitrary
`customProperties` and keys the library does not know about.

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

## Credits

The metamodel, link constraints, element shapes and file format are derived from
[piStar](https://github.com/jhcp/piStar) by João Pimentel and contributors, released under the
MIT License. See [LICENSE](LICENSE).
