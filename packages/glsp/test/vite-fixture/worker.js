// The GLSP server, in a Web Worker, over the model at `welcome.txt`.
import { startIstarGlspWorker } from '@istar-ts/glsp/browser';

void startIstarGlspWorker({ url: new URL('welcome.txt', self.location.href).href });
