/**
 * The script console's kind list and per-kind JSON templates.
 *
 * The console only scripts operations (the actions that edit the model); `@istar-ts/actions`
 * knows them by its own `OPERATION_KINDS` set, but that set isn't exported (only the `isOperation`
 * predicate is) — out of scope here to change the package, so the list is mirrored, kept in the
 * order `packages/actions/src/actions.ts` declares `IstarOperation`.
 */
import type { AnyIstarModel } from '@istar-ts/core';
import type { IstarOperation } from '@istar-ts/actions';

export const SCRIPT_OPERATION_KINDS: readonly IstarOperation['kind'][] = [
  'createNode',
  'createEdge',
  'deleteElement',
  'changeBounds',
  'changeContainer',
  'reconnectEdge',
  'applyLabelEdit',
  'compound',
  'istar.addLeg',
  'istar.removeLeg',
  'istar.setCollapsed',
  'istar.updateDiagram',
  'istar.updateProperties',
  'istar.updateDisplay',
  'istar.setLinkValue',
];

function elementIdAt(model: AnyIstarModel, index: number): string {
  return [...model.elements.keys()][index] ?? '<elementId>';
}

function firstLinkId(model: AnyIstarModel): string {
  return model.links.keys().next().value ?? '<linkId>';
}

/** The JSON template for `kind`, with real ids from `model` where one is needed. */
export function templateFor(kind: IstarOperation['kind'], model: AnyIstarModel): IstarOperation {
  const elementId = elementIdAt(model, 0);
  const otherElementId = elementIdAt(model, 1);
  const linkId = firstLinkId(model);
  switch (kind) {
    case 'createNode':
      return {
        kind,
        elementTypeId: 'istar.Goal',
        containerId: elementId,
        location: { x: 100, y: 100 },
      };
    case 'createEdge':
      return {
        kind,
        elementTypeId: 'istar.ContributionLink',
        sourceElementId: elementId,
        targetElementId: otherElementId,
        args: { value: 'help' },
      };
    case 'deleteElement':
      return { kind, elementIds: [elementId] };
    case 'changeBounds':
      return { kind, newBounds: [{ elementId, newPosition: { x: 0, y: 0 } }] };
    case 'changeContainer':
      return { kind, elementId, targetContainerId: null };
    case 'reconnectEdge':
      return {
        kind,
        edgeElementId: linkId,
        sourceElementId: elementId,
        targetElementId: otherElementId,
      };
    case 'applyLabelEdit':
      return { kind, labelId: elementId, text: 'New label' };
    case 'compound':
      return { kind, operationList: [] };
    case 'istar.addLeg':
      return { kind, hubId: linkId, sourceElementId: elementId };
    case 'istar.removeLeg':
      return { kind, legId: linkId };
    case 'istar.setCollapsed':
      return { kind, elementId, collapsed: true };
    case 'istar.updateDiagram':
      return { kind, diagram: { name: 'Untitled' } };
    case 'istar.updateProperties':
      return { kind, elementId, properties: {} };
    case 'istar.updateDisplay':
      return { kind, elementId, patch: { backgroundColor: '#ffffff' } };
    case 'istar.setLinkValue':
      return { kind, linkId, value: 'help' };
  }
}
