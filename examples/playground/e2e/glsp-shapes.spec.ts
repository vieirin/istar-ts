import { expect, test } from '@playwright/test';

/**
 * iStar 2.0 shapes in the stock GLSP client (#84): a task and a quality draw a path (hexagon,
 * cloud), not the default view's plain `rect`; an actor draws a circle; a dependency link draws
 * its "D" marker. `/glsp.html`'s default fixture (`fixtures/pistar/welcome.txt`) has a Task, a
 * Quality, Agent and Role actors, and dependency links, so no fixture switch is needed.
 */
test.describe('GLSP client: iStar 2.0 shapes', () => {
  test('a task and a quality draw a path, not the default rect', async ({ page }) => {
    await page.goto('/glsp.html');

    const task = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Task"] > .sprotty-node')
      .first();
    await expect(task).toBeVisible();
    await expect(task).toHaveJSProperty('tagName', 'path');

    const quality = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Quality"] > .sprotty-node')
      .first();
    await expect(quality).toBeVisible();
    await expect(quality).toHaveJSProperty('tagName', 'path');
  });

  test('actors draw a circle', async ({ page }) => {
    await page.goto('/glsp.html');

    const agent = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Agent"] > .sprotty-node')
      .first();
    await expect(agent).toBeVisible();
    await expect(agent).toHaveJSProperty('tagName', 'circle');

    const role = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Role"] > .sprotty-node')
      .first();
    await expect(role).toBeVisible();
    await expect(role).toHaveJSProperty('tagName', 'circle');
  });

  test('a dependency link draws the "D" marker', async ({ page }) => {
    await page.goto('/glsp.html');

    const marker = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="edge:istar.DependencyLink"]')
      .first()
      .locator('.istar-glsp-dependency');
    await expect(marker).toHaveCount(1);
  });
});
