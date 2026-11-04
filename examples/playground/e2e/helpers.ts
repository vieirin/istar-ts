import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Reads a `page.waitForEvent('download')`'s saved file as text. */
export async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('download produced no path');
  return readFile(path, 'utf8');
}

/** `saveDate` is a fresh timestamp on every save, not part of a byte-identical comparison. */
export function stripSaveDate(text: string): string {
  return text.replace(/"saveDate":\s*"[^"]*",?\n?/, '');
}

export type LabTab =
  | 'Action log'
  | 'Client toggles'
  | 'Script console'
  | 'Guards'
  | 'Change set'
  | 'Replay';

/** Loads the React playground and waits for the canvas to render. */
export async function gotoApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/react.html${query}`);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
}

/** Switches the active extension, then starts a fresh empty model under it. */
export async function switchExtension(page: Page, extensionId: string): Promise<void> {
  // Both toolbar <select>s match `getByLabel`/`getByRole(..., {name})` ambiguously (the label's
  // accessible name picks up its select's own option text); the "Extension" select is the only
  // one with a "none" option, so select it that way instead.
  await page.locator('select:has(option[value="none"])').selectOption(extensionId);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(elementsCount(page)).toHaveText('0');
  await expect(linksCount(page)).toHaveText('0');
}

/** Switches the active extension to plain piStar, then starts a fresh empty model. */
export async function resetToEmptyModel(page: Page): Promise<void> {
  await switchExtension(page, 'none');
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
 * Clamps a page point's x into the canvas pane's own box, minus a small margin. A node's own
 * `boundingBox()` can extend past the pane's right edge when the inspector/lab aside renders
 * wide (`.pg-aside` is `width: max-content`), clipped behind the aside even though the DOM rect
 * still reports the node's full, unclipped geometry — a fraction-of-the-node point can land on
 * the aside instead of the node (#274). The clamped x is still on the node whenever the node's
 * own left edge is inside the pane, which every node created through the palette is.
 */
export async function clampXToPane(page: Page, x: number): Promise<number> {
  const pane = await canvasPane(page).boundingBox();
  if (!pane) throw new Error('clampXToPane: canvas pane has no bounding box');
  return Math.min(x, pane.x + pane.width - 20);
}

/**
 * Clicks a spot of the canvas pane clear of any node, to deselect whatever is selected. A
 * fraction of the pane's own rendered box, not a fixed pixel offset: the pane's width shrinks
 * with how wide the inspector/lab aside renders (`.pg-aside` is `width: max-content`, e.g. a
 * long action-log row), so a fixed offset like `x: 600` can land past the pane's right edge, on
 * the aside itself (#274). Near the pane's top-right corner: these specs create nodes near its
 * top-left.
 */
export async function deselectAll(page: Page): Promise<void> {
  const pane = canvasPane(page);
  const box = await pane.boundingBox();
  if (!box) throw new Error('deselectAll: canvas pane has no bounding box');
  await pane.click({ position: { x: box.width - 20, y: 20 } });
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

/**
 * `locator`'s bounding box, polled until two consecutive reads match: React Flow measures a
 * node (and an actor re-measures to contain a just-added child) over one or more renders, so a
 * box read right after creation can be mid-measurement under worker contention (#274).
 */
export async function stableBoundingBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let previous = await locator.boundingBox();
  for (let i = 0; i < 20; i++) {
    await locator.page().waitForTimeout(50);
    const next = await locator.boundingBox();
    if (
      previous &&
      next &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.width === next.width &&
      previous.height === next.height
    ) {
      return next;
    }
    previous = next;
  }
  if (!previous) throw new Error('stableBoundingBox: locator has no bounding box');
  return previous;
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
  const startX = await clampXToPane(page, box.x + box.width * fx);
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
