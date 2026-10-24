/**
 * `?server=worker`: the GLSP server in a Vite module worker (framework-notes §3's
 * `WorkerServerLauncher` transport), with the welcome fixture baked in at build time.
 */
import { startIstarGlspWorker } from '@istar-ts/glsp/browser';
import welcome from '../../../../fixtures/pistar/welcome.txt?raw';

void startIstarGlspWorker({ model: welcome, sourceUri: 'welcome.txt' });
