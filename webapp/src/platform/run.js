// Time-sliced driver for core generators: keeps the UI responsive without a Worker. Results are identical to runSync.
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
