import { expect, test } from '@playwright/test';

/**
 * The stock GLSP client (#83): a smoke test over the default in-page connection, asserting
 * through the SVG `data-svg-metadata-*` attributes the client itself writes
 * (framework-notes §6), as `@eclipse-glsp/playwright` would for a cross-client suite (#74 S4).
 *
 * Undo goes through the page's own toolbar button, not the stock client's `Ctrl`/`Cmd+Z`
 * shortcut: the default modules bind no undo/redo *button*, and the keyboard shortcut
 * (`GLSPUndoRedoKeyListener`) needs a focus/platform-modifier combination Playwright's
 * synthetic keyboard events don't reproduce reliably headless.
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

test.describe('GLSP client', () => {
  test('opens a fixture, creates a node from the palette and undoes it', async ({ page }) => {
    await page.goto('/glsp.html');

    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    await page.getByText('Goal', { exact: true }).first().click();
    // The node-creation tool listens on the diagram root, not the element under the pointer, so
    // the click must land on `diagram` itself (clicking a nested element times out: the SVG root
    // "intercepts pointer events" in Playwright's actionability check). The target pixel is the
    // "piStar tool" actor's own centre, not a fixed canvas pixel: once the diagram actually fills
    // the canvas (#103), fit-to-screen's zoom changes, and a fixed pixel no longer lands inside
    // any actor ("a Goal must be created inside an actor").
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
    await expect(goals).toHaveCount(before + 1);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
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
});
