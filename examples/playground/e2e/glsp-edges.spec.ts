import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Edge creation and reconnect in the stock GLSP client (#105), on `/glsp.html`'s iStar welcome
 * fixture. Most clicks are direct (`page.mouse.click` on an element's centre, no hover first),
 * the way browser automation and a quick tap land: with `dynamic` edge hints, the client drops a
 * click that arrives before its own `requestCheckEdge` answer. One test moves and pauses on each
 * element first, like a user.
 *
 * Elements are found through the `data-svg-metadata-*` attributes the client writes
 * (framework-notes §6); the hidden bounds-computation copy of the diagram has none.
 */

const ID = {
  analyst: 'bda083fe-1fb4-41cf-aea9-449c0d4044b5',
  piStarTool: 'fcf67803-5e5a-4bae-8690-1f12af4446d6',
  modelsCreated: '71c7aeb6-fb99-40a1-bcd1-5a29e5b45252',
  usePiStar: '8d716a61-1ca4-44f4-934c-26166ea44d11',
  autoLayout: '9250b018-fb16-4b82-b7bf-5f5589b6b259',
  preventDataLoss: '339417b8-0430-4ceb-be12-d6cf7b440a35',
  // "Modify the diagram" OR-refines "Use the piStar Tool".
  modifyRefinesUse: '7835d50c-0e9d-4fce-a84a-ecf565a30f10',
} as const;

const KAOS = {
  problemNotified: 'f0a633b9-cead-4961-9764-eeb6c3a6c41c',
  minimalInterval: '8c2734b4-eb1c-4b9b-bda2-c7543841c0c8',
  saveBandwidth: '5d2a606c-59aa-4dfc-afbe-8425a49f06e8',
} as const;

function node(page: Page, id: string): Locator {
  return page.locator(`.pg-glsp-diagram [data-svg-metadata-type^="node:"][id$="_${id}"]`);
}

function edges(page: Page, kind: string): Locator {
  return page.locator(`.pg-glsp-diagram [data-svg-metadata-type="edge:${kind}"]`);
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no layout box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point inside `locator`'s box, at the given fraction of its width/height. */
async function pointIn(
  locator: Locator,
  fractionX: number,
  fractionY: number,
): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no layout box');
  return { x: box.x + box.width * fractionX, y: box.y + box.height * fractionY };
}

/** A click with no hover before it: the pointer jumps to the centre and clicks at once. */
async function clickCentre(page: Page, locator: Locator): Promise<void> {
  const { x, y } = await centreOf(locator);
  await page.mouse.click(x, y);
}

/** Like a user: glides onto the element, rests on it, then clicks. */
async function hoverThenClick(page: Page, locator: Locator): Promise<void> {
  const { x, y } = await centreOf(locator);
  await page.mouse.move(x, y, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
}

async function pickTool(page: Page, label: string): Promise<void> {
  await page.locator('.tool-palette').getByText(label, { exact: true }).click();
}

/** The ids (without the client's prefix) of the elements `locator` matches. */
async function idsOf(locator: Locator): Promise<string[]> {
  const ids = await locator.evaluateAll((elements) => elements.map((e) => e.id));
  return ids.map((id) => id.slice(id.indexOf('_', 'glsp-client_'.length) + 1));
}

async function open(page: Page): Promise<void> {
  await page.goto('/glsp.html');
  await expect(node(page, ID.modelsCreated)).toBeVisible();
}

test.describe('GLSP client: edges', () => {
  test('creates a refinement between two goals of one actor', async ({ page }) => {
    await open(page);
    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const goalsBefore = await idsOf(goals);

    // A second goal in "Business Analyst", in its free lower-right area. The node-creation tool
    // listens on the diagram root, so the click goes to the SVG at that point (see glsp.spec.ts).
    const diagram = page.locator('.pg-glsp-diagram svg');
    const actor = await node(page, ID.analyst).boundingBox();
    const diagramBox = await diagram.boundingBox();
    if (!actor || !diagramBox) throw new Error('actor or diagram has no layout box');
    await pickTool(page, 'Goal');
    await diagram.click({
      position: {
        x: actor.x - diagramBox.x + actor.width * 0.66,
        y: actor.y - diagramBox.y + actor.height * 0.72,
      },
    });
    await expect(goals).toHaveCount(goalsBefore.length + 1);
    const created = (await idsOf(goals)).find((id) => !goalsBefore.includes(id))!;
    await expect(node(page, ID.analyst).locator(`[id$="_${created}"]`)).toHaveCount(1);

    const refinements = edges(page, 'istar.AndRefinementLink');
    await expect(refinements).toHaveCount(0);
    await pickTool(page, 'And');
    await clickCentre(page, node(page, created));
    await clickCentre(page, node(page, ID.modelsCreated));

    await expect(refinements).toHaveCount(1);
    await expect(refinements).toHaveAttribute(
      'data-svg-metadata-edge-source-id',
      new RegExp(`_${created}$`),
    );
    await expect(refinements).toHaveAttribute(
      'data-svg-metadata-edge-target-id',
      new RegExp(`_${ID.modelsCreated}$`),
    );
  });

  test('creates a refinement when the user rests on each element before clicking', async ({
    page,
  }) => {
    await open(page);
    const refinements = edges(page, 'istar.AndRefinementLink');
    await pickTool(page, 'And');
    await hoverThenClick(page, node(page, ID.usePiStar));
    await hoverThenClick(page, node(page, ID.modelsCreated));
    await expect(refinements).toHaveCount(1);
    await expect(refinements).toHaveAttribute(
      'data-svg-metadata-edge-source-id',
      new RegExp(`_${ID.usePiStar}$`),
    );
  });

  test('creates a contribution with the palette entry’s value', async ({ page }) => {
    await open(page);
    const contributions = edges(page, 'istar.ContributionLink');
    const before = await contributions.count();
    await pickTool(page, 'Hurt (-)');
    await clickCentre(page, node(page, ID.autoLayout));
    await clickCentre(page, node(page, ID.preventDataLoss));

    await expect(contributions).toHaveCount(before + 1);
    const created = page.locator(
      `.pg-glsp-diagram [data-svg-metadata-edge-source-id$="_${ID.autoLayout}"][data-svg-metadata-edge-target-id$="_${ID.preventDataLoss}"]`,
    );
    await expect(created).toHaveAttribute('data-svg-metadata-type', 'edge:istar.ContributionLink');
    await expect(created).toHaveText('hurt');
  });

  test('creates a dependency between two actors, with its dependum', async ({ page }) => {
    await open(page);
    const dependencies = edges(page, 'istar.DependencyLink');
    const dependums = page.locator(
      '.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"].dependum',
    );
    const linksBefore = await dependencies.count();
    const dependumsBefore = await dependums.count();

    // On the actors' names: their centres are covered by their own elements.
    await pickTool(page, 'Goal dependency');
    await clickCentre(page, page.locator(`.pg-glsp-diagram [id$="_${ID.analyst}_label"]`));
    await clickCentre(page, page.locator(`.pg-glsp-diagram [id$="_${ID.piStarTool}_label"]`));

    await expect(dependums).toHaveCount(dependumsBefore + 1);
    await expect(dependencies).toHaveCount(linksBefore + 2);
  });

  test('reconnects a link’s target', async ({ page }) => {
    await open(page);
    const edge = page.locator(
      `.pg-glsp-diagram [data-svg-metadata-type="edge:istar.OrRefinementLink"][id$="_${ID.modifyRefinesUse}"]`,
    );
    await expect(edge).toHaveAttribute(
      'data-svg-metadata-edge-target-id',
      new RegExp(`_${ID.usePiStar}$`),
    );

    // Select the edge on its path's midpoint; its reconnect handles appear. GLSP reconnects by
    // click, not drag: click the target handle, then the new target.
    const midpoint = await edge
      .locator('path')
      .first()
      .evaluate((path: SVGPathElement) => {
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM()!;
        return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f };
      });
    await page.mouse.click(midpoint.x, midpoint.y);
    const handle = edge.locator('[data-kind="target"][data-svg-metadata-type="routing-point"]');
    await expect(handle).toHaveCount(1);
    await clickCentre(page, handle);
    await clickCentre(page, node(page, ID.modelsCreated));

    await expect(edge).toHaveAttribute(
      'data-svg-metadata-edge-target-id',
      new RegExp(`_${ID.modelsCreated}$`),
    );
  });

  test('a self-refinement is rejected, with the reason in the status line', async ({ page }) => {
    await open(page);
    const refinements = edges(page, 'istar.OrRefinementLink');
    const before = await refinements.count();
    await pickTool(page, 'Or');
    const target = node(page, ID.modelsCreated);
    // Both clicks land on the same node (that's the point), but not on the same pixel: the
    // client's edge-creation tool draws a dangling feedback edge that tracks the pointer once a
    // source is picked (`EdgeCreationToolMouseListener`, `@eclipse-glsp/client`), and under load
    // that feedback edge can still be sitting exactly where the pointer is when the second click's
    // own `mousemove` fires, intercepting the hit test and leaving `currentTarget` unset — so the
    // second click is silently dropped and no `createEdge` ever reaches the server (#124: not a
    // status-line race, the operation itself never got sent). Two distinct points inside the same
    // node's box avoid the overlap.
    const first = await pointIn(target, 0.3, 0.3);
    await page.mouse.click(first.x, first.y);
    const second = await pointIn(target, 0.7, 0.7);
    await page.mouse.click(second.x, second.y);

    const status = page.locator('#pg-glsp-status');
    await expect(status).toContainText('onto itself');
    await expect(status).toHaveAttribute('data-severity', 'ERROR');
    await expect(refinements).toHaveCount(before);
  });

  // iStar 2.0 has no n-ary link; the KAOS fixture's refinements are.
  test('KAOS: an n-ary refinement joins two goals at a new hub, then takes a leg onto it', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#pg-glsp-fixture').selectOption({ label: 'KAOS — welcome' });
    const hubs = page.locator(
      '.pg-glsp-diagram [data-svg-metadata-type="node:kaos.RefinementLinkHub"]',
    );
    const legs = edges(page, 'kaos.RefinementLinkStart');
    await expect(hubs).not.toHaveCount(0);
    const hubsBefore = await idsOf(hubs);
    const legsBefore = await legs.count();

    await pickTool(page, 'Refinement');
    await clickCentre(page, node(page, KAOS.problemNotified));
    await clickCentre(page, node(page, KAOS.minimalInterval));
    await expect(hubs).toHaveCount(hubsBefore.length + 1);
    await expect(legs).toHaveCount(legsBefore + 1);
    const hub = (await idsOf(hubs)).find((id) => !hubsBefore.includes(id))!;

    await pickTool(page, 'Refinement');
    await clickCentre(page, node(page, KAOS.saveBandwidth));
    await clickCentre(page, node(page, hub));
    await expect(legs).toHaveCount(legsBefore + 2);
    await expect(hubs).toHaveCount(hubsBefore.length + 1);
    await expect(
      page.locator(
        `.pg-glsp-diagram [data-svg-metadata-edge-source-id$="_${KAOS.saveBandwidth}"][data-svg-metadata-edge-target-id$="_${hub}"]`,
      ),
    ).toHaveCount(1);
  });
});
