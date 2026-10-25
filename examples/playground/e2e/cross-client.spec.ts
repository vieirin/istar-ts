import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { GLSPApp } from '@eclipse-glsp/playwright';
import { clickInside, dragNodeBy, readDownload, stripSaveDate } from './helpers';

/**
 * React Flow and the stock GLSP client on one model (#74 S4, #85): `/both.html`, over
 * `@istar-ts/glsp`'s in-page `serveIstarGlsp`, as `packages/glsp`'s README recommends for this
 * exact page. The GLSP side is driven with `@eclipse-glsp/playwright`'s page objects
 * (`GLSPApp`/`GLSPGraph`, framework-notes §6), pinned to `2.9.0-next.20` since the released line
 * is 2.8 — see the PR description for how well it worked against our 2.8 client. The React side
 * reuses the existing `data-id`/`react-flow__node` conventions `glsp-edges.spec.ts` and
 * `helpers.ts` already use on `/glsp.html` and `/react.html`.
 *
 * Ids are the `fixtures/pistar/welcome.txt` fixture's own (shared with `glsp-edges.spec.ts`).
 */
const ID = {
  analyst: 'bda083fe-1fb4-41cf-aea9-449c0d4044b5',
  piStarTool: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
  modelsCreated: '71c7aeb6-fb99-40a1-bcd1-5a29e5b45252',
  usePiStar: '8d716a61-1ca4-44f4-934c-26166ea44d11',
} as const;

function glspNode(page: Page, id: string): Locator {
  return page.locator(`.pg-both-glsp-diagram [data-svg-metadata-type^="node:"][id$="_${id}"]`);
}

function reactNode(page: Page, id: string): Locator {
  return page.locator(`.pg-both-react .react-flow__node[data-id="${id}"]`);
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no layout box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickCentre(page: Page, locator: Locator): Promise<void> {
  const { x, y } = await centreOf(locator);
  await page.mouse.click(x, y);
}

/** Picks a tool from the GLSP pane's own tool palette (scoped: both panes render "Goal" etc). */
async function pickGlspTool(page: Page, label: string): Promise<void> {
  await page.locator('.pg-both-glsp').getByText(label, { exact: true }).first().click();
}

/** The plain istar-ts id at the end of a GLSP DOM id (`glsp-client_xxx_<uuid>` → `<uuid>`). */
function plainId(domId: string): string {
  return domId.slice(domId.lastIndexOf('_') + 1);
}

/**
 * Creates a Goal inside `actorId` from the GLSP pane, at the given fraction of its box; returns
 * the plain id. Default: "piStar tool v2.1.0" (collapsed — any click on it lands inside).
 */
async function createGoalInGlsp(
  page: Page,
  app: GLSPApp,
  actorId: string = ID.piStarTool,
  fx = 0.5,
  fy = 0.3,
): Promise<string> {
  const diagram = page.locator('.pg-both-glsp-diagram svg');
  const actorBox = await glspNode(page, actorId).boundingBox();
  const diagramBox = await diagram.boundingBox();
  if (!actorBox || !diagramBox) throw new Error('actor or diagram has no layout box');
  const created = await app.graph.waitForCreation('node:istar.Goal', async () => {
    await pickGlspTool(page, 'Goal');
    await diagram.click({
      position: {
        x: actorBox.x - diagramBox.x + actorBox.width * fx,
        y: actorBox.y - diagramBox.y + actorBox.height * fy,
      },
    });
  });
  expect(created).toHaveLength(1);
  return plainId(created[0]!);
}

async function open(page: Page): Promise<GLSPApp> {
  await page.goto('/both.html');
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  await expect(page.locator('.pg-both-glsp-diagram svg')).toBeVisible();
  await expect(reactNode(page, ID.modelsCreated)).toBeVisible();
  await expect(glspNode(page, ID.modelsCreated)).toBeVisible();
  return new GLSPApp({ type: 'page', page });
}

function logRows(page: Page): Locator {
  return page.locator('.pg-lab-log-row');
}

/**
 * The last row of a given action kind: GLSP's own live-validation `requestMarkers` (translated
 * through the shared dispatcher like any other action) can land after the row a test cares
 * about, so "last row overall" isn't always the right one to assert on.
 */
function lastLogRowOfKind(page: Page, kind: string): Locator {
  return logRows(page)
    .filter({ has: page.locator('.pg-lab-log-kind', { hasText: kind }) })
    .last();
}

function toolbar(page: Page): Locator {
  return page.locator('.pg-both-toolbar');
}

test.describe('cross-client: React Flow and the stock GLSP client on one model', () => {
  // Wide enough that each pane gets roughly `glsp.html`'s own working width: at the project's
  // default 1600 viewport, each pane's ~800px leaves the GLSP tool palette's default layout
  // overlapping the "piStar tool" actor's clickable area, so node-creation clicks there hang.
  test.use({ viewport: { width: 3200, height: 1000 } });

  test('creates in GLSP; the React canvas and the action log see it as "GLSP"', async ({
    page,
  }) => {
    const app = await open(page);
    const createdId = await createGoalInGlsp(page, app);

    await expect(reactNode(page, createdId)).toBeVisible();

    const lastRow = lastLogRowOfKind(page, 'createNode');
    await expect(lastRow.locator('.pg-lab-log-client')).toHaveText('GLSP');
  });

  test('creates in React; the GLSP pane sees it, tagged "React" in the action log', async ({
    page,
  }) => {
    await open(page);
    const goals = page.locator('.pg-both-react .react-flow__node [data-kind="istar.Goal"]');
    const before = await goals.count();

    await page.getByRole('button', { name: 'Goal', exact: true }).click();
    // "piStar tool v2.1.0" is collapsed (a plain icon, no boundary to pick a free spot in): a
    // click anywhere on it adds the Goal inside, same as `createGoalInGlsp`'s GLSP-side click.
    await clickInside(reactNode(page, ID.piStarTool), 0.5, 0.5);
    await expect(goals).toHaveCount(before + 1);

    const lastRow = lastLogRowOfKind(page, 'createNode');
    await expect(lastRow.locator('.pg-lab-log-client')).toHaveText('React');

    // The same element exists in the GLSP pane too (one model, one dispatcher).
    const createdId = (await lastRow.locator('.pg-lab-log-result').innerText())
      .replace(/^ok → /, '')
      .trim();
    await expect(glspNode(page, createdId)).toBeVisible();
  });

  test('undo is one shared stack: undoing after a GLSP edit removes it from both panes', async ({
    page,
  }) => {
    const app = await open(page);
    const createdId = await createGoalInGlsp(page, app);
    await expect(reactNode(page, createdId)).toBeVisible();

    await toolbar(page).getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(reactNode(page, createdId)).toHaveCount(0);
    await expect(glspNode(page, createdId)).toHaveCount(0);
  });

  test('moves, renames and deletes an element across both clients', async ({ page }) => {
    const app = await open(page);
    // Inside "Business Analyst" (expanded, unlike the collapsed "piStar tool"), in its free
    // lower-right area, as `glsp-edges.spec.ts` does on the same fixture — a child of a
    // collapsed actor renders with no space of its own to grab and drag.
    const createdId = await createGoalInGlsp(page, app, ID.analyst, 0.66, 0.72);

    // Move it in the React pane; the GLSP pane's node ends up at the same model position. A
    // few hundred px: the canvas's initial zoom shrinks a smaller move below the rounding that
    // turns into a real position change (same reasoning as `protocol-lab.spec.ts`).
    await dragNodeBy(page, reactNode(page, createdId), 60, 40);
    const lastMoveRow = lastLogRowOfKind(page, 'changeBounds');
    await expect(lastMoveRow.locator('.pg-lab-log-client')).toHaveText('React');

    // Rename it from the React pane: double-click its symbol, type, commit.
    await reactNode(page, createdId).dblclick();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Renamed from React');
    await page.keyboard.press('Enter');
    await expect(reactNode(page, createdId)).toContainText('Renamed from React');
    await expect(glspNode(page, createdId)).toContainText('Renamed from React');

    // Delete it from the GLSP pane; both panes lose it.
    await clickCentre(page, glspNode(page, createdId));
    await page.keyboard.press('Delete');
    await expect(glspNode(page, createdId)).toHaveCount(0);
    await expect(reactNode(page, createdId)).toHaveCount(0);
  });

  test('toPistar is byte-identical after a mixed session is fully undone', async ({ page }) => {
    const app = await open(page);

    const [before] = await Promise.all([
      page.waitForEvent('download'),
      toolbar(page).getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const beforeText = await readDownload(before);

    // One edit per client.
    const createdId = await createGoalInGlsp(page, app);
    await clickCentre(page, reactNode(page, ID.usePiStar));
    await page.keyboard.press('Delete');
    await expect(reactNode(page, ID.usePiStar)).toHaveCount(0);

    // Undo both, in either order: one shared stack.
    const undo = toolbar(page).getByRole('button', { name: 'Undo', exact: true });
    await undo.click();
    await expect(reactNode(page, ID.usePiStar)).toBeVisible();
    await undo.click();
    await expect(reactNode(page, createdId)).toHaveCount(0);
    await expect(glspNode(page, createdId)).toHaveCount(0);

    const [after] = await Promise.all([
      page.waitForEvent('download'),
      toolbar(page).getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const afterText = await readDownload(after);
    expect(stripSaveDate(afterText)).toBe(stripSaveDate(beforeText));
  });
});
