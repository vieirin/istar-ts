# istar-ts

TypeScript port of [piStar](https://github.com/jhcp/piStar) (iStar 2.0 goal modelling), split
into npm packages. Upstream is a no-build jQuery/Backbone/JointJS app; we port its logic
and file format, not its structure. A local checkout lives at `../piStar` for reference —
never copy or clone it into this repo.

## Layout

- `packages/core` → `@istar-ts/core`: pure logic, no DOM/React. Metamodel types, `canLink`
  constraints, `parsePistar`/`toPistar`, model store with undo/redo + events, custom-property
  schemas.
- `packages/react` → `@istar-ts/react`: `<IstarCanvas>` on React Flow (`@xyflow/react`),
  element registry (component / defaultProperties / inspector / palette per kind), one
  stylesheet (`@istar-ts/react/styles.css`) themed with CSS variables, scoped under
  `.istar-canvas`.
- `packages/dsm3-kaos` → `@istar-ts/dsm3-kaos`, `packages/dsm3-nfr` → `@istar-ts/dsm3-nfr`:
  KAOS and the NFR Framework as DSM3-goals defines them (root metamodel, property schemas,
  shapes, an `IstarExtension` with the registry parts). Design: `docs/dsm3-goals.md`.
- `examples/playground`: Vite + React app using the packages.
- `fixtures/`: real piStar model files (from goal-controller and upstream). Every one must
  round-trip through `toPistar(parsePistar(f))`.

## Commands

```sh
pnpm test         # vitest, all packages (root vitest.config.ts → projects)
pnpm typecheck    # tsc per package (TypeScript 7 / native)
pnpm lint         # oxlint (.oxlintrc.json)
pnpm format       # oxfmt (.oxfmtrc.json); format:check in CI
pnpm build        # tsdown per package (ESM + .d.ts)
pnpm check        # all of the above
pnpm dev          # playground
pnpm e2e          # Playwright e2e on the playground, headless (once: pnpm --filter playground exec playwright install chromium)
pnpm e2e:headed   # same, in a visible browser; pnpm e2e:ui for Playwright's UI mode
```

## Conventions

- Tooling is oxc-based: oxlint, oxfmt, tsdown (rolldown). No eslint/prettier/tsup.
- `isolatedDeclarations` is on (tsdown emits `.d.ts` via oxc) — exported functions and
  constants need explicit return/type annotations.
- Workspace packages resolve each other's `src/` through the custom export condition
  `@istar-ts/source` (tsconfig `customConditions`, vite/vitest aliases). Published consumers
  get `dist/`.
- Don't add jQuery, Backbone or JointJS.
- This is a clean port of the piStar tool. Neither package hardcodes any modeller's properties
  (goal-controller included); `customProperties` values stay strings on disk; unknown JSON keys
  must survive a round trip. Modeller-specific behaviour goes in an `IstarExtension`
  (`extensions` prop) — see `examples/playground/src/extensions/`.
- The metamodel is a value: `ISTAR_2_0` by default, `extendMetamodel` for new element/link kinds
  (design: `docs/metamodel-extensions.md`). Look kinds up in the model's metamodel
  (`metamodelOf`) instead of comparing against `istar.*` names or `isActorKind`; keep iStar 2.0
  overloads last and the built-in kind unions unchanged.
- Every vitest project freezes `Date` before each test (`test-support/freeze-date.ts`, wired into
  each `vitest.config.ts` via `setupFiles`), so `toPistar`'s `saveDate` stamp can't straddle a
  wall-clock second and flake a comparison. Only `Date` is faked; timers, `performance.now()` and
  React's scheduler run normally. A test that genuinely needs the real clock calls
  `useRealDate()` from `test-support/use-real-date.ts`.
- Where upstream behaviour is ambiguous, match what the piStar web tool does and leave a
  comment saying so.
- Commit after each step with build + tests passing.
- Changelog: add one fragment file `changes/unreleased/<branch-name>.md` per PR; never edit
  `CHANGELOG.md` outside a `release/X.Y.Z` PR (see `changes/unreleased/README.md`).
- Never bump `version` in package.json: releases take the version from the GitHub release tag
  (`.github/workflows/release.yml`, secret `NPM_SECRET_KEY`).
