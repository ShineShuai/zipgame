// A generation job of the play app and the code that runs it. Both the worker (gen-worker.js) and the main thread (the
// fallback of gen-runner.js) use it, so they make the same puzzle from the same seed. No DOM here: it also runs in a worker.
//   { task: 'flat', mode, n, seed }    a grid puzzle: mode 'standard' or a variant id (variants.js)
//   { task: 'solid', kind, n, seed }   a tetra, cube or ball (n = the ball's id), result { puzzle, path, ... }
import { generate } from '../../core/gen/generate.js';
import { generateSurfaceSteps } from '../../core/surface/gen.js';
import { loadBalls } from '../../core/solid/balls.js';
import { variantById } from './variants.js';

export const EVENT_MS = 50; // at most 20 progress events a second leave the worker

// The balls of a solid job need their catalog (it is loaded on demand).
export async function prepare(job) {
  if (job.task === 'solid' && job.kind === 'ball') await loadBalls();
}

export function generatorFor(job) {
  if (job.task === 'flat') {
    const variant = variantById(job.mode);
    return variant ? variant.generate(job.n, job.seed) : generate(job.n, job.seed);
  }
  if (job.task === 'solid') return generateSurfaceSteps(job.kind, job.n, job.seed);
  throw new Error(`unknown generation job: ${job.task}`);
}

// A progress event as plain numbers and text: whatever else a generator yields stays behind.
export function slim(event) {
  const out = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

// Runs the job to its end and returns the generator's result; onEvent(slim event) at most every EVENT_MS.
export async function runJob(job, onEvent) {
  await prepare(job);
  const gen = generatorFor(job);
  let last = null, sent = -Infinity;
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (r.value) last = r.value;
    if (last) {
      const now = performance.now();
      if (now - sent >= EVENT_MS) {
        onEvent(slim(last));
        last = null;
        sent = now;
      }
    }
  }
}
