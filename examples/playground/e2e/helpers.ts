import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export type LabTab =
  | 'Action log'
  | 'Client toggles'
  | 'Script console'
  | 'Guards'
  | 'Change set'
  | 'Replay';

/** Loads the playground and waits for the canvas to render. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();
}

/** Switches the active extension to plain piStar, then starts a fresh empty model. */
export async function resetToEmptyModel(page: Page): Promise<void> {
  // Both toolbar <select>s match `getByLabel`/`getByRole(..., {name})` ambiguously (the label's
  // accessible name picks up its select's own option text); the "Extension" select is the only
  // one with a "none" option, so select it that way instead.
  await page.locator('select:has(option[value="none"])').selectOption('none');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(elementsCount(page)).toHaveText('0');
  await expect(linksCount(page)).toHaveText('0');
}

export function elementsCount(page: Page): Locator {
  return page.locator('.pg-stats > div').nth(0).locator('dd');
}

export function linksCount(page: Page): Locator {
  return page.locator('.pg-stats > div').nth(1).locator('dd');
}

export async function openLabTab(page: Page, tab: LabTab): Promise<void> {
  await page.getByRole('button', { name: tab, exact: true }).click();
}

export function logRows(page: Page): Locator {
  return page.locator('.pg-lab-log-row');
}

/** The action log's rows as plain text, client first (`pg-lab-log-client`'s own span). */
export async function logRowTexts(page: Page): Promise<string[]> {
  await openLabTab(page, 'Action log');
  return logRows(page).allTextContents();
}

/** Selects the "Actor" tool from the palette's actor group (Actor/Agent/Role share a flyout). */
export async function selectActorTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More: Actor', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Actor', exact: true }).click();
}

/** Selects an ungrouped element or link tool from the palette by its visible label. */
export async function selectTool(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}

export function canvasPane(page: Page): Locator {
  return page.locator('.react-flow__pane');
}

export function nodeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

/**
 * Clicks inside `node` at the given fraction of its rendered box (0–1 each axis), not a fixed
 * pixel offset: the canvas's initial zoom shrinks a fresh empty model's nodes, so a fixed offset
 * can land past a node's edge, onto the pane behind it.
 */
export async function clickInside(node: Locator, fx: number, fy: number): Promise<void> {
  const box = await node.boundingBox();
  if (!box) throw new Error('clickInside: node has no bounding box');
  await node.click({ position: { x: box.width * fx, y: box.height * fy } });
}

/** The id `createNode`/`createEdge` just created, read off the action log's last row. */
export async function lastCreatedId(page: Page): Promise<string> {
  await openLabTab(page, 'Action log');
  const text = await logRows(page).last().locator('.pg-lab-log-result').innerText();
  const match = /ok → ([^,]+)/.exec(text);
  if (!match) throw new Error(`last log row has no created id: "${text}"`);
  return match[1]!.trim();
}

/** Drags from `from`'s node to `to`'s node, as a link tool's connect gesture needs. */
export async function dragConnect(page: Page, from: Locator, to: Locator): Promise<void> {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('connect: node has no bounding box');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
}

/**
 * Drags `node` by `dx`/`dy` CSS pixels, starting from the given fraction of its box (not
 * necessarily its center, which for an actor may sit over one of its children and drag that
 * child instead).
 */
export async function dragNodeBy(
  page: Page,
  node: Locator,
  dx: number,
  dy: number,
  { fx = 0.5, fy = 0.5 }: { fx?: number; fy?: number } = {},
): Promise<void> {
  const box = await node.boundingBox();
  if (!box) throw new Error('drag: node has no bounding box');
  const startX = box.x + box.width * fx;
  const startY = box.y + box.height * fy;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

export function undoButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Undo', exact: true });
}

export function redoButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Redo', exact: true });
}
