import { expect, test } from '@playwright/test';

/**
 * The stock GLSP client (#83): a smoke test over the default in-page connection, asserting
 * through the SVG `data-svg-metadata-*` attributes the client itself writes
 * (framework-notes §6), as `@eclipse-glsp/playwright` would for a cross-client suite (#74 S4).
 *
 * Undo goes through the page's own toolbar button, not the stock client's `Ctrl`/`Cmd+Z`
 * shortcut: the default modules bind no undo/redo *button*, and the keyboard shortcut
 * (`GLSPUndoRedoKeyListener`) needs a focus/platform-modifier combination Playwright's
 * synthetic keyboard events don't reproduce reliably headless.
 */
test.describe('GLSP client', () => {
  test('opens a fixture, creates a node from the palette and undoes it', async ({ page }) => {
    await page.goto('/glsp.html');

    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    await page.getByText('Goal', { exact: true }).first().click();
    await diagram.click({ position: { x: 50, y: 50 } });
    await expect(goals).toHaveCount(before + 1);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(goals).toHaveCount(before);
  });
});
