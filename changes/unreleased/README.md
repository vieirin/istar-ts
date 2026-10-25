# Unreleased changes

Each PR adds **one file** here, instead of editing `CHANGELOG.md`, so that parallel PRs never
conflict on the changelog.

- **Name:** the branch name with `/` replaced by `-`, e.g. `feat-react-mirror-store.md`.
- **Content:** the changelog bullet(s), written as they should appear in the release notes, e.g.
  `- **react:** … (#99).`, wrapped at 100 columns like the rest of the docs.
- **Release:** the release PR (branch `release/X.Y.Z`) runs `pnpm changelog:release X.Y.Z`. That
  moves every file here, in name order, into a new `## X.Y.Z` section at the top of
  `CHANGELOG.md` and deletes the fragment files. Merge that PR, then run the **Tag release**
  workflow.
- **Pre-release:** `pnpm changelog:release X.Y.Z-beta.N --keep` writes the `## X.Y.Z-beta.N` section but
  keeps the fragments, so the final `X.Y.Z` release gathers them again.
