/**
 * The GModel is built by `@istar-ts/gmodel` as plain schema JSON (`modelToGModelSchema`, #164);
 * the server turns that schema into GLSP's classes with the framework's own serializer
 * (`GModelSerializer.createRoot`, framework-notes §2). The moved names are re-exported here, so
 * `@istar-ts/glsp`'s API is unchanged.
 */
import type { AnyMetamodel, IstarModel } from '@istar-ts/core';
import { metamodelOf } from '@istar-ts/core';
import { modelToGModelSchema } from '@istar-ts/gmodel';
import type { ModelToGModelOptions } from '@istar-ts/gmodel';
import { DefaultGModelSerializer, GEdge, GNode, getDefaultMapping } from '@eclipse-glsp/server';
import type { DiagramConfiguration, GGraph, GModelElementConstructor } from '@eclipse-glsp/server';
import type { GModelTypeOverrides } from './types';
import { LINK_ANCHOR_TYPE, gmodelTypes } from './types';

export {
  ACTOR_LABEL_CSS_CLASS,
  ACTOR_SYMBOL_OFFSET,
  COLLAPSED_ACTOR_SIZE,
  GRAPH_ID,
  LINK_ANCHOR_SIZE,
  labelId,
  linkAnchorId,
  modelToGModelSchema,
  valueLabelId,
} from '@istar-ts/gmodel';
export type { ModelToGModelOptions } from '@istar-ts/gmodel';

/**
 * GLSP's classes for a metamodel's GModel types: the framework's defaults, `GNode` for every
 * element kind and the link anchor, `GEdge` for every link kind (`IstarDiagramConfiguration`'s
 * `typeMapping`).
 */
export function gmodelTypeMapping(
  metamodel: AnyMetamodel,
  overrides?: GModelTypeOverrides,
): Map<string, GModelElementConstructor> {
  const types = gmodelTypes(metamodel, overrides);
  const mapping = getDefaultMapping();
  mapping.set(LINK_ANCHOR_TYPE, GNode);
  for (const kind of metamodel.elements.keys()) mapping.set(types.of(kind)!, GNode);
  for (const kind of metamodel.links.keys()) mapping.set(types.of(kind)!, GEdge);
  return mapping;
}

/** The framework's serializer over a type mapping, outside a diagram session's container. */
class TypeMappingSerializer extends DefaultGModelSerializer {
  constructor(typeMapping: Map<string, GModelElementConstructor>) {
    super();
    this.diagramConfiguration = { typeMapping } as DiagramConfiguration;
  }
}

/** `ModelToGModelOptions` built from a contribution's own `types`/`sizes` (#154, #182): the
 * `IstarGModelFactory` and `gmodelBounds` (`translate.ts`) must agree on them, or GLSP's
 * parent-relative positions get translated back against the wrong actor boundary. */
export function gmodelOptions(contribution: {
  readonly types?: GModelTypeOverrides;
  readonly sizes?: ModelToGModelOptions['sizes'];
}): ModelToGModelOptions {
  return {
    ...(contribution.types ? { types: contribution.types } : {}),
    ...(contribution.sizes ? { sizes: contribution.sizes } : {}),
  };
}

/**
 * The model's GModel as GLSP's classes: `modelToGModelSchema`'s schema, through the framework's
 * serializer. A session's `IstarGModelFactory` uses the session's own serializer instead.
 */
export function modelToGModel<EK extends string, LK extends string>(
  model: IstarModel<EK, LK>,
  options: ModelToGModelOptions = {},
): GGraph {
  const metamodel = metamodelOf(model) as unknown as AnyMetamodel;
  const serializer = new TypeMappingSerializer(gmodelTypeMapping(metamodel, options.types));
  return serializer.createRoot(modelToGModelSchema(model, options)) as GGraph;
}
