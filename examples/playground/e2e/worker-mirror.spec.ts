import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { clickInside, readDownload } from './helpers';

/**
 * `/both.html?server=worker` (#99): the model lives in a Web Worker (`startIstarGlspWorker`); the
 * React canvas renders a mirror store of it, the stock GLSP client connects to the worker. What
 * the worker holds is read back through its dispatcher (the toolbar's Save asks it with
 * `requestModel`), not from either client's DOM.
 *
 * Ids are the `fixtures/pistar/welcome.txt` fixture's own (as in `cross-client.spec.ts`).
 */
const ID = {
  piStarTool: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
  modelsCreated: '71c7aeb6-fb99-40a1-bcd1-5a29e5b45252',
} as const;

function reactNode(page: Page, id: string): Locator {
  return page.locator(`.pg-both-react .react-flow__node[data-id="${id}"]`);
}

function glspNode(page: Page, id: string): Locator {
  return page.locator(`.pg-both-glsp-diagram [data-svg-metadata-type^="node:"][id$="_${id}"]`);
}

/** The worker's model, as its dispatcher answers `requestModel` (the toolbar's Save). */
async function workerModel(
  page: Page,
): Promise<{ actors: { id: string; nodes: { id: string; text: string }[] }[] }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.pg-both-toolbar').getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  return JSON.parse(await readDownload(download));
}

test.describe('the React canvas on a mirror of a worker-held model', () => {
  // As in `cross-client.spec.ts`: each pane needs room for the GLSP palette not to overlap.
  test.use({ viewport: { width: 3200, height: 1000 } });

  test('a node created in the React canvas exists in the worker’s model', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.goto('/both.html?server=worker');
    await expect(reactNode(page, ID.modelsCreated)).toBeVisible();
    await expect(glspNode(page, ID.modelsCreated)).toBeVisible();

    const goals = page.locator('.pg-both-react .react-flow__node:has([data-kind="istar.Goal"])');
    const before = await goals.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    await page.getByRole('button', { name: 'Goal', exact: true }).click();
    await clickInside(reactNode(page, ID.piStarTool), 0.5, 0.5);
    await expect(goals).toHaveCount(before.length + 1);
    const after = await goals.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    const createdId = after.find((id) => !before.includes(id))!;
    // The canvas opens the new goal's name for editing; commit it as is.
    await page.keyboard.press('Enter');

    // In the worker: inside "piStar tool", and shown by the GLSP client too.
    const actor = (await workerModel(page)).actors.find((a) => a.id === ID.piStarTool);
    expect(actor?.nodes.map((n) => n.id)).toContain(createdId);
    await expect(glspNode(page, createdId)).toBeAttached();

    // Undo is the worker's stack: the goal leaves the worker and both panes.
    await page
      .locator('.pg-both-toolbar')
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(reactNode(page, createdId)).toHaveCount(0);
    await expect(glspNode(page, createdId)).toHaveCount(0);
    const undone = (await workerModel(page)).actors.find((a) => a.id === ID.piStarTool);
    expect(undone?.nodes.map((n) => n.id)).not.toContain(createdId);
    expect(errors).toEqual([]);
  });
});
