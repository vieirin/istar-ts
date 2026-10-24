import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  elementsCount,
  gotoApp,
  linksCount,
  nodeById,
  openLabTab,
  resetToEmptyModel,
} from './helpers';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/sample-log.json', import.meta.url));

/**
 * Imports a log exported ahead of time (`e2e/fixtures/sample-log.json`, generated with
 * `e2e/fixtures/generate-sample-log.test.ts`) and checks the replayed model, not just that the
 * import parsed: three elements, one link, under the actor the fixture's first entry created.
 */
test('replays an imported log fixture', async ({ page }) => {
  await gotoApp(page);
  await resetToEmptyModel(page);

  await openLabTab(page, 'Replay');
  await page.getByLabel('Import log…').setInputFiles(FIXTURE_PATH);
  await expect(page.getByText('Source: sample-log.json')).toBeVisible();

  const rows = page.locator('.pg-lab-log-list .pg-lab-log-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'createNode' })).toHaveCount(3);
  await expect(rows.filter({ hasText: 'createEdge' })).toHaveCount(1);
  await expect(page.locator('.pg-lab-log-row-rejected')).toHaveCount(0);

  await page.getByRole('button', { name: 'Apply to canvas' }).click();
  await expect(elementsCount(page)).toHaveText('3');
  await expect(linksCount(page)).toHaveText('1');

  await expect(nodeById(page, 'fixture-actor-1')).toBeVisible();
  await expect(nodeById(page, 'fixture-goal-1')).toContainText('Track Expenses');
  await expect(nodeById(page, 'fixture-task-1')).toContainText('Log Expense');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});
