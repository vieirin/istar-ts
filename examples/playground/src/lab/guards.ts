/**
 * The protocol lab's guards switch (#47, #42 item 6): one demo `ActionGuard`, generic (not
 * modeller-specific) and small enough to explain in the lab — refuse a `createNode` that would
 * give one container more than `maxChildren` children. Good enough to catch the remote worker
 * demo's second `createNode` (`App.tsx`'s `onRunRemoteDemo`), which is the point of the switch:
 * the same action the worker sent a minute ago is now refused with this guard's diagnostic.
 */
import type { ActionGuard } from '@istar-ts/actions';

/** The limit `maxChildrenGuard` is switched on with in the lab. */
export const DEMO_GUARD_MAX_CHILDREN = 1;

export function maxChildrenGuard(maxChildren: number): ActionGuard {
  return (operation, model) => {
    if (operation.kind !== 'createNode' || operation.containerId === undefined) return;
    const { containerId } = operation;
    let count = 0;
    for (const element of model.elements.values()) if (element.parent === containerId) count += 1;
    if (count < maxChildren) return;
    return [
      {
        elementId: containerId,
        severity: 'error',
        message: `"${containerId}" already has ${count} child element(s); this guard allows at most ${maxChildren}`,
        code: 'max-children',
      },
    ];
  };
}
