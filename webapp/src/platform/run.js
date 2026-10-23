// Time-sliced driver for core generators: keeps the UI responsive without a Worker. Results are identical to runSync.
// Wraps a generator so that `clock.ms` accumulates only the time spent inside gen.next(), i.e. the
// algorithm's own compute time: not the setTimeout yields between slices, not the onEvent UI updates.
// Yields and the return value pass through unchanged.
export function* measured(gen, clock) {
  for (;;) {
    const start = performance.now();
    const step = gen.next();
    clock.ms += performance.now() - start;
    if (step.done) {
      return step.value;
    }
    yield step.value;
  }
}

export const abortError = () => new DOMException('The generation was cancelled.', 'AbortError');
export const isAbort = e => Boolean(e) && e.name === 'AbortError'; // the player cancelled
export const isTimeout = e => Boolean(e) && e.name === 'TimeoutError'; // cancellable()'s clock ran out

// How long a generation may run before it is stopped (the slowest board takes about 14 s on a desktop; a phone is up to 10x slower).
export const GEN_TIMEOUT_MS = 300000;

// A generation the player can stop: `signal` goes to runAsync, cancel() is the Cancel button, and the clock stops a run that never
// ends after `timeoutMs`. Call end() when the run is over, so the clock does not fire later.
export function cancellable(timeoutMs = GEN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('The generation took too long.', 'TimeoutError')), timeoutMs);
  return { signal: controller.signal, cancel: () => controller.abort(), end: () => clearTimeout(timer) };
}

// `signal` (an AbortSignal) stops the run at once: the generator is closed, no further event is sent and the promise rejects with
// signal.reason (AbortError by default, see isAbort / isTimeout).
export function runAsync(gen, { onEvent, sliceMs = 30, signal } = {}) {
  return new Promise((resolve, reject) => {
    let last = null, t0 = performance.now(), timer = null, over = false;
    const end = (settle, value) => {
      over = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      settle(value);
    };
    function onAbort() {
      if (over) return;
      try { gen.return(); } catch { /* the generator is dropped anyway */ }
      end(reject, signal.reason ?? abortError());
    }
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const tick = () => {
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) return end(resolve, r.value);
          if (r.value) last = r.value;
          if (performance.now() - t0 > sliceMs) {
            if (onEvent && last) onEvent(last);
            last = null;
            if (over) return; // onEvent cancelled the run
            timer = setTimeout(() => { t0 = performance.now(); tick(); }, 0);
            return;
          }
        }
      } catch (e) { end(reject, e); }
    };
    tick();
  });
}
