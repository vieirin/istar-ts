import { expect, test } from '@playwright/test';

/** The start page (#87): pick a front end before reaching the React canvas. */
test.describe('start page', () => {
  test('both cards render, the React card navigates, the GLSP card stays disabled', async ({
    page,
  }) => {
    await page.goto('/');

    const reactCard = page.getByRole('link', { name: /istar-ts React/ });
    const glspCard = page.getByRole('link', { name: /Eclipse GLSP client/ });
    await expect(reactCard).toBeVisible();
    await expect(glspCard).toBeVisible();
    await expect(glspCard).toHaveAttribute('aria-disabled', 'true');
    await expect(glspCard).not.toHaveAttribute('href', /.+/);

    await reactCard.click();
    await expect(page).toHaveURL(/\/react\.html$/);
    await expect(page.locator('.react-flow__pane')).toBeVisible();
  });
});
