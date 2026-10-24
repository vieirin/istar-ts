import type { AnyMetamodel } from '@istar-ts/core';
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
 * that targets a link ends on that link's anchor node. An n-ary link kind also targets its hub
 * kind: a client adds a source to an n-ary link by drawing that kind onto the hub.
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
 *
 * Edge hints are `repositionable`, also unlike `typeHintsFor`'s: for an edge, GLSP's client
 * reads `repositionable` as "its ends can be reconnected" (`ApplyTypeHintsCommand.
 * applyEdgeTypeHint` sets `reconnectFeature` from it), and without it a selected edge shows no
 * source or target handle (#105). The server's `reconnectEdge` still runs `canLink`.
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
    edgeTypeHints: hints.edgeHints.map((hint) => {
      // An n-ary kind's `createEdge` onto one of its hubs adds a leg to that link.
      const hub = metamodel.links.get(hint.elementTypeId)?.parts?.hub;
      const targets = [...(hint.targetElementTypeIds ?? []), ...(hub === undefined ? [] : [hub])];
      return {
        ...hint,
        elementTypeId: typeOf(hint.elementTypeId),
        sourceElementTypeIds: (hint.sourceElementTypeIds ?? []).map(typeOf),
        targetElementTypeIds: targetsOf(targets),
        repositionable: true,
        dynamic: false,
      };
    }),
  };
}

/**
 * The diagram configuration of the session's contribution. Layout is stored in the model and
 * sizes come from it (`ServerLayoutKind.NONE`, `needsClientLayout: false`), so a change is sent
 * as one `updateModel`, without a `requestBounds` round trip (framework-notes §2).
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
