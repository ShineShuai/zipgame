// The Web Worker script (a module worker: `new Worker(url, { type: 'module' })`, see worker-run.js). All the work is in core/gen/play-job.js.
import { handleGenerate } from '../core/gen/play-job.js';

self.onmessage = e => handleGenerate(e.data, msg => self.postMessage(msg));
