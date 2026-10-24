import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

/** The inspector's resize handle (#77): dragging and keying it changes the panel's width. */
test.describe('resizable inspector', () => {
  // Each test gets a fresh browser context (isolated localStorage), so the width always starts
  // at its default.
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test('dragging the handle resizes the inspector and persists the width', async ({ page }) => {
    const inspector = page.locator('.pg-inspector');
    const handle = page.getByRole('separator', { name: 'Resize inspector' });
    const before = await inspector.boundingBox();
    if (!before) throw new Error('inspector has no bounding box');

    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('handle has no bounding box');
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY, { steps: 8 });
    await page.mouse.up();

    const after = await inspector.boundingBox();
    if (!after) throw new Error('inspector has no bounding box');
    expect(after.width).toBeGreaterThan(before.width + 60);

    // Persisted: a fresh load keeps the resized width.
    await page.reload();
    await expect(page.locator('.react-flow__pane')).toBeVisible();
    const reloaded = await page.locator('.pg-inspector').boundingBox();
    if (!reloaded) throw new Error('inspector has no bounding box');
    expect(Math.round(reloaded.width)).toBe(Math.round(after.width));
  });

  test('arrow keys step the width and double-click resets it', async ({ page }) => {
    const inspector = page.locator('.pg-inspector');
    const handle = page.getByRole('separator', { name: 'Resize inspector' });
    const before = await inspector.boundingBox();
    if (!before) throw new Error('inspector has no bounding box');

    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const widened = await inspector.boundingBox();
    if (!widened) throw new Error('inspector has no bounding box');
    expect(widened.width).toBeCloseTo(before.width + 32, 0);

    await handle.dblclick();
    const reset = await inspector.boundingBox();
    if (!reset) throw new Error('inspector has no bounding box');
    expect(Math.round(reset.width)).toBe(Math.round(before.width));
  });
});
