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
  the refinement's `SysRef` (the design option it belongs to, Heaven & Letier RE'11), `Status`
  and `Tactic` (the refinement tactic or pattern: milestone-driven, case-driven, …), saved on
  its circle, and Conflict's `BoundaryCondition`. No value is typed beyond text: which values
  a key takes, and any quantity (probabilities, RSR), is a dialect's to declare. Values stay strings on disk; other keys, such as `Description`, are kept.
- **Shapes**: DSM3's polygons (`KAOS_SHAPES`, filled DSM3's grey, `KAOS_FILL`), the refinement's filled triangle and the glyphs
  Conflict and Responsibility assignment draw at their midpoint.
- **`kaosExtension`**: an `IstarExtension` for `@istar-ts/react` with the shapes, schemas,
  lines and palette entries (the obstacle analysis's too, used when the model's metamodel has
  them).
- **Obstacle analysis** (`kaosObstacleAnalysis`, applied as `KAOS_OBSTACLES =
extendMetamodel(KAOS, kaosObstacleAnalysis)`): obstacles (van Lamsweerde & Letier, TSE 2000),
  drawn as the goal's parallelogram mirrored; the n-ary Obstacle refinement (sub-obstacles and
  domain properties join at a circle, several circles on one obstacle being alternatives);
  Obstruction (obstacle → goal or domain property) and Resolution (goal → obstacle). Text keys:
  `Description`, `FormalSpec` and `Category` on obstacles, `ResolutionType` and `Anchor` (the
  goal a mitigation restores, by id) on resolutions. **These are istar-ts's own, not
  DSM3-goals'**: the kinds are `kaosObstacles.*` (the root reserves `kaos.`), saved as
  `kaos.Obstacle`, `kaos.ObstacleRefinementLinkHub/Start/End`, `kaos.ObstructionLink` and
  `kaos.ResolutionLink`, which DSM3's editor doesn't know. Without obstacles, a model saved
  with `KAOS_OBSTACLES` is a plain DSM3 file.
- **Domain property `Kind`**: an optional text key (invariant or hypothesis, as a dialect
  types it) with no default, so DSM3 files and new domain properties don't gain it.
- **`@istar-ts/dsm3-kaos/metamodel`**: the metamodel, kinds and property schemas without
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

```ts
import { KAOS_OBSTACLES } from '@istar-ts/dsm3-kaos/metamodel';

// fixtures/dsm3/kaos-las.txt: KAOSTools' London Ambulance model with obstacles.
const las = parsePistar(text, { metamodel: KAOS_OBSTACLES });
```

## Credits

Shapes, labels and rules are from DSM3-goals by João Pimentel; the obstacle analysis is
istar-ts's, after van Lamsweerde & Letier (TSE 2000) and KAOSTools by Antoine Cailliau (MIT). The DSM3-goals site states no
licence; see [docs/dsm3-goals.md](../../docs/dsm3-goals.md) for provenance.
