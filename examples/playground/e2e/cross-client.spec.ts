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
  fy = 0.5,
): Promise<string> {
  const diagram = page.locator('.pg-both-glsp-diagram svg');
  // Boxes are recomputed on every `toPass()` retry (`waitForCreation`, below): under a loaded
  // machine the diagram can still be settling its fit-to-screen when the first attempt reads
  // them, so a position computed once outside the retry loop can go stale.
  const created = await app.graph.waitForCreation('node:istar.Goal', async () => {
    const actorBox = await glspNode(page, actorId).boundingBox();
    const diagramBox = await diagram.boundingBox();
    if (!actorBox || !diagramBox) throw new Error('actor or diagram has no layout box');
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

/** An element's box in model coordinates, and whether its size is read from the DOM. */
interface ModelBox {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Every element's box in the React pane, in model coordinates: React Flow renders each node at
 * its absolute position (`translate(Xpx, Ypx)`), sized by its `width`/`height` styles.
 */
function reactBoxes(page: Page): Promise<Record<string, ModelBox>> {
  return page.evaluate(() => {
    const boxes: Record<string, ModelBox> = {};
    const nodes = document.querySelectorAll<HTMLElement>('.pg-both-react .react-flow__node');
    for (const node of nodes) {
      if (node.classList.contains('react-flow__node-istarLinkAnchor')) continue;
      const [, x, y] = node.style.transform.match(/translate\((-?[\d.]+)px, *(-?[\d.]+)px\)/)!;
      boxes[node.dataset.id!] = {
        x: Number(x),
        y: Number(y),
        width: parseFloat(node.style.width),
        height: parseFloat(node.style.height),
      };
    }
    return boxes;
  });
}

/**
 * Every element's box in the GLSP pane, in model coordinates: Sprotty positions a node by a
 * `translate(x, y)` relative to its parent node. The size is read from a rect of the node's
 * size (an actor's boundary, a goal) or, for path shapes, from the name label the GModel
 * centres on the box; a collapsed actor (just its symbol) has its position compared only.
 */
function glspBoxes(page: Page): Promise<Record<string, ModelBox>> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, which sees no outer scope
    const isNode = (el: Element): boolean => {
      const type = el.getAttribute('data-svg-metadata-type') ?? '';
      return type.startsWith('node:') && type !== 'node:link-anchor';
    };
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, which sees no outer scope
    const translate = (el: Element): [number, number] => {
      const match = (el.getAttribute('transform') ?? '').match(
        /translate\((-?[\d.e-]+)[ ,]+(-?[\d.e-]+)\)/,
      );
      return match ? [Number(match[1]), Number(match[2])] : [0, 0];
    };
    const boxes: Record<string, ModelBox> = {};
    const nodes = document.querySelectorAll('.pg-both-glsp-diagram [data-svg-metadata-type]');
    for (const node of nodes) {
      if (!isNode(node)) continue;
      let [x, y] = translate(node);
      for (let up = node.parentElement; up; up = up.parentElement) {
        if (!isNode(up)) continue;
        const [dx, dy] = translate(up);
        x += dx;
        y += dy;
      }
      // The view draws an actor's boundary and a goal as a rect of the node's size; a path shape
      // scales its path instead, but the GModel centres an element's name label on its box.
      const rect = node.querySelector(
        ':scope > rect.istar-glsp-actor-boundary, :scope > rect.sprotty-node',
      );
      const circle = node.querySelector(':scope > circle.sprotty-node');
      const label = node.querySelector(':scope > [data-svg-metadata-type="label"]');
      let sized = {};
      if (rect) {
        sized = {
          width: Number(rect.getAttribute('width')),
          height: Number(rect.getAttribute('height')),
        };
      } else if (!circle && label) {
        const [cx, cy] = translate(label);
        sized = { width: 2 * cx, height: 2 * cy };
      }
      const id = node.id.slice(node.id.lastIndexOf('_') + 1);
      boxes[id] = { x, y, ...sized };
    }
    return boxes;
  });
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

  test('every element has the same box in both panes (#165)', async ({ page }) => {
    await open(page);
    // Both panes draw the one GModel the server sends (#143): the same elements, at the same
    // model positions and sizes. Polled, as the GLSP pane may still be applying its model.
    await expect(async () => {
      const react = await reactBoxes(page);
      const glsp = await glspBoxes(page);
      expect(Object.keys(react).toSorted()).toEqual(Object.keys(glsp).toSorted());
      expect(Object.keys(react).length).toBeGreaterThan(0);
      for (const [id, box] of Object.entries(glsp)) {
        const mine = react[id]!;
        expect(mine.x, `x of ${id}`).toBeCloseTo(box.x, 3);
        expect(mine.y, `y of ${id}`).toBeCloseTo(box.y, 3);
        if (box.width !== undefined) {
          expect(mine.width, `width of ${id}`).toBeCloseTo(box.width, 3);
          expect(mine.height, `height of ${id}`).toBeCloseTo(box.height!, 3);
        }
      }
    }).toPass();
  });

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

  // #102: `mountGlspClient`'s document-level Ctrl/Cmd+Z fallback and the React canvas's own
  // keyboard handler (`IstarCanvas.tsx`'s `onKeyDown`) share one dispatcher/undo stack. If the
  // fallback didn't check `event.defaultPrevented`, a keystroke the GLSP pane's own `KeyTool`
  // (or the React handler) already handled would get forwarded a second time, undoing two edits
  // for one keystroke: create two Goals, press it once, and only the second is undone.
  test('Ctrl/Cmd+Z undoes exactly once on the shared stack, not twice', async ({ page }) => {
    const app = await open(page);
    const firstId = await createGoalInGlsp(page, app, ID.piStarTool);
    const secondId = await createGoalInGlsp(page, app, ID.analyst, 0.66, 0.72);
    await expect(reactNode(page, firstId)).toBeVisible();
    await expect(reactNode(page, secondId)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');

    await expect(reactNode(page, secondId)).toHaveCount(0);
    await expect(glspNode(page, secondId)).toHaveCount(0);
    await expect(reactNode(page, firstId)).toBeVisible();
    await expect(glspNode(page, firstId)).toBeVisible();
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
