#!/usr/bin/env node
// Explores the generator's quality/time knobs on the same seeds: for each combination it runs generate(n, seed)
// and reports the mean wall count (fewer = cleaner puzzle) and the mean time. Every combination sees the same
// seeds, hence the same K, so the numbers are paired.
//   node tools/tune-gen.mjs [--sizes 8,10,12] [--seeds 8] [--first-seed 1]
//                           [--cap-x 0.3] [--check-cap-x 0.25,0.5,1] [--candidates-x 1] [--freed-edge | --no-freed-edge]
// Each list option takes comma-separated values; the combinations are their product.
//   --cap-x           multiplies the build node cap (default PROP_CAP_X of src/core/gen/generate.js)
//   --check-cap-x     the share of that cap one wall-removal check gets (default CHECK_CAP_X)
//   --candidates-x    multiplies CANDIDATES[n], the number of candidates minimized per puzzle
//   --freed-edge      minimize with the solver's mustUse check (default: what generate() does by default)
import { generate, CANDIDATES, PROP_CAP_X, CHECK_CAP_X } from '../src/core/gen/generate.js';
import { runSync } from '../src/core/run.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const list = (name, fallback) => String(opt(name, fallback)).split(',').map(Number);
const flag = (name) => args.includes('--' + name);

const sizes = list('sizes', '8,10,12');
const seeds = Number(opt('seeds', 8));
const first = Number(opt('first-seed', 1));
const capXs = list('cap-x', PROP_CAP_X);
const checkXs = list('check-cap-x', CHECK_CAP_X);
const candXs = list('candidates-x', 1);
const freedEdge = flag('no-freed-edge') ? false : flag('freed-edge') ? true : undefined;

const wallCount = (p) => { let w = 0; for (const v of p.walls) w += (v & 1) + ((v >> 1) & 1); return w; };

console.log(`seeds ${first}..${first + seeds - 1}, freedEdge ${freedEdge ?? 'default'}`);
console.log('size  capX  checkCapX  candX  cands |  mean walls  mean ms   total ms');
for (const n of sizes) {
  for (const capX of capXs) for (const checkCapX of checkXs) for (const candX of candXs) {
    const candidates = Math.max(1, Math.round((CANDIDATES[n] || 2) * candX));
    let walls = 0, ms = 0;
    for (let s = first; s < first + seeds; s++) {
      const t = performance.now();
      const p = runSync(generate(n, s, { capX, checkCapX, candidates, ...(freedEdge === undefined ? {} : { freedEdge }) }), () => {});
      ms += performance.now() - t;
      walls += wallCount(p);
    }
    console.log(`${String(n).padStart(4)}  ${String(capX).padStart(4)}  ${String(checkCapX).padStart(9)}  ${String(candX).padStart(5)}  ${String(candidates).padStart(5)} | ${(walls / seeds).toFixed(2).padStart(11)} ${(ms / seeds).toFixed(0).padStart(9)} ${ms.toFixed(0).padStart(10)}`);
  }
}
