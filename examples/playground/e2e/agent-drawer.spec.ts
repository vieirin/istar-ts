import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  canvasPane,
  clickInside,
  elementsCount,
  gotoApp,
  lastCreatedId,
  linksCount,
  logRowTexts,
  logRows,
  nodeById,
  openLabTab,
  resetToEmptyModel,
  selectActorTool,
  selectTool,
  switchExtension,
  undoButton,
} from './helpers';
import { HANG, answer, mockDeepSeek, pauseAfterChars, toolCalls } from './mock-deepseek';
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
    await expect(page.locator('.pg-lab-agent-step')).toContainText("create Actor 'Auditor'");
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
    // A refused call is not a step of the change set (#156): it is in the collapsed context.
    await expect(page.locator('.pg-lab-agent-step')).toHaveCount(0);
    await page.locator('.pg-lab-agent-context > summary').click();
    await expect(page.locator('.pg-lab-agent-context .pg-lab-reject')).toContainText('already has');

    // The refusal's diagnostic reached the model as the next tool-result message.
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    const toolMessages = requests[1]!.messages.filter((m) => m.role === 'tool');
    expect(JSON.stringify(toolMessages)).toContain('already has');

    // Nothing was created: the refused call changed nothing in the dry run.
    await expect(elementsCount(page)).toHaveText('2');
  });

  test('Propose mode: an undone step drops out of the review and the applied change set (#163)', async ({
    page,
  }) => {
    await mockDeepSeek(page, (_body, index) => {
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
      if (index === 1) return toolCalls(['undo', {}]);
      if (index === 2) {
        return toolCalls([
          'create-nodes',
          {
            nodes: [
              {
                elementTypeId: 'node:istar.Actor',
                position: { x: 120, y: 40 },
                args: { name: 'Reviewer' },
              },
            ],
          },
        ]);
      }
      return answer('Done.');
    });

    await openDrawer(page);
    await page
      .getByRole('textbox', { name: 'Task' })
      .fill('Add Auditor, undo it, then add Reviewer.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(page.getByText('Review the proposed change set')).toBeVisible();
    // The undone `create-nodes` is not a step: only Reviewer's is (#163).
    await expect(page.locator('.pg-lab-agent-step')).toHaveCount(1);
    await expect(page.locator('.pg-lab-agent-step')).toContainText("create Actor 'Reviewer'");
    await page.locator('.pg-lab-agent-context > summary').click();
    await expect(page.locator('.pg-lab-agent-context-item')).toContainText('agent undid');

    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText('Applied.')).toBeVisible();
    await expect(elementsCount(page)).toHaveText('1');
    await expect(canvasPane(page).getByText('Reviewer')).toBeVisible();
    await expect(canvasPane(page).getByText('Auditor')).not.toBeVisible();
  });

  test('Propose mode: later steps that name a node the proposal created apply with its id', async ({
    page,
  }) => {
    // #155's flow: an actor with a task already, then the model reads, creates a task in the
    // actor, checks and adds a refinement into it, renames it and moves it.
    await selectActorTool(page);
    await canvasPane(page).click({ position: { x: 160, y: 140 } });
    const actorId = await lastCreatedId(page);
    await selectTool(page, 'Task');
    await clickInside(page.locator(`.react-flow__node[data-id="${actorId}"]`), 0.2, 0.25);
    const taskId = await lastCreatedId(page);

    /** The id the last tool result names for the node `create-nodes` created (server-mcp's
     * alias for it, as a real model would read it). */
    let alias = '';
    const readAlias = (body: RecordedChat): void => {
      const tool = body.messages.findLast((m) => m.role === 'tool');
      const content = JSON.parse(String(tool?.content)) as {
        result: { createdNodes: { id: string }[] };
      };
      alias = content.result.createdNodes[0]!.id;
    };
    await mockDeepSeek(page, (body, index) => {
      switch (index) {
        case 0:
          return toolCalls(['query-elements', {}]);
        case 1:
          return toolCalls([
            'create-nodes',
            {
              nodes: [
                {
                  elementTypeId: 'node:istar.Task',
                  position: { x: 260, y: 200 },
                  containerId: actorId,
                  args: { name: 'T8' },
                },
              ],
            },
          ]);
        case 2:
          readAlias(body);
          return toolCalls([
            'check-edge',
            {
              edgeType: 'edge:istar.AndRefinementLink',
              sourceElementId: taskId,
              targetElementId: alias,
            },
          ]);
        case 3:
          return toolCalls([
            'create-edges',
            {
              edges: [
                {
                  elementTypeId: 'edge:istar.AndRefinementLink',
                  sourceElementId: taskId,
                  targetElementId: alias,
                },
              ],
            },
          ]);
        case 4:
          return toolCalls([
            'modify-nodes',
            { nodes: [{ elementId: alias, text: 'T8: Pickup Sample' }] },
          ]);
        case 5:
          return toolCalls([
            'modify-nodes',
            { nodes: [{ elementId: alias, position: { x: 30, y: 120 } }] },
          ]);
        default:
          return answer('Added T8 and refined into it.');
      }
    });

    await openDrawer(page);
    await page.getByRole('textbox', { name: 'Task' }).fill('Add T8: Pickup Sample under the task.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    // Four steps in plain words; the two reads in a collapsed context section (#156).
    await expect(page.getByText('Review the proposed change set')).toBeVisible();
    const steps = page.locator('.pg-lab-agent-step');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toContainText("create Task 'T8' in Actor");
    await expect(steps.nth(1)).toContainText('add And-Refinement from Task');
    await expect(steps.nth(1)).toContainText("to Task 'T8'");
    await expect(steps.nth(2)).toContainText("rename Task 'T8' to 'T8: Pickup Sample'");
    await expect(steps.nth(3)).toContainText("move Task 'T8: Pickup Sample' to");
    const context = page.locator('.pg-lab-agent-context');
    await expect(context).toBeVisible();
    await expect(context).not.toHaveAttribute('open');
    await expect(context.locator('summary').first()).toContainText('Context: 2 calls');
    await expect(context.locator('.pg-lab-agent-context-item').first()).toBeHidden();
    await context.locator('summary').first().click();
    await expect(context.locator('.pg-lab-agent-context-item')).toHaveText([
      /query-elements/,
      /check-edge/,
    ]);
    // The raw call is behind its own disclosure.
    await steps.nth(0).locator('summary', { hasText: 'JSON' }).click();
    await expect(steps.nth(0).locator('pre')).toContainText('"tool": "create-nodes"');

    // The ids the scratch run created, as each step's dry-run outcome shows them.
    const scratchIds = (await steps.locator('.pg-lab-accept').allTextContents()).flatMap((text) => {
      const match = /accept → (.+)/.exec(text);
      return match ? match[1]!.split(', ') : [];
    });
    expect(scratchIds).toHaveLength(2);

    await page.getByRole('button', { name: 'Apply as one compound' }).click();
    await expect(page.getByText('Applied.')).toBeVisible();
    await expect(elementsCount(page)).toHaveText('3');
    await expect(linksCount(page)).toHaveText('1');

    // The live ids are the scratch ids.
    await openLabTab(page, 'Action log');
    const compound = logRows(page).filter({ hasText: 'Agent' }).filter({ hasText: 'compound' });
    await expect(compound).toHaveCount(1);
    await expect(compound.locator('.pg-lab-log-result')).toHaveText(
      `ok → ${scratchIds.join(', ')}`,
    );
    await expect(nodeById(page, scratchIds[0]!)).toContainText('T8: Pickup Sample');

    // One undo step for the whole change set.
    await undoButton(page).click();
    await expect(elementsCount(page)).toHaveText('2');
    await expect(linksCount(page)).toHaveText('0');
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
    const reply =
      'This is a long streamed reply that Stop should interrupt well before it finishes ' +
      'streaming in, so the test can see a partial line.';
    // Paused after "This is a long" streams in: the mock sends no further chunk until this
    // request's `AbortSignal` fires, so Stop always lands before any more text, deterministically
    // rather than racing the mock's own chunk pacing under load (#251).
    await mockDeepSeek(page, () => {
      callCount += 1;
      return pauseAfterChars(answer(reply), 'This is a long'.length);
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

  // #151: the drawer's GLSP contribution comes from the active model's own metamodel, not a
  // hard-coded framework switch — so an extension with no dedicated GLSP contribution (unlike
  // KAOS/NFR) still works, through `contributionFor`'s fallback. goal-controller relabels
  // `istar.Resource` as "Variable" but adds no new kind, so the agent creates one of those:
  // an actor to hold it (`istar.Resource` can't sit on the paper), then the resource itself.
  test('with the goal-controller extension active, the agent creates one of its kinds', async ({
    page,
  }) => {
    await switchExtension(page, 'goal-controller');

    await mockDeepSeek(page, (body, index) => {
      if (index === 0) {
        return toolCalls([
          'create-nodes',
          {
            nodes: [
              {
                elementTypeId: 'node:istar.Actor',
                position: { x: 40, y: 40 },
                args: { name: 'Controller' },
              },
            ],
          },
        ]);
      }
      if (index === 1) {
        const last = body.messages.at(-1) as { role: string; content: string };
        const parsed = JSON.parse(last.content) as {
          result: { createdNodes: Array<{ id: string }> };
        };
        const actorId = parsed.result.createdNodes[0]!.id;
        return toolCalls([
          'create-nodes',
          {
            nodes: [
              {
                elementTypeId: 'node:istar.Resource',
                position: { x: 20, y: 90 },
                containerId: actorId,
                args: { name: 'Budget' },
              },
            ],
          },
        ]);
      }
      return answer('Added the controller and a variable.');
    });

    await openDrawer(page);
    await page.getByRole('radio', { name: 'Auto (apply as it goes)' }).check();
    await page.getByRole('textbox', { name: 'Task' }).fill('Add a controller with a variable.');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(elementsCount(page)).toHaveText('2');
  });
});
