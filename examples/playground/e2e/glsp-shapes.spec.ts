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

  test('an actor’s name label is centred on its circle, whatever its length (#120)', async ({
    page,
  }) => {
    await page.goto('/glsp.html');

    // `fixtures/pistar/welcome.txt`'s Agent and Role have names of very different lengths
    // ("piStar tool v2.1.0" vs "Business Analyst"); both must centre the same way.
    for (const kind of ['istar.Agent', 'istar.Role']) {
      const actor = page
        .locator(`.pg-glsp-diagram [data-svg-metadata-type="node:${kind}"]`)
        .first();
      const circle = actor.locator('> .sprotty-node').first();
      const label = actor.locator('text').first();
      await expect(circle).toBeVisible();
      await expect(label).toBeVisible();

      const circleBox = await circle.evaluate((el: SVGGraphicsElement) => {
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      const labelBox = await label.evaluate((el: SVGGraphicsElement) => {
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      expect(Math.abs(labelBox.x - circleBox.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(labelBox.y - circleBox.y)).toBeLessThanOrEqual(2);
    }
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
