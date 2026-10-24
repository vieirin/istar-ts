// The page: a GLSP client would connect to `worker` itself (`GLSPWebWorkerProvider`); this
// page only reaches the worker's model as an istar-ts action client.
import { connectWorkerDispatcher } from '@istar-ts/glsp/page';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const dispatcher = connectWorkerDispatcher(worker);
dispatcher.subscribe((action) => console.log(action.kind));
