import { expect, test } from '@playwright/test';

/**
 * `?server=worker&mcp=1`: the GLSP server in a Web Worker, reached over MCP through server-mcp
 * 2.8.0's `McpWorkerBridge` (#134). `main.ts`'s `mountWorkerMcp` exposes the connected MCP SDK
 * client on `window.glspWorkerMcp` for this suite to drive; the agent drawer itself stays on
 * in-page MCP (out of scope here).
 */
const PI_STAR_TOOL_ACTOR = 'fcf67803-5e5a-4bae-8690-1f12af4446d6';

test.describe('GLSP worker, MCP on', () => {
  test('tools/list and create-nodes reach the worker’s model', async ({ page }) => {
    await page.goto('/glsp.html?server=worker&mcp=1');

    const diagram = page.locator('.pg-glsp-diagram svg');
    await expect(diagram).toBeVisible();
    await page.waitForFunction(() => window.glspWorkerMcp !== undefined);

    const toolNames = await page.evaluate(async () =>
      (await window.glspWorkerMcp!.listTools()).tools.map((tool) => tool.name),
    );
    expect(toolNames).toEqual(expect.arrayContaining(['create-nodes', 'session-info']));

    const goals = page.locator('.pg-glsp-diagram [data-svg-metadata-type="node:istar.Goal"]');
    const before = await goals.count();

    const result = await page.evaluate(async (containerId) => {
      const callResult = await window.glspWorkerMcp!.callTool({
        name: 'create-nodes',
        arguments: {
          sessionId: 'glsp-worker',
          nodes: [
            {
              elementTypeId: 'node:istar.Goal',
              position: { x: 300, y: 300 },
              containerId,
              args: { name: 'From MCP' },
            },
          ],
        },
      });
      return { isError: callResult.isError };
    }, PI_STAR_TOOL_ACTOR);
    expect(result.isError).toBeFalsy();

    await expect(goals).toHaveCount(before + 1);
  });
});
