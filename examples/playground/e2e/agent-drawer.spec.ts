import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  canvasPane,
  clickInside,
  elementsCount,
  gotoApp,
  lastCreatedId,
  logRowTexts,
  openLabTab,
  resetToEmptyModel,
  selectActorTool,
  selectTool,
  undoButton,
} from './helpers';
import { HANG, answer, mockDeepSeek, toolCalls } from './mock-deepseek';
import type { RecordedChat } from './mock-deepseek';

const FAKE_KEY = 'sk-test-0123456789abcdefFAKEKEY';

/**
 * The agent drawer (#126 D4, #131) against a mocked DeepSeek endpoint (`mock-deepseek.ts`): no
 * real key, no real network call, in CI. Covers the PR's required scenarios: entering a key,
 * Propose → review → apply as one undo step, a guard refusal shown to the user and fed back to
 * the model, Stop, and Auto mode.
 */
async function openDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open agent drawer' }).click();
  await expect(page.getByLabel('DeepSeek API key')).toBeVisible();
  await page.getByLabel('DeepSeek API key').fill(FAKE_KEY);
}

test.describe('agent drawer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await resetToEmptyModel(page);
  });

  test('Propose mode: review a proposed change set and apply it as one undo step', async ({
    page,
  }) => {
    const requests: RecordedChat[] = [];
    await mockDeepSeek(page, (body, index) => {
      requests.push(body);
      if (index === 0) {
        return toolCalls([
          'create-nodes',
          {
            nodes: [
              {
                elementTypeId: 'node:istar.Actor',
                position: { x: 40, y: 40 },
                args: { name: 'Auditor' },
              },
            ],
          },
        ]);
      }
      return answer('Added an actor.');
    });

    await openDrawer(page);
    await page
      .getByRole('textbox', { name: 'Task' })
      .fill('Give the model an actor called Auditor.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByText('Review the proposed change set')).toBeVisible();
    await expect(page.locator('.pg-lab-agent-step')).toContainText('create-nodes');
    await expect(page.locator('.pg-lab-agent-step .pg-lab-accept')).toBeVisible();

    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText('Applied.')).toBeVisible();
    await expect(elementsCount(page)).toHaveText('1');

    // The drawer's own headless session logs its one bootstrap request too (opening the live
    // MCP session, #131 item 7), racing with the apply itself, so look for the compound by
    // content rather than assuming it is the last row.
    const rows = await logRowTexts(page);
    expect(rows.some((row) => row.includes('Agent') && row.includes('compound'))).toBe(true);

    // One undo step for the whole proposed-and-applied change set.
    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('0');

    // The key is never in the request body sent "over the wire" as anything but the header.
    for (const request of requests) {
      expect(JSON.stringify(request)).not.toContain(FAKE_KEY);
    }
  });

  test('a guard refusal is shown in the review and fed back to the model', async ({ page }) => {
    // One actor with one child already (the demo guard allows at most one per actor, #47).
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await selectTool(page, 'Goal');
    await clickInside(page.locator(`.react-flow__node[data-id="${actorId}"]`), 0.2, 0.25);

    await openLabTab(page, 'Guards');
    await page.getByRole('checkbox').check();

    const requests: RecordedChat[] = [];
    await mockDeepSeek(page, (body, index) => {
      requests.push(body);
      if (index === 0) {
        return toolCalls([
          'create-nodes',
          {
            nodes: [
              {
                elementTypeId: 'node:istar.Goal',
                position: { x: 20, y: 90 },
                containerId: actorId,
                args: { name: 'Second goal' },
              },
            ],
          },
        ]);
      }
      return answer('That was refused.');
    });

    await openDrawer(page);
    await page.getByRole('textbox', { name: 'Task' }).fill('Add a second goal to the actor.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByText('Review the proposed change set')).toBeVisible();
    await expect(page.locator('.pg-lab-agent-step .pg-lab-reject')).toContainText('already has');

    // The refusal's diagnostic reached the model as the next tool-result message.
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    const toolMessages = requests[1]!.messages.filter((m) => m.role === 'tool');
    expect(JSON.stringify(toolMessages)).toContain('already has');

    // Nothing was created: the refused call changed nothing in the dry run.
    await expect(elementsCount(page)).toHaveText('2');
  });

  test('Stop aborts a running request', async ({ page }) => {
    await mockDeepSeek(page, () => HANG);

    await openDrawer(page);
    await page.getByRole('textbox', { name: 'Task' }).fill('Do something slow.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();

    await expect(page.getByText('Stopped: aborted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await expect(stop).toBeDisabled();
  });

  test('text streams in and the budget updates live, before the reply completes (#152)', async ({
    page,
  }) => {
    await mockDeepSeek(page, () =>
      answer(
        'The model streams this reply in over many small chunks, so the drawer can show it ' +
          'arriving and a live token estimate well before the whole answer is in.',
      ),
    );

    await openDrawer(page);
    await page.getByRole('textbox', { name: 'Task' }).fill('Say something long.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    // A live, estimated budget readout appears while the reply is still streaming in, and the
    // assistant line already shows the start of the text before the run finishes.
    await expect(page.getByText('(estimate)')).toBeVisible();
    const assistantLine = page.locator('.pg-agent-log-assistant').last();
    await expect(assistantLine).toContainText('The model streams');
    await expect(page.getByText(/^Stopped: /)).not.toBeVisible();

    // Once the run settles, the estimate is replaced by the exact final usage/cost line and the
    // full text is in place.
    await expect(page.getByText('Stopped: final')).toBeVisible();
    await expect(assistantLine).toHaveText(
      'The model streams this reply in over many small chunks, so the drawer can show it ' +
        'arriving and a live token estimate well before the whole answer is in.',
    );
    await expect(page.getByText('(estimate)')).not.toBeVisible();
  });

  test('Stop mid-stream leaves partial text, marks it stopped, and makes no further calls (#152)', async ({
    page,
  }) => {
    let callCount = 0;
    await mockDeepSeek(page, () => {
      callCount += 1;
      return answer(
        'This is a long streamed reply that Stop should interrupt well before it finishes ' +
          'streaming in, so the test can see a partial line.',
      );
    });

    await openDrawer(page);
    await page.getByRole('textbox', { name: 'Task' }).fill('Say something long, then stop me.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    const assistantLine = page.locator('.pg-agent-log-assistant').last();
    await expect(assistantLine).toContainText('This is a long');

    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();

    await expect(page.getByText('Stopped: aborted')).toBeVisible();
    await expect(assistantLine).toContainText('(stopped)');
    await expect(assistantLine).not.toContainText('finishes streaming in');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await expect(stop).toBeDisabled();

    // The aborted run never asked the model again.
    expect(callCount).toBe(1);
  });

  test('Auto mode applies tool calls as they come, with no review step', async ({ page }) => {
    await mockDeepSeek(page, (_, index) =>
      index === 0
        ? toolCalls([
            'create-nodes',
            {
              nodes: [
                {
                  elementTypeId: 'node:istar.Actor',
                  position: { x: 40, y: 40 },
                  args: { name: 'Auto actor' },
                },
              ],
            },
          ])
        : answer('Done.'),
    );

    await openDrawer(page);
    await page.getByRole('radio', { name: 'Auto (apply as it goes)' }).check();
    await page.getByRole('textbox', { name: 'Task' }).fill('Add an actor, applying it right away.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(elementsCount(page)).toHaveText('1');
    await expect(page.getByText('Review the proposed change set')).not.toBeVisible();

    const rows = await logRowTexts(page);
    expect(rows.at(-1)).toContain('Agent');
  });
});
