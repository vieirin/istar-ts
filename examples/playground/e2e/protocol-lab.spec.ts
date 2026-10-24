import { readFile } from 'node:fs/promises';
import type { Download } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  canvasPane,
  clickInside,
  dragConnect,
  dragNodeBy,
  elementsCount,
  gotoApp,
  lastCreatedId,
  linksCount,
  logRowTexts,
  nodeById,
  openLabTab,
  redoButton,
  resetToEmptyModel,
  selectActorTool,
  selectTool,
  undoButton,
} from './helpers';

/**
 * The protocol lab's eight lessons (#42), driven as a real browser would: palette create, node
 * drag, connect, delete and undo, each checked against the action log (`#45`) and the rendered
 * canvas, not just the model. One test per lesson, named after it.
 */
async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('download produced no path');
  return readFile(path, 'utf8');
}

function stripSaveDate(text: string): string {
  return text.replace(/"saveDate":\s*"[^"]*",?\n?/, '');
}

test.describe('protocol lab', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
  });

  test('one model, four hands: shared undo', async ({ page }) => {
    // Canvas: an actor, then two goals inside it (palette create; the second click lands
    // elsewhere in the actor's frame so the two goals don't overlap).
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);

    await selectTool(page, 'Goal');
    await clickInside(nodeById(page, actorId), 0.2, 0.25);
    const goal1Id = await lastCreatedId(page);

    await selectTool(page, 'Goal');
    await clickInside(nodeById(page, actorId), 0.2, 0.7);
    const goal2Id = await lastCreatedId(page);

    // Script: a third goal, also inside the actor (its template fills `containerId` from the
    // live model), tagged "Script" instead of "Canvas" in the log — the same model, a
    // different hand.
    await openLabTab(page, 'Script console');
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(page.locator('.pg-lab-console-outcome')).toContainText('"ok": true');
    await lastCreatedId(page);

    // Drag (move) the actor. Deselecting first lets it drag by its whole body, not just its
    // symbol (see `IstarCanvas`'s `nothingSelected` handling); a few hundred px, since the
    // canvas's initial zoom (a fresh empty model fits the whole 2000×1300 diagram) shrinks a
    // smaller move below the rounding that turns into a real position change.
    await canvasPane(page).click({ position: { x: 20, y: 20 } });
    await dragNodeBy(page, nodeById(page, actorId), 300, 150, { fx: 0.85, fy: 0.1 });

    // Connect the two canvas-created goals with an And-Refinement link.
    await selectTool(page, 'And');
    await dragConnect(page, nodeById(page, goal1Id), nodeById(page, goal2Id));
    await expect(linksCount(page)).toHaveText('1');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    // Delete the link (select it, press Delete). `force` because the edge's actual hit area is
    // a separate, wider interaction path React Flow draws under its visible line.
    await page.locator('.react-flow__edge').click({ force: true });
    await page.keyboard.press('Delete');
    await expect(linksCount(page)).toHaveText('0');

    const rows = await logRowTexts(page);
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.startsWith('Canvas')).length).toBe(6);
    expect(rows.filter((r) => r.startsWith('Script')).length).toBe(1);
    expect(rows[3]).toContain('Script');
    await expect(elementsCount(page)).toHaveText('4');

    // One shared undo stack: undoing walks back through Canvas and Script dispatches alike, in
    // the order they were made, regardless of who made them. The log itself is untouched by
    // undo — `IstarPalette`'s undo button calls `store.undo()` directly, not through a tagged
    // client.
    await undoButton(page).click(); // undoes the delete: the link comes back
    await expect(linksCount(page)).toHaveText('1');
    await undoButton(page).click(); // undoes the connect
    await expect(linksCount(page)).toHaveText('0');
    await undoButton(page).click(); // undoes the drag
    await undoButton(page).click(); // undoes goal 3 (Script)
    await expect(elementsCount(page)).toHaveText('3');
    await undoButton(page).click(); // undoes goal 2 (Canvas)
    await undoButton(page).click(); // undoes goal 1 (Canvas)
    await undoButton(page).click(); // undoes the actor (Canvas)
    await expect(elementsCount(page)).toHaveText('0');
    await expect(undoButton(page)).toBeDisabled();

    const rowsAfterUndo = await logRowTexts(page);
    expect(rowsAfterUndo).toHaveLength(7);

    // Redo replays the same shared stack forward again.
    await redoButton(page).click();
    await expect(elementsCount(page)).toHaveText('1');
  });

  test('requestCheckEdge before createEdge, then a rejected createEdge', async ({ page }) => {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await selectTool(page, 'Goal');
    await clickInside(nodeById(page, actorId), 0.2, 0.25);
    const goalId = await lastCreatedId(page);

    await openLabTab(page, 'Script console');
    const textarea = page.locator('.pg-lab-console-input');
    const outcome = page.locator('.pg-lab-console-outcome');

    // requestCheckEdge: would an And-Refinement link from the goal onto itself be accepted?
    await textarea.fill(
      JSON.stringify({
        kind: 'requestCheckEdge',
        requestId: 'e2e-check-1',
        edgeType: 'istar.AndRefinementLink',
        sourceElementId: goalId,
        targetElementId: goalId,
      }),
    );
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(outcome).toContainText('"isValid": false');
    await expect(outcome).toContainText('self-link');

    // The dispatcher's `canLink` agrees: the actual createEdge is rejected the same way.
    await textarea.fill(
      JSON.stringify({
        kind: 'createEdge',
        elementTypeId: 'istar.AndRefinementLink',
        sourceElementId: goalId,
        targetElementId: goalId,
      }),
    );
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(outcome).toContainText('"ok": false');
    await expect(outcome).toContainText('self-link');
    await expect(linksCount(page)).toHaveText('0');

    const rows = await logRowTexts(page);
    expect(rows).toHaveLength(4); // actor, goal, requestCheckEdge, rejected createEdge
    expect(rows.at(-1)).toContain('createEdge');
    await expect(page.locator('.pg-lab-log-row-rejected')).toHaveCount(1);
  });

  test('a compound with one bad member changes nothing', async ({ page }) => {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);

    await openLabTab(page, 'Script console');
    const textarea = page.locator('.pg-lab-console-input');
    const outcome = page.locator('.pg-lab-console-outcome');

    // One good createNode, one bad deleteElement (an id that doesn't exist), as one compound.
    await textarea.fill(
      JSON.stringify({
        kind: 'compound',
        operationList: [
          {
            kind: 'createNode',
            elementTypeId: 'istar.Goal',
            containerId: actorId,
            location: { x: 100, y: 100 },
          },
          { kind: 'deleteElement', elementIds: ['does-not-exist'] },
        ],
      }),
    );
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(outcome).toContainText('"ok": false');

    // Nothing changed: still just the actor, and the compound's own dispatch is the only new row.
    await expect(elementsCount(page)).toHaveText('1');
    const rows = await logRowTexts(page);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)).toContain('compound');
    await expect(page.locator('.pg-lab-log-row-rejected')).toHaveCount(1);
  });

  test('guards', async ({ page }) => {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await selectTool(page, 'Goal');
    await clickInside(nodeById(page, actorId), 0.2, 0.25);

    // Off: a second child of the same actor is accepted.
    await selectTool(page, 'Task');
    await clickInside(nodeById(page, actorId), 0.2, 0.7);
    await expect(elementsCount(page)).toHaveText('3');

    // On: the demo guard (at most one child per actor) now refuses a third.
    await openLabTab(page, 'Guards');
    await page.getByRole('checkbox').check();
    await expect(page.getByText('On — a dispatch that breaks the guard is rejected')).toBeVisible();

    await selectTool(page, 'Resource');
    await clickInside(nodeById(page, actorId), 0.6, 0.25);
    await expect(elementsCount(page)).toHaveText('3'); // unchanged: the guard refused it

    const rows = await logRowTexts(page);
    expect(rows.at(-1)).toContain('this guard allows at most');
    await expect(page.locator('.pg-lab-log-row-rejected')).toHaveCount(1);
  });

  test('in-process vs MessageChannel transport, identical log rows', async ({ page }) => {
    // The remote worker demo (#28): a Web Worker dispatches over a MessageChannel, tagged
    // "Worker" in the log, and adds its nodes one dispatch at a time — each its own undo step
    // (#28's acceptance check).
    await page.getByRole('button', { name: 'Run remote worker demo' }).click();
    await expect(page.getByRole('button', { name: 'Run remote worker demo' })).toBeEnabled({
      timeout: 10_000,
    });
    await expect(elementsCount(page)).toHaveText('3');

    const workerRows = await logRowTexts(page);
    expect(workerRows).toHaveLength(3);
    for (const row of workerRows) expect(row).toContain('Worker');
    for (const row of workerRows) expect(row).toContain('createNode');

    // Each worker dispatch undoes on its own: three undos, three fewer elements each time.
    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('2');
    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('1');
    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('0');

    // The same shape of action, dispatched in-process from the script console, logs the same way
    // except for the client tag.
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await openLabTab(page, 'Script console');
    await page.getByRole('combobox', { name: 'Kind' }).selectOption('createNode');
    const textarea = page.locator('.pg-lab-console-input');
    const template = JSON.parse(await textarea.inputValue()) as Record<string, unknown>;
    expect(template.kind).toBe('createNode');
    await textarea.fill(JSON.stringify({ ...template, containerId: actorId }));
    await page.getByRole('button', { name: 'Dispatch' }).click();

    const scriptRows = await logRowTexts(page);
    expect(scriptRows.at(-1)).toContain('Script');
    expect(scriptRows.at(-1)).toContain('createNode');
  });

  test('the pseudo-agent change set', async ({ page }) => {
    await openLabTab(page, 'Change set');
    await expect(page.getByText('Give the model an actor with an audit trail')).toBeVisible();

    await page.getByRole('button', { name: 'Dry run' }).click();
    await expect(page.getByText('accept →').first()).toBeVisible();
    await expect(page.locator('.pg-lab-reject')).toHaveCount(0);

    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText('Applied.')).toBeVisible();

    // Four nodes and one link, applied as a single compound — one dispatch, one undo step.
    await expect(elementsCount(page)).toHaveText('4');
    await expect(linksCount(page)).toHaveText('1');

    const rows = await logRowTexts(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Agent');
    expect(rows[0]).toContain('compound');
    await openLabTab(page, 'Change set'); // logRowTexts switched to Action log

    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('0');

    // Applying the same plan again is rejected as a whole: its steps carry fixed ids.
    await page.getByRole('button', { name: 'Dry run' }).click();
    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText('Applied.')).toBeVisible();
    await page.getByRole('button', { name: 'Dry run' }).click();
    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText(/^Rejected/)).toBeVisible();
    await expect(elementsCount(page)).toHaveText('4'); // unchanged: the second apply did nothing
  });

  test('export, clear, replay: byte-identical toPistar', async ({ page }) => {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await selectTool(page, 'Goal');
    await clickInside(nodeById(page, actorId), 0.2, 0.25);
    await expect(elementsCount(page)).toHaveText('2');

    const [savedBefore] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const beforeText = await readDownload(savedBefore);

    await openLabTab(page, 'Replay');
    const [exported] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export log…' }).click(),
    ]);
    const exportedPath = await exported.path();
    if (!exportedPath) throw new Error('export: no download path');

    await openLabTab(page, 'Action log');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText('No actions yet')).toBeVisible();
    await expect(elementsCount(page)).toHaveText('2'); // clearing the log doesn't touch the model

    await openLabTab(page, 'Replay');
    await page.getByLabel('Import log…').setInputFiles(exportedPath);
    await page.getByRole('button', { name: 'Apply to canvas' }).click();
    await expect(elementsCount(page)).toHaveText('2');

    const [savedAfter] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const afterText = await readDownload(savedAfter);
    // Byte-identical but for `saveDate`, a fresh timestamp on every save (not part of replay).
    expect(stripSaveDate(afterText)).toBe(stripSaveDate(beforeText));
  });

  test('canvas hidden, model still editable', async ({ page }) => {
    // The lesson's point: the action protocol doesn't need the canvas. Without ever touching it,
    // the script console edits the same model, and the log/stats panes (independent of the
    // canvas) show it.
    await openLabTab(page, 'Script console');
    // The default createNode template needs a container (a `<elementId>` placeholder when the
    // model is empty), so this types an actor directly instead.
    await page.locator('.pg-lab-console-input').fill(
      JSON.stringify({
        kind: 'createNode',
        elementTypeId: 'istar.Actor',
        location: { x: 40, y: 40 },
        args: { name: 'Headless Actor' },
      }),
    );
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(page.locator('.pg-lab-console-outcome')).toContainText('"ok": true');
    await expect(elementsCount(page)).toHaveText('1');

    const rows = await logRowTexts(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Script');
    expect(rows[0]).toContain('createNode');
  });
});
