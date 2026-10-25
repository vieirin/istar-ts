import type { AnyIstarModel, AnyMetamodel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import { typeHintsFor } from '@istar-ts/actions';
import { GEdge, GNode, ServerLayoutKind, getDefaultMapping } from '@eclipse-glsp/server';
import type {
  DiagramConfiguration,
  EdgeTypeHint,
  GModelElementConstructor,
  ShapeTypeHint,
} from '@eclipse-glsp/server';
import { inject, injectable } from 'inversify';
import { IstarGlspContribution } from './contribution';
import type { GModelTypes } from './types';
import { LINK_ANCHOR_TYPE, gmodelTypes } from './types';

/**
 * Type hints of a metamodel in GModel types: `typeHintsFor`'s, with every kind mapped to its
 * GModel type. An edge's targets that are link kinds become the link anchor's type, since a link
 * that targets a link ends on that link's anchor node.
 *
 * Edge hints are not `dynamic`, unlike `typeHintsFor`'s (#105). The client checks a hint's
 * source and target types itself, from the link rules, and sends `createEdge`. The dispatcher
 * then runs `canLink`, and a refusal reaches the user as a `message` with its reason. With
 * `dynamic: true`, `@eclipse-glsp/client` 2.8's `EdgeCreationToolMouseListener.canConnect` asks
 * `requestCheckEdge` on `mouseOver` and returns `false` until the answer arrives ("Temporarily
 * mark the target as invalid while we wait for the server response, so a fast-clicking user
 * doesn't get a chance to create the edge in the meantime"). `nonDraggingMouseUp` only takes a
 * click when `this.currentTarget && this.allowedTarget`. So a click with no hover before it
 * (a tap, browser automation) is dropped, and a refused target never sends `createEdge`: the
 * stock client ignores the check's `reason`, and the user sees nothing. The cost is the hover
 * feedback for refusals the types can't express (a self-link, a link across actors): the
 * cursor allows the click, and the server rejects it with the reason. `requestCheckEdge` still
 * answers with `canLink` for a client that asks (`IstarRequestCheckEdgeActionHandler`).
 */
export function gmodelTypeHints(
  metamodel: AnyMetamodel,
  types: GModelTypes,
): { shapeTypeHints: ShapeTypeHint[]; edgeTypeHints: EdgeTypeHint[] } {
  const typeOf = (kind: string): string => types.of(kind) ?? kind;
  const targetsOf = (kinds: readonly string[]): string[] => [
    ...new Set(kinds.map((kind) => (metamodel.links.has(kind) ? LINK_ANCHOR_TYPE : typeOf(kind)))),
  ];
  const hints = typeHintsFor(metamodel);
  return {
    shapeTypeHints: hints.shapeHints.map(({ containableElementTypeIds, ...hint }) => ({
      ...hint,
      elementTypeId: typeOf(hint.elementTypeId),
      ...(containableElementTypeIds
        ? { containableElementTypeIds: containableElementTypeIds.map(typeOf) }
        : {}),
    })),
    edgeTypeHints: hints.edgeHints.map((hint) => ({
      ...hint,
      elementTypeId: typeOf(hint.elementTypeId),
      sourceElementTypeIds: (hint.sourceElementTypeIds ?? []).map(typeOf),
      targetElementTypeIds: targetsOf(hint.targetElementTypeIds ?? []),
      dynamic: false,
    })),
  };
}

/**
 * The diagram configuration of the session's contribution. Layout is stored in the model and
 * sizes come from it (`ServerLayoutKind.NONE`, `needsClientLayout: false`), so a change is sent
 * as one `updateModel`, without a `requestBounds` round trip (framework-notes §2).
 *
 * Built once, from the contribution's own metamodel: GLSP constructs it before any file is
 * loaded, in the diagram module's own tier (framework-notes §1), so it must not depend on the
 * session's `ModelState` — a file's own `"metamodel"` block (#97) is covered instead by
 * `liveTypeHints` (`IstarRequestTypeHintsActionHandler`, `updates.ts`), which reads the loaded
 * model's metamodel directly wherever it is actually needed, session by session. `typeMapping`
 * stays fixed at the contribution's own kinds for the same reason — GLSP's `GModelSerializer`
 * walks a type string up to its `node:`/`edge:` prefix when an exact entry is missing
 * (`getConfiguredConstructor`), so a file-declared kind resolves through that fallback without
 * needing its own entry.
 */
@injectable()
export class IstarDiagramConfiguration implements DiagramConfiguration {
  readonly shapeTypeHints: ShapeTypeHint[];
  readonly edgeTypeHints: EdgeTypeHint[];
  readonly typeMapping: Map<string, GModelElementConstructor>;
  readonly layoutKind: ServerLayoutKind = ServerLayoutKind.NONE;
  readonly needsClientLayout: boolean = false;
  readonly animatedUpdate: boolean = false;

  constructor(@inject(IstarGlspContribution) contribution: IstarGlspContribution) {
    const { metamodel } = contribution;
    const types = gmodelTypes(metamodel, contribution.types);
    const hints = gmodelTypeHints(metamodel, types);
    this.shapeTypeHints = hints.shapeTypeHints;
    this.edgeTypeHints = hints.edgeTypeHints;
    this.typeMapping = getDefaultMapping();
    this.typeMapping.set(LINK_ANCHOR_TYPE, GNode);
    for (const kind of metamodel.elements.keys()) this.typeMapping.set(types.of(kind)!, GNode);
    for (const kind of metamodel.links.keys()) this.typeMapping.set(types.of(kind)!, GEdge);
  }
}

/**
 * `gmodelTypeHints`, of a loaded model's own metamodel rather than a contribution's fixed one:
 * what `IstarRequestTypeHintsActionHandler` answers `requestTypeHints` with, and what
 * `IstarStoreChangedHandler` resends as `setTypeHints` once a load (anyone's) extends the
 * metamodel with a file's own kinds (#97).
 */
export function liveTypeHints(
  contribution: IstarGlspContribution,
  model: AnyIstarModel,
): { shapeTypeHints: ShapeTypeHint[]; edgeTypeHints: EdgeTypeHint[] } {
  const metamodel = metamodelOf(model) as unknown as AnyMetamodel;
  const types = gmodelTypes(metamodel, contribution.types);
  return gmodelTypeHints(metamodel, types);
}
