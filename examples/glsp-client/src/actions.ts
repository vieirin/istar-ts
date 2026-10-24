/**
 * Plain actions a host page dispatches through `MountedGlspClient.dispatch` without its own
 * dependency on `@eclipse-glsp/client` (e.g. a toolbar's Undo/Redo buttons, since the stock
 * client's default modules bind no such buttons themselves — only a keyboard shortcut).
 */
import type { Action } from '@eclipse-glsp/client';
import { RedoAction, UndoAction } from '@eclipse-glsp/client';

export function undoAction(): Action {
  return UndoAction.create();
}

export function redoAction(): Action {
  return RedoAction.create();
}
