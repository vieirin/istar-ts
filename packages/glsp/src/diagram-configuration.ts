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
 * that targets a link ends on that link's anchor node.
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
    })),
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
