# istar-ts

TypeScript port of [piStar](https://github.com/jhcp/piStar) (iStar 2.0 goal modelling), split
into two npm packages. Upstream is a no-build jQuery/Backbone/JointJS app; we port its logic
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
- `examples/playground`: Vite + React app using both packages.
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
```

## Conventions

- Tooling is oxc-based: oxlint, oxfmt, tsdown (rolldown). No eslint/prettier/tsup.
- `isolatedDeclarations` is on (tsdown emits `.d.ts` via oxc) — exported functions and
  constants need explicit return/type annotations.
- Workspace packages resolve each other's `src/` through the custom export condition
  `@istar-ts/source` (tsconfig `customConditions`, vite/vitest aliases). Published consumers
  get `dist/`.
- Don't add jQuery, Backbone or JointJS.
- Core never hardcodes domain-specific custom properties; `customProperties` values stay
  strings on disk; unknown JSON keys must survive a round trip.
- Where upstream behaviour is ambiguous, match what the piStar web tool does and leave a
  comment saying so.
- Commit after each step with build + tests passing.
