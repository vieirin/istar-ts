# @istar-ts/dsm3-kaos

[KAOS](https://www.cin.ufpe.br/~jhcp/dsm3goals/kaos.html) goal models for istar-ts, ported from
João Pimentel's [DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/) tool. Files saved by
DSM3-goals' KAOS editor open and save byte for byte.

Part of issue [#7](https://github.com/vieirin/istar-ts/issues/7); design notes in
[docs/dsm3-goals.md](../../docs/dsm3-goals.md).

## What it has

- **`KAOS`**: the root metamodel (`defineMetamodel`), for `parsePistar`, `createEmptyModel`
  and `canLink`. New files record `tool: "dsm3-goals"` and `metamodelVersion: "1.0"`, as
  DSM3 writes them.

- **Kinds**: Behavioral goal, Softgoal, Agent, Environment agent and Domain property; the
  Refinement (n-ary: several sub-goals join at a circle, `kaos.RefinementLinkHub`, with a leg
  from each and an end to the refined goal), Responsibility assignment and Conflict links.
  Drag from a sub-goal to a goal for a new refinement; drop on its circle to add a sub-goal. KAOS has no actors; every node lies on the paper.
- **Property schemas** (`@istar-ts/core` `defineProperties`): DSM3's eight goal properties,
  the refinement's `SysRef`, `Status` and `Tactic` (saved on its circle), and Conflict's
  `BoundaryCondition`. Values stay strings on disk; other keys, such as `Description`, are kept.
- **Shapes**: DSM3's polygons (`KAOS_SHAPES`), the refinement's filled triangle and the glyphs
  Conflict and Responsibility assignment draw at their midpoint.
- **`kaosExtension`**: an `IstarExtension` for `@istar-ts/react` with the shapes, schemas,
  lines and palette entries.

```tsx
import {
  ISTAR_2_0,
  createEmptyModel,
  detectFramework,
  parsePistar,
  toPistar,
} from '@istar-ts/core';
import { IstarCanvas, useIstarStore } from '@istar-ts/react';
import { KAOS, kaosExtension } from '@istar-ts/dsm3-kaos';

// Read a DSM3-goals file (or check which language it is written in first).
detectFramework(text, [ISTAR_2_0, KAOS]); // KAOS
const model = parsePistar(text, { metamodel: KAOS });
toPistar(model) === text; // DSM3's files round-trip byte for byte

// A new model records tool "dsm3-goals" and metamodelVersion "1.0", as DSM3 writes them.
const empty = createEmptyModel(undefined, { metamodel: KAOS });

function Editor() {
  const { store } = useIstarStore(() => model);
  return <IstarCanvas store={store} extensions={[kaosExtension]} />;
}
```

## Credits

Shapes, labels and rules are from DSM3-goals by João Pimentel. The DSM3-goals site states no
licence; see [docs/dsm3-goals.md](../../docs/dsm3-goals.md) for provenance.
