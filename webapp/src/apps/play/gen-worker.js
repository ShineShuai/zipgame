// The worker of the play app's generation (see platform/worker-run.js for the messages). A cancel ends this worker with
// terminate(), so the long loop in runJob needs no way to be interrupted.
import { runJob } from './gen-job.js';

self.onmessage = async ({ data: { id, job } }) => {
  try {
    const result = await runJob(job, event => self.postMessage({ id, type: 'event', event }));
    self.postMessage({ id, type: 'done', result });
  } catch (e) {
    self.postMessage({ id, type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
