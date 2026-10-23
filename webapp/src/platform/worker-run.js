// Runs a job in a Web Worker, so that a long generation cannot make the page stall and a cancel stops it at once
// (terminate() ends even a computation that never yields). The job is plain data; the worker answers with messages:
//   page -> worker  { id, job }
//   worker -> page  { id, type: 'event', event } (progress) | { id, type: 'done', result } | { id, type: 'error', message }
// `spawn()` makes the Worker (null when there is none), `fallback(job, { onEvent, signal })` does the job on this thread. The
// fallback is used when no worker can be had, or when it fails to start or dies (a browser without module workers, a page opened
// from a file: URL, a script that did not load). Jobs are seeded, so the fallback makes the same result.
import { abortError } from './run.js';

export function createWorkerRunner({ spawn, fallback }) {
  let worker = null, unusable = false, seq = 0;
  const drop = () => {
    if (worker) worker.terminate();
    worker = null;
  };
  const get = () => {
    if (unusable) return null;
    if (!worker) {
      try {
        worker = spawn();
      } catch (e) {
        console.warn('generation worker: could not start, using this thread:', e && e.message);
      }
      if (!worker) unusable = true;
    }
    return worker;
  };

  // Resolves with the result; rejects with signal.reason (AbortError by default) when the signal fires, and with an Error when
  // the job itself failed. A cancelled or timed-out job ends its worker; the next job starts a fresh one.
  function run(job, { onEvent, signal } = {}) {
    if (signal && signal.aborted) return Promise.reject(signal.reason ?? abortError());
    const w = get();
    if (!w) return fallback(job, { onEvent, signal });
    return new Promise((resolve, reject) => {
      const id = ++seq;
      let over = false;
      const stop = () => {
        over = true;
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onBroken);
        w.removeEventListener('messageerror', onBroken);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      function onMessage({ data }) {
        if (over || !data || data.id !== id) return;
        if (data.type === 'event') {
          if (onEvent) onEvent(data.event);
        } else if (data.type === 'done') {
          stop();
          resolve(data.result);
        } else if (data.type === 'error') {
          stop();
          reject(new Error(data.message));
        }
      }
      function onBroken() {
        if (over) return;
        stop();
        unusable = true;
        drop();
        fallback(job, { onEvent, signal }).then(resolve, reject);
      }
      function onAbort() {
        if (over) return;
        stop();
        drop();
        reject(signal.reason ?? abortError());
      }
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onBroken);
      w.addEventListener('messageerror', onBroken);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      w.postMessage({ id, job });
    });
  }

  // 'unused' (no job yet), 'worker' or 'thread' (the fallback): shown in the dev note
  return { run, get where() { return unusable ? 'thread' : worker ? 'worker' : 'unused'; } };
}
