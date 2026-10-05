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

export function runAsync(gen, { onEvent, sliceMs = 30 } = {}) {
  return new Promise((resolve, reject) => {
    let last = null, t0 = performance.now();
    const tick = () => {
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) return resolve(r.value);
          if (r.value) last = r.value;
          if (performance.now() - t0 > sliceMs) {
            if (onEvent && last) onEvent(last);
            last = null;
            return setTimeout(() => { t0 = performance.now(); tick(); }, 0);
          }
        }
      } catch (e) { reject(e); }
    };
    tick();
  });
}
