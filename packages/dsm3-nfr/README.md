# @istar-ts/dsm3-nfr

[NFR Framework](https://www.cin.ufpe.br/~jhcp/dsm3goals/nfr.html) models (softgoal
interdependency graphs) for istar-ts, ported from João Pimentel's
[DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/) tool. Files saved by DSM3-goals' NFR
editor open and save byte for byte.

Part of issue [#7](https://github.com/vieirin/istar-ts/issues/7); design notes in
[docs/dsm3-goals.md](../../docs/dsm3-goals.md).

## What it has

- **`NFR`**: the root metamodel (`defineMetamodel`), for `parsePistar`, `createEmptyModel`
  and `canLink`, with DSM3's rules. New files record `tool: "dsm3-goals"` and
  `metamodelVersion: "1.0"`, as DSM3 writes them.

- **Kinds**: NFR softgoal, Operationalization and Claim; And- and Or-refinement, Contribution,
  Correlation, and Argument links. An Argument goes from a Claim to another link: with its tool
  active, each link shows an anchor on its middle to drop it on. The NFR
  Framework has no actors; every node lies on the paper.
- **Labels**: `NFR_CONTRIBUTION_LABELS`, the values of Contribution and Correlation links, as
  DSM3 writes them (`–` is U+2013 EN DASH).
- **Shapes**: DSM3's cloud (`NFR_SHAPES`, on white, `NFR_FILL`): bold for Operationalizations, dashed for Claims; the
  And bar and Or triangle markers.
- **`nfrExtension`**: an `IstarExtension` for `@istar-ts/react` with the shapes, lines and
  palette entries, one per label for Contribution and Correlation.
- **`@istar-ts/dsm3-nfr/metamodel`**: `NFR`, its declaration, kinds and labels without
  `@istar-ts/react`, built for `import` and `require` alike (as `@istar-ts/core` is), for Node
  scripts and CommonJS test runners. The package root is ESM-only.

```tsx
import {
  ISTAR_2_0,
  createEmptyModel,
  detectFramework,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import { IstarCanvas, useIstarStore } from '@istar-ts/react';
import { NFR, nfrExtension } from '@istar-ts/dsm3-nfr';

// Read a DSM3-goals file (or check which language it is written in first).
detectFramework(text, [ISTAR_2_0, NFR]); // NFR
const model = parsePistar(text, { metamodel: NFR });
toPistar(model) === text; // DSM3's files round-trip byte for byte

// A new model records tool "dsm3-goals" and metamodelVersion "1.0", as DSM3 writes them.
const empty = createEmptyModel(undefined, { metamodel: NFR });

function Editor() {
  const { store } = useIstarStore(() => model);
  return <IstarCanvas store={store} extensions={[nfrExtension]} />;
}
```

## Credits

Shapes, labels and rules are from DSM3-goals by João Pimentel. The DSM3-goals site states no
licence; see [docs/dsm3-goals.md](../../docs/dsm3-goals.md) for provenance.
