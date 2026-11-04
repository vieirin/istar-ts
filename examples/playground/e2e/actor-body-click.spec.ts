import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  canvasPane,
  gotoApp,
  lastCreatedId,
  nodeById,
  resetToEmptyModel,
  selectActorTool,
} from './helpers';

/**
 * The playground has no UI control for `selectActorOnBodyClick` (IstarCanvas prop, not a user
 * setting): the smallest way to flip it for this suite is a `?selectActorOnBodyClick=true` query
 * string read once by `App.tsx`.
 */
test.describe('selectActorOnBodyClick', () => {
  async function createActorAndDeselect(page: Page): Promise<Locator> {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    const node = nodeById(page, actorId);
    await expect(node).toHaveClass(/selected/);
    // A fresh actor is selected right after creation (addAt); clear a spot first.
    await canvasPane(page).click({ position: { x: 600, y: 50 } });
    await expect(node).not.toHaveClass(/selected/);
    return node;
  }

  async function clickBody(node: Locator): Promise<void> {
    const body = node.locator('.istar-actor-boundary');
    const box = await body.boundingBox();
    if (!box) throw new Error('actor body has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await node.page().mouse.move(startX, startY);
    await node.page().mouse.down();
    await node.page().mouse.move(startX + 3, startY + 3, { steps: 4 });
    await node.page().mouse.up();
  }

  test('flag off: a body click with a few px of jitter does not select the actor', async ({
    page,
  }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
    const node = await createActorAndDeselect(page);
    await clickBody(node);
    await expect(node).not.toHaveClass(/selected/);
  });

  test('flag on: a body click with a few px of jitter selects the actor', async ({ page }) => {
    await gotoApp(page, '?selectActorOnBodyClick=true');
    await resetToEmptyModel(page);
    const node = await createActorAndDeselect(page);
    await clickBody(node);
    await expect(node).toHaveClass(/selected/);
  });
});
