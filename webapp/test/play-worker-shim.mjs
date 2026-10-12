// Worker thread for the tests (node:worker_threads): the same job the browser's module worker (src/platform/play-worker.js) runs.
import { parentPort } from 'node:worker_threads';
import { handleGenerate } from '../src/core/gen/play-job.js';

parentPort.on('message', m => handleGenerate(m, r => parentPort.postMessage(r)));
