/**
 * An accepted operation with the ids it created injected back as explicit ids, so dispatching it
 * again against the same model state creates the same ids. The playground's protocol lab replay
 * (#46) and agent Propose mode (#155, whose apply must reproduce the scratch run's ids for later
 * steps that name them) need it, and so does `@istar-ts/glsp`'s grouping of an MCP tool call
 * (#223), which applies a draft's operations again on the store as one `compound`.
 */
import type { IstarOperation } from './actions';
import { type AnyIstarModel, type AnyMetamodel, metamodelOf } from '@istar-ts/core';

type Operation = IstarOperation<string, string>;

/** How many new element ids, then new link ids, `operation` creates, mirroring the dispatcher's
 * `createdIds` diff (`dispatcher.ts`) and `connect`/`addDependency`/`addLeg`
 * (`packages/core/src/operations.ts`). */
function countCreatedIds(
  operation: Operation,
  model: AnyIstarModel,
): { elements: number; links: number } {
  switch (operation.kind) {
    case 'createNode':
      return { elements: 1, links: 0 };
    case 'createEdge': {
      const metamodel = metamodelOf(model) as AnyMetamodel;
      const definition = metamodel.links.get(operation.elementTypeId);
      if (definition?.category === 'dependency') return { elements: 1, links: 2 };
      if (definition?.parts && !targetIsHub(operation, model, metamodel)) {
        // A new hub: hub (element) + leg + end (links).
        return { elements: 1, links: 2 };
      }
      return { elements: 0, links: 1 };
    }
    case 'istar.addLeg':
      return { elements: 0, links: 1 };
    case 'compound': {
      let elements = 0;
      let links = 0;
      for (const child of operation.operationList as readonly Operation[]) {
        const counts = countCreatedIds(child, model);
        elements += counts.elements;
        links += counts.links;
      }
      return { elements, links };
    }
    default:
      return { elements: 0, links: 0 };
  }
}

function targetIsHub(
  operation: Extract<Operation, { kind: 'createEdge' }>,
  model: AnyIstarModel,
  metamodel: AnyMetamodel,
): boolean {
  const targetKind = model.elements.get(operation.targetElementId)?.kind;
  return targetKind !== undefined && metamodel.elements.get(targetKind)?.role === 'hub';
}

/** `operation` with ids from `elementIds`/`linkIds` (consumed in model order) injected as the
 * explicit ids its creates take, so a dispatcher that applies it against the same model state
 * creates the same ids. */
function withCreatedIds(
  operation: Operation,
  elementIds: string[],
  linkIds: string[],
  model: AnyIstarModel,
): Operation {
  switch (operation.kind) {
    case 'createNode': {
      const id = elementIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'createEdge': {
      const metamodel = metamodelOf(model) as AnyMetamodel;
      const definition = metamodel.links.get(operation.elementTypeId);
      if (definition?.category === 'dependency') {
        const dependumId = elementIds.shift();
        const linkIds2 = [linkIds.shift(), linkIds.shift()] as const;
        if (dependumId === undefined || linkIds2[0] === undefined || linkIds2[1] === undefined) {
          return operation;
        }
        return {
          ...operation,
          args: {
            ...operation.args,
            dependum: { ...operation.args?.dependum, id: dependumId },
            linkIds: linkIds2 as readonly [string, string],
          },
        };
      }
      if (definition?.parts && !targetIsHub(operation, model, metamodel)) {
        const hubId = elementIds.shift();
        const legId = linkIds.shift();
        const endId = linkIds.shift();
        return hubId === undefined || legId === undefined || endId === undefined
          ? operation
          : { ...operation, args: { ...operation.args, id: hubId, legId, endId } };
      }
      const id = linkIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'istar.addLeg': {
      const id = linkIds.shift();
      return id === undefined ? operation : { ...operation, args: { ...operation.args, id } };
    }
    case 'compound':
      return {
        ...operation,
        operationList: (operation.operationList as readonly Operation[]).map((child) =>
          withCreatedIds(child, elementIds, linkIds, model),
        ),
      };
    default:
      return operation;
  }
}

/** `operation`, with `createdIds` (an accepted result's) injected as explicit ids. */
export function injectCreatedIds(
  operation: Operation,
  createdIds: readonly string[],
  model: AnyIstarModel,
): Operation {
  const counts = countCreatedIds(operation, model);
  const elementIds = createdIds.slice(0, counts.elements);
  const linkIds = createdIds.slice(counts.elements, counts.elements + counts.links);
  return withCreatedIds(operation, [...elementIds], [...linkIds], model);
}
