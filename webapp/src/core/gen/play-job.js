// The Play app's generation as a job a Web Worker can run (platform/play-worker.js is the thin worker script, platform/worker-run.js the
// page side). Kept apart from both so it runs, and is tested, anywhere: handleGenerate(msg, post) takes the request and a function that
// sends a message back, and never throws.
//   request  { id, type: 'play', n, seed }
//   replies  { id, type: 'event', event: { frac, walls, K } }   progress, at most one per PROGRESS_MS
//            { id, type: 'done', puzzle: { n, cp, walls, path, seed } }   the puzzle generatePlay(n, seed) makes (typed arrays survive the copy)
//            { id, type: 'error', message }                    bad request, or the generator threw
// The worker has a thread of its own, so the generator runs to the end without yielding: the page stays responsive however long it takes.
import { generatePlayRun } from './play.js';
import { PLAY_SIZES } from './generate.js';

export const PROGRESS_MS = 80;

export function handleGenerate(msg, post, now = () => performance.now()) {
  const id = msg && msg.id;
  try {
    if (!msg || msg.type !== 'play' || !PLAY_SIZES.includes(msg.n) || !Number.isSafeInteger(msg.seed)) {
      throw new Error('bad request');
    }
    const run = generatePlayRun(msg.n, msg.seed);
    let last = -Infinity;
    for (let step = run.next(); ; step = run.next()) {
      if (step.done) {
        post({ id, type: 'done', puzzle: step.value.puzzle });
        return;
      }
      const t = now();
      if (step.value && t - last >= PROGRESS_MS) {
        last = t;
        post({ id, type: 'event', event: step.value });
      }
    }
  } catch (e) {
    post({ id, type: 'error', message: String((e && e.message) || e) });
  }
}
