# @istar-ts/dsm3-kaos

[KAOS](https://www.cin.ufpe.br/~jhcp/dsm3goals/kaos.html) goal models for istar-ts, ported from
João Pimentel's [DSM3-goals](https://www.cin.ufpe.br/~jhcp/dsm3goals/) tool. Files saved by
DSM3-goals' KAOS editor open and save byte for byte.

Status: in progress (issue [#7](https://github.com/vieirin/istar-ts/issues/7)). The `KAOS`
root metamodel, property schemas, shapes and registry parts are here. The refinement's several
sub-goals (DSM3's split link, with its circle) follow once `@istar-ts/core` has n-ary links.

## What it has

- **`KAOS`**: the root metamodel (`defineMetamodel`), for `parsePistar`, `createEmptyModel`
  and `canLink`. New files record `tool: "dsm3-goals"` and `metamodelVersion: "1.0"`, as
  DSM3 writes them.

- **Kinds**: Behavioral goal, Softgoal, Agent, Environment agent and Domain property; the
  Refinement (n-ary: several sub-goals join at a circle), Responsibility assignment and
  Conflict links. KAOS has no actors; every node lies on the paper.
- **Property schemas** (`@istar-ts/core` `defineProperties`): DSM3's eight goal properties,
  the refinement's `SysRef`, `Status` and `Tactic` (saved on its circle), and Conflict's
  `BoundaryCondition`. Values stay strings on disk; other keys, such as `Description`, are kept.
- **Shapes**: DSM3's polygons (`KAOS_SHAPES`), the refinement's filled triangle and the glyphs
  Conflict and Responsibility assignment draw at their midpoint.
- **`kaosExtension`**: an `IstarExtension` for `@istar-ts/react` with the shapes, schemas,
  lines and palette entries.

```tsx
import { kaosExtension } from '@istar-ts/dsm3-kaos';

<IstarCanvas store={store} extensions={[kaosExtension]} />;
```

## Credits

Shapes, labels and rules are from DSM3-goals by João Pimentel. The DSM3-goals site states no
licence; see [docs/dsm3-goals.md](../../docs/dsm3-goals.md) for provenance.
