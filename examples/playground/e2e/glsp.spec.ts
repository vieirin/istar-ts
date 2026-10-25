import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * The stock GLSP client (#83): a smoke test over the default in-page connection, asserting
 * through the SVG `data-svg-metadata-*` attributes the client itself writes
 * (framework-notes §6), as `@eclipse-glsp/playwright` would for a cross-client suite (#74 S4).
 *
 * The main smoke test below undoes through the page's own toolbar button, not the stock
 * client's `Ctrl`/`Cmd+Z` shortcut, to keep that test about node creation rather than focus.
 * `Ctrl`/`Cmd+Z` itself (`GLSPUndoRedoKeyListener`, reached only while the diagram's own SVG has
 * focus) and `mountGlspClient`'s document-level fallback for when it doesn't (#102) each get
 * their own test below.
 */
/** Parses a CSS `rgb(r, g, b)`/`rgba(r, g, b, a)` computed-style string into channel values. */
function rgbChannels(colour: string): readonly [number, number, number] {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(colour);
  if (!match) throw new Error(`not an rgb()/rgba() colour: ${colour}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Relative luminance (WCAG), for a plain brightness-difference contrast check. */
function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks the "Goal" palette tool and creates one inside the "piStar tool" actor, as the first
 * smoke test above does. The click must land on `diagram` itself (clicking a nested element
 * times out: the SVG root "intercepts pointer events" in Playwright's actionability check), at
 * the actor's own centre rather than a fixed canvas pixel (fit-to-screen's zoom varies the
 * layout; a fixed pixel can miss every actor and get "a Goal must be created inside an actor").
 */
async function createGoalInActor(page: Page): Promise<void> {
  const diagram = page.locator('.pg-glsp-diagram svg');
  await page.getByText('Goal', { exact: true }).first().click();
  const actorBox = await page
    .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Agent"]')
    .boundingBox();
  const diagramBox = await diagram.boundingBox();
  if (!actorBox || !diagramBox) throw new Error('actor or diagram has no layout box');
  await diagram.click({
    position: {
      x: actorBox.x - diagramBox.x + actorBox.width / 2,
      y: actorBox.y - diagramBox.y + actorBox.height / 2,
    },
  });
}

test.describe('GLSP client', () => {
  test('opens a fixture, creates a node from the palette and undoes it', async ({ page }) => {
    await page.goto('/glsp.html');

    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    await createGoalInActor(page);
    await expect(goals).toHaveCount(before + 1);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(goals).toHaveCount(before);
  });

  // #102: right after a palette create, focus already sits on the diagram's own SVG (sprotty
  // put it there to create the node), so `GLSPUndoRedoKeyListener` itself handles this one —
  // this test guards that the new document-level fallback (below) doesn't double-undo it.
  test('Ctrl/Cmd+Z undoes a palette create while the diagram has focus', async ({ page }) => {
    await page.goto('/glsp.html');
    await expect(page.locator('.pg-glsp-diagram svg')).toBeVisible();
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    await createGoalInActor(page);
    await expect(goals).toHaveCount(before + 1);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(goals).toHaveCount(before);
  });

  // #102: a click on the toolbar's own Undo/Redo buttons (or the fixture picker) moves focus off
  // the diagram's SVG, so sprotty's `KeyTool` never sees the keystroke; `mountGlspClient`'s
  // document-level fallback must forward it instead.
  test('Ctrl/Cmd+Z undoes a palette create after a toolbar button took focus', async ({ page }) => {
    await page.goto('/glsp.html');
    await expect(page.locator('.pg-glsp-diagram svg')).toBeVisible();
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    await createGoalInActor(page);
    await expect(goals).toHaveCount(before + 1);

    // Nothing to redo yet, so this is a harmless no-op that only moves focus off the diagram.
    const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
    await redoButton.click();
    await expect(redoButton).toBeFocused();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(goals).toHaveCount(before);
  });

  /**
   * The styling regression this smoke test is meant to catch (#103): the diagram shrunk to a
   * small box in the corner, nodes were solid black, and labels were unreadable.
   */
  test('fills the canvas and renders readable, non-black nodes and labels', async ({ page }) => {
    await page.goto('/glsp.html');

    const canvas = page.locator('.pg-glsp-canvas');
    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();

    const canvasBox = await canvas.boundingBox();
    const diagramBox = await diagram.boundingBox();
    if (!canvasBox || !diagramBox) throw new Error('canvas or diagram has no layout box');
    const canvasArea = canvasBox.width * canvasBox.height;
    const diagramArea = diagramBox.width * diagramBox.height;
    expect(diagramArea).toBeGreaterThanOrEqual(canvasArea * 0.8);

    const goalShape = page
      .locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"] .sprotty-node')
      .first();
    const goalFill = await goalShape.evaluate((node) => getComputedStyle(node).fill);
    expect(rgbChannels(goalFill)).not.toEqual([0, 0, 0]);

    const label = page.locator('.pg-glsp-diagram text.sprotty-label').first();
    const labelFill = await label.evaluate((node) => getComputedStyle(node).fill);
    const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(
      Math.abs(luminance(rgbChannels(labelFill)) - luminance(rgbChannels(pageBg))),
    ).toBeGreaterThan(64);
  });

  // #97: a kind only the fixture's own `"metamodel"` block declares (`ra4.Plan`, in
  // `fixtures/extensions/fileMetamodel.txt`) must be offered in the palette and creatable.
  test('a file-declared kind appears in the palette and can be created', async ({ page }) => {
    await page.goto('/glsp.html');
    await page.locator('#pg-glsp-fixture').selectOption({ label: 'iStar 2.0 — file metamodel' });

    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();
    const plans = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:ra4.Plan"]');
    // The fixture's own two `ra4.Plan` elements (the dependum and "Delivery plan"), not a
    // premature read before the GModel finishes rendering (#97's fixture takes a moment longer
    // to settle than the other fixtures, under CI load).
    await expect(plans).toHaveCount(2);
    const before = await plans.count();

    await page.getByText('Plan', { exact: true }).first().click();
    // Just above and left of the "Nurse" role's one child ("Sample collected"): inside the role's
    // boundary, clear of that child and of the tool palette (which sits over the canvas's right
    // edge, overlapping the role's own bounding box here).
    const goalBox = await page
      .locator(
        '.pg-glsp-diagram [data-svg-metadata-type="node:istar.Role"] [data-svg-metadata-type="node:istar.Goal"]',
      )
      .boundingBox();
    const diagramBox = await diagram.boundingBox();
    if (!goalBox || !diagramBox) throw new Error('goal or diagram has no layout box');
    await diagram.click({
      position: {
        x: goalBox.x - diagramBox.x + 10,
        y: goalBox.y - diagramBox.y - 20,
      },
    });
    await expect(plans).toHaveCount(before + 1);
  });

  // #187: the palette must refresh after a model load that changes the metamodel, without
  // remounting the client (the stock palette only reloads for dynamic=true items, but our
  // IstarToolPalette forces refresh on every model update).
  test('the palette refreshes after a metamodel-changing load without remounting', async ({
    page,
  }) => {
    // Start with iStar 2.0 — welcome (no ra4.Plan), then load fileMetamodel without remounting.
    await page.goto('/glsp.html?e2e=1');
    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();

    // The welcome fixture has no ra4.Plan elements or palette entry.
    await expect(
      page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:ra4.Plan"]'),
    ).toHaveCount(0);
    const planPaletteItem = page.getByText('Plan', { exact: true });
    await expect(planPaletteItem).toHaveCount(0);

    // Load fileMetamodel into the running store without remounting the client.
    // Fixture index 3 is "iStar 2.0 — file metamodel".
    await page.evaluate(() => window.glspLoadFixture?.(3));

    // The palette should now include Plan, and the model should have two ra4.Plan elements.
    const plans = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:ra4.Plan"]');
    await expect(plans).toHaveCount(2);
    const planItems = page.getByText('Plan', { exact: true });
    await expect(planItems).toHaveCount(1);
  });
});
