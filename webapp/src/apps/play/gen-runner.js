// Where the play app makes its puzzles: in a worker, else on this thread (time-sliced, so the page still answers).
//   runGeneration(job, { onEvent, signal }) -> the result of the job (gen-job.js), or a rejection (AbortError, Error)
import { createWorkerRunner } from '../../platform/worker-run.js';
import { runAsync } from '../../platform/run.js';
import { generatorFor, prepare } from './gen-job.js';

const spawn = () => (typeof Worker === 'undefined'
  ? null
  : new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' }));

const onThisThread = async (job, { onEvent, signal }) => {
  await prepare(job);
  return runAsync(generatorFor(job), { onEvent, signal });
};

const runner = createWorkerRunner({ spawn, fallback: onThisThread });
export const runGeneration = runner.run;
export const generationWhere = () => runner.where;
