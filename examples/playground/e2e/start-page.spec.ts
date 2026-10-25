import { expect, test } from '@playwright/test';

/** The start page (#87): pick a front end before reaching the React canvas or the GLSP client. */
test.describe('start page', () => {
  test('all three cards render and navigate', async ({ page }) => {
    await page.goto('/');

    const reactCard = page.getByRole('link', { name: /istar-ts React/ });
    const glspCard = page.getByRole('link', { name: /Eclipse GLSP client/ });
    const bothCard = page.getByRole('link', { name: /Both, side by side/ });
    await expect(reactCard).toBeVisible();
    await expect(glspCard).toBeVisible();
    await expect(bothCard).toBeVisible();

    await reactCard.click();
    await expect(page).toHaveURL(/\/react\.html$/);
    await expect(page.locator('.react-flow__pane')).toBeVisible();

    await page.goto('/');
    await glspCard.click();
    await expect(page).toHaveURL(/\/glsp\.html$/);
    await expect(page.locator('.pg-glsp-diagram svg')).toBeVisible();

    await page.goto('/');
    await bothCard.click();
    await expect(page).toHaveURL(/\/both\.html$/);
    await expect(page.locator('.react-flow__pane')).toBeVisible();
    await expect(page.locator('.pg-both-glsp-diagram svg')).toBeVisible();
  });
});
