/**
 * `?server=worker`: the GLSP server in a Vite module worker (framework-notes §3's
 * `WorkerServerLauncher` transport), with the welcome fixture baked in at build time. MCP is on
 * (#134): the stock client's own `initialize`, next to it on the same port, activates it, and
 * `?server=worker&mcp=1` reaches it from the page with `connectWorkerMcp`.
 */
import { startIstarGlspWorker } from '@istar-ts/glsp/browser';
import welcome from '../../../../fixtures/pistar/welcome.txt?raw';

void startIstarGlspWorker({ model: welcome, sourceUri: 'welcome.txt', mcp: true });
