import { expect, test } from '@playwright/test';
import {
  canvasPane,
  deselectAll,
  gotoApp,
  lastCreatedId,
  nodeById,
  resetToEmptyModel,
  selectActorTool,
} from './helpers';

/**
 * React Flow classifies a mousedown/mouseup with a few px of movement between them as a drag,
 * not a click, so a plain `onNodeClick` handler misses it. The actor stays unselected even
 * though the gesture is ordinary jitter from the user's point of view (#267).
 */
test.describe('an actor symbol click with a few px of jitter still selects the actor', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
  });

  test('mouse down on the symbol, a 3px move, then up selects the actor', async ({ page }) => {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    const node = nodeById(page, actorId);
    await expect(node).toHaveClass(/selected/);

    // Deselect first: the fresh actor is selected right after creation (addAt).
    await deselectAll(page);
    await expect(node).not.toHaveClass(/selected/);

    const symbol = node.locator('.istar-actor-symbol');
    const box = await symbol.boundingBox();
    if (!box) throw new Error('actor symbol has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 3, startY + 3, { steps: 4 });
    await page.mouse.up();

    await expect(node).toHaveClass(/selected/);
  });
});
