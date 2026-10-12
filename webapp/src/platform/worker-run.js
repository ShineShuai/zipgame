// Page side of the generation Web Worker: the Play app's puzzle search (core/gen/play.js) takes seconds at the larger sizes and stalled the
// page for up to a second at a time when it ran on the page's own thread (platform/run.js time-slices it); in a worker the page keeps
// repainting. One worker, created on first use and kept; requests run one after the other (a second one waits for the first).
//
// createWorkerRunner(makeWorker) -> { run(n, seed, onEvent) -> Promise<puzzle>, terminate() }
//   makeWorker() returns an object with postMessage, terminate, addEventListener / removeEventListener ('message', 'error') like a Worker.
//   run() rejects with WorkerUnavailable when the worker cannot be created or dies on its own (no module workers, blocked, file://): the
//   caller then does the job itself, and later calls fail at once (no retry). A job that fails inside the worker rejects with a plain Error.
// generateInWorker(n, seed, onEvent) -> Promise<puzzle | null>: the same on a real Worker; null = none here, do it on this thread.
export class WorkerUnavailable extends Error {
  constructor(reason) { super('worker unavailable' + (reason ? ': ' + reason : '')); this.name = 'WorkerUnavailable'; }
}

export function createWorkerRunner(makeWorker) {
  let worker = null, nextId = 1, tail = Promise.resolve(), broken = false;
  const give = e => { broken = true; if (worker) { try { worker.terminate(); } catch { /* gone already */ } worker = null; } return new WorkerUnavailable(e && e.message); };
  const once = (n, seed, onEvent) => new Promise((resolve, reject) => {
    let w;
    try { worker = worker || makeWorker(); w = worker; } catch (e) { return reject(give(e)); }
    const id = nextId++;
    const stop = () => { w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); };
    const onMessage = ev => {
      const m = ev.data;
      if (!m || m.id !== id) return;
      if (m.type === 'event') { if (onEvent) onEvent(m.event); return; }
      stop();
      if (m.type === 'done') resolve(m.puzzle); else reject(new Error(m.message || 'generation failed'));
    };
    const onError = ev => { stop(); reject(give(ev)); };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, type: 'play', n, seed });
  });
  return {
    run(n, seed, onEvent) {
      if (broken) return Promise.reject(new WorkerUnavailable());
      const job = tail.then(() => (broken ? Promise.reject(new WorkerUnavailable()) : once(n, seed, onEvent)));
      tail = job.catch(() => {});
      return job;
    },
    terminate() { if (worker) { worker.terminate(); worker = null; } },
  };
}

let shared = null;
export async function generateInWorker(n, seed, onEvent) {
  if (typeof Worker === 'undefined') return null;
  shared = shared || createWorkerRunner(() => new Worker(new URL('./play-worker.js', import.meta.url), { type: 'module' }));
  try {
    return await shared.run(n, seed, onEvent);
  } catch (e) {
    if (e instanceof WorkerUnavailable) { console.warn('generation worker unavailable, generating on this thread:', e.message); return null; }
    throw e;
  }
}
