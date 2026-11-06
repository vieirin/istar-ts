import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  canvasPane,
  clampXToPane,
  clickInside,
  deselectAll,
  dragNodeBy,
  gotoApp,
  lastCreatedId,
  logRows,
  nodeById,
  openLabTab,
  resetToEmptyModel,
  selectActorTool,
  selectTool,
  stableBoundingBox,
  undoButton,
} from './helpers';

/** The last action log row of a given kind, e.g. `changeBounds`. */
function lastLogRowOfKind(page: Page, kind: string): Locator {
  return logRows(page)
    .filter({ has: page.locator('.pg-lab-log-kind', { hasText: kind }) })
    .last();
}

/**
 * The playground has no UI control for `selectActorOnBodyClick` (IstarCanvas prop, not a user
 * setting): the smallest way to flip it for this suite is a `?selectActorOnBodyClick=true` query
 * string read once by `App.tsx`.
 */
test.describe('selectActorOnBodyClick', () => {
  async function createActorAndDeselect(page: Page): Promise<Locator> {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    const node = nodeById(page, actorId);
    await expect(node).toHaveClass(/selected/);
    // A fresh actor is selected right after creation (addAt); clear a spot first.
    await deselectAll(page);
    await expect(node).not.toHaveClass(/selected/);
    return node;
  }

  async function clickBody(node: Locator): Promise<void> {
    const body = node.locator('.istar-actor-boundary');
    const box = await body.boundingBox();
    if (!box) throw new Error('actor body has no bounding box');
    const startX = await clampXToPane(node.page(), box.x + box.width / 2);
    const startY = box.y + box.height / 2;
    await node.page().mouse.move(startX, startY);
    await node.page().mouse.down();
    await node.page().mouse.move(startX + 3, startY + 3, { steps: 4 });
    await node.page().mouse.up();
  }

  test('flag off: a body click with a few px of jitter does not select the actor', async ({
    page,
  }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
    const node = await createActorAndDeselect(page);
    await clickBody(node);
    await expect(node).not.toHaveClass(/selected/);
  });

  test('flag on: a body click with a few px of jitter selects the actor', async ({ page }) => {
    await gotoApp(page, '?selectActorOnBodyClick=true');
    await resetToEmptyModel(page);
    const node = await createActorAndDeselect(page);
    await clickBody(node);
    await expect(node).toHaveClass(/selected/);
  });

  /**
   * An actor and a goal inside it, away from the symbol (top-left) and each other. The goal
   * stays selected (a fresh element is selected right after creation): dragging the actor's body
   * with something else already selected is exactly the case the body-drag fix covers.
   */
  async function createActorWithChild(page: Page): Promise<{ actor: Locator; child: Locator }> {
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    const actor = nodeById(page, actorId);
    await selectTool(page, 'Goal');
    await clickInside(actor, 0.2, 0.6);
    const childId = await lastCreatedId(page);
    const child = nodeById(page, childId);
    await expect(child).toHaveClass(/selected/);
    return { actor, child };
  }

  /** Drags from a point away from the symbol and the child, by `dx`/`dy` screen pixels. */
  async function dragBodyBy(page: Page, actor: Locator, dx: number, dy: number): Promise<void> {
    await dragNodeBy(page, actor, dx, dy, { fx: 0.85, fy: 0.85 });
  }

  test('flag on: dragging the body moves the actor and its child', async ({ page }) => {
    await gotoApp(page, '?selectActorOnBodyClick=true');
    await resetToEmptyModel(page);
    // The goal stays selected: dragging the actor's body with something else already selected
    // is exactly the case the fix covers (`IstarCanvas`'s `bodyDrags`).
    const { actor, child } = await createActorWithChild(page);
    // Every position read below happens on the Guards tab, not Action log: the model position
    // *is* restored exactly by undo (confirmed by instrumenting the store directly), but
    // `.pg-aside` is `width: max-content`, and each dispatch here adds a row to the Action log
    // whose width can nudge that `max-content` by a few px (a longer payload, or a scrollbar
    // appearing); React Flow reacts to the resulting pane resize by nudging the viewport's pan
    // to compensate, shifting every node's on-screen position regardless of the model (#274).
    // Guards' content doesn't grow with dispatches, so it keeps the aside's width constant
    // across every read here.
    await openLabTab(page, 'Guards');
    const actorBefore = await actor.boundingBox();
    const childBefore = await child.boundingBox();
    if (!actorBefore || !childBefore) throw new Error('node has no bounding box');

    // A few hundred px: the canvas's initial zoom (a fresh empty model fits the whole 2000×1300
    // diagram) shrinks a smaller move below the rounding that turns into a real position change
    // (same reasoning as `protocol-lab.spec.ts`), and leaves enough margin under worker
    // contention that the move reliably registers as a drag, not a click.
    await dragBodyBy(page, actor, 300, 300);

    const actorAfter = await actor.boundingBox();
    const childAfter = await child.boundingBox();
    if (!actorAfter || !childAfter) throw new Error('node has no bounding box');
    expect(actorAfter.x - actorBefore.x).toBeGreaterThan(100);
    expect(actorAfter.y - actorBefore.y).toBeGreaterThan(100);
    expect(childAfter.x - childBefore.x).toBeGreaterThan(100);
    expect(childAfter.y - childBefore.y).toBeGreaterThan(100);

    // One changeBounds for the actor, like a symbol drag, not one per child. Switch to Action
    // log just to read it, then back to Guards before the next position read (above).
    await openLabTab(page, 'Action log');
    const lastMove = lastLogRowOfKind(page, 'changeBounds');
    await expect(lastMove.locator('.pg-lab-log-client')).toHaveText('Canvas');
    await openLabTab(page, 'Guards');
    await undoButton(page).click();
    const actorUndone = await actor.boundingBox();
    if (!actorUndone) throw new Error('node has no bounding box');
    expect(Math.abs(actorUndone.x - actorBefore.x)).toBeLessThan(5);
    expect(Math.abs(actorUndone.y - actorBefore.y)).toBeLessThan(5);
  });

  test('flag off: dragging the body does not move the actor', async ({ page }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
    const { actor, child } = await createActorWithChild(page);
    const actorBefore = await actor.boundingBox();
    const childBefore = await child.boundingBox();
    if (!actorBefore || !childBefore) throw new Error('node has no bounding box');

    await dragBodyBy(page, actor, 60, 60);

    expect(await actor.boundingBox()).toMatchObject({ x: actorBefore.x, y: actorBefore.y });
    expect(await child.boundingBox()).toMatchObject({ x: childBefore.x, y: childBefore.y });
    await openLabTab(page, 'Action log');
    await expect(logRows(page).filter({ hasText: 'changeBounds' })).toHaveCount(0);
  });

  /** Moves the mouse to the given fraction of `locator`'s box and presses the button down. */
  async function pressAt(page: Page, locator: Locator, fx: number, fy: number): Promise<void> {
    const box = await stableBoundingBox(locator);
    const x = await clampXToPane(page, box.x + box.width * fx);
    await page.mouse.move(x, box.y + box.height * fy);
    await page.mouse.down();
  }

  test('pressing the actor symbol selects it before mouseup, deselecting the selected goal', async ({
    page,
  }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
    const { actor, child: goal } = await createActorWithChild(page);

    await pressAt(page, actor.locator('.istar-actor-symbol'), 0.5, 0.5);
    await expect(actor).toHaveClass(/selected/);
    await expect(goal).not.toHaveClass(/selected/);
    await page.mouse.up();
  });

  test('flag on: pressing the actor body selects it before mouseup, deselecting the selected goal', async ({
    page,
  }) => {
    await gotoApp(page, '?selectActorOnBodyClick=true');
    await resetToEmptyModel(page);
    const { actor, child: goal } = await createActorWithChild(page);

    await pressAt(page, actor.locator('.istar-actor-boundary'), 0.85, 0.85);
    await expect(actor).toHaveClass(/selected/);
    await expect(goal).not.toHaveClass(/selected/);
    await page.mouse.up();
  });
});
