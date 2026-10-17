# @istar-ts/dsm3-nfr

[NFR Framework](https://www.cin.ufpe.br/~jhcp/dsm3goals/nfr.html) models (softgoal
interdependency graphs) for istar-ts, ported from João Pimentel's
[DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/) tool. Files saved by DSM3-goals' NFR
editor open and save byte for byte.

Status: in progress (issue [#7](https://github.com/vieirin/istar-ts/issues/7)). The shapes and
registry parts are here; the `NFR` metamodel follows once `@istar-ts/core` can declare root
metamodels and links that target links.

## What it has

- **Kinds**: NFR softgoal, Operationalization and Claim; And- and Or-refinement, Contribution,
  Correlation, and Argument links. An Argument goes from a Claim to another link. The NFR
  Framework has no actors; every node lies on the paper.
- **Labels**: `NFR_CONTRIBUTION_LABELS`, the values of Contribution and Correlation links, as
  DSM3 writes them (`–` is U+2013 EN DASH).
- **Shapes**: DSM3's cloud (`NFR_SHAPES`): bold for Operationalizations, dashed for Claims; the
  And bar and Or triangle markers.
- **`nfrExtension`**: an `IstarExtension` for `@istar-ts/react` with the shapes, lines and
  palette entries, one per label for Contribution and Correlation.

```tsx
import { nfrExtension } from '@istar-ts/dsm3-nfr';

<IstarCanvas store={store} extensions={[nfrExtension]} />;
```

## Credits

Shapes, labels and rules are from DSM3-goals by João Pimentel. The DSM3-goals site states no
licence; see [docs/dsm3-goals.md](../../docs/dsm3-goals.md) for provenance.
