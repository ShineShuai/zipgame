#!/usr/bin/env node
// Recompute every calibrated difficulty grade's cutpoints (see src/core/gen/calibration.js for the
// reasoning: pooled across N, each metric bucketed with its OWN thresholds, sampled with the same
// generate() the play app uses).
//
// Usage: node tools/calibrate.mjs [nRange] [seed] [samplesPerN]
//   nRange:      comma-separated sizes, e.g. 7,8,9,10,11 (default: the play app's own 7..11)
//   seed:        integer seed for reproducibility (default: 424242)
//   samplesPerN: puzzles generated per size (default: 25, about 2.5 minutes for 5 sizes; raise it
//                for a steadier calibration before a real release)
//
// Two passes, on purpose. The "combined" grade buckets a z-score, and its thresholds are quantiles of
// that score, so the z-scoring constants (COMBINED_ZSCORE) must be FIXED before its thresholds are
// computed. Pass 1 samples puzzles and measures the constants; pass 2 re-runs calibrateAll with those
// constants applied, so the printed combined cutpoints are consistent with them. Paste BOTH the
// COMBINED_ZSCORE line and the DEFAULT_THRESHOLDS_BY_METRIC block into calibration.js together.
import { makeRng } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';
import { generate, PLAY_SIZES } from '../src/core/gen/generate.js';
import { metricsFor, refNodeCap } from '../src/core/difficulty.js';
import { spatialMetrics } from '../src/core/spatial.js';
import * as cal from '../src/core/gen/calibration.js';

const args = process.argv.slice(2);
const nRange = args[0] ? args[0].split(',').map(Number) : PLAY_SIZES.filter(n => n >= 7 && n <= 11);
const seed = args[1] ? parseInt(args[1], 10) : 424242;
const samplesPerN = args[2] ? parseInt(args[2], 10) : 25;
const r4 = x => +Number(x).toPrecision(4);

console.log(`Calibrating over N=${nRange.join(',')}, seed=${seed}, samplesPerN=${samplesPerN}`);

// ---- pass 1: z-scoring constants for the combined grade (same sampling stream calibrateAll uses) ----
const t0 = Date.now();
const rnd = makeRng(seed);
const BperN = [], cross = [];
for (const n of nRange) {
  for (let i = 0; i < samplesPerN; i++) {
    const s = Math.floor(rnd() * 4294967296) >>> 0;
    const p = runSync(generate(n, s));
    const m = metricsFor(p, refNodeCap(n));
    if (m.exceeded) continue;
    BperN.push(m.B / n); cross.push(spatialMetrics(p).crossPerSeg);
  }
}
const stat = a => { const mean = a.reduce((x, y) => x + y, 0) / a.length; return { mean: r4(mean), sd: r4(Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length)) }; };
const z = { BperN: stat(BperN), cross: stat(cross) };
console.log(`pass 1 (${((Date.now() - t0) / 1000).toFixed(0)}s): measured z constants from ${BperN.length} usable puzzles`);

// Apply the fresh constants in-place so pass 2's combined score uses them (the object is exported
// mutable on purpose for exactly this; the app never mutates it).
Object.assign(cal.COMBINED_ZSCORE.BperN, z.BperN);
Object.assign(cal.COMBINED_ZSCORE.cross, z.cross);

// ---- pass 2: thresholds for every graded metric ----
const t1 = Date.now();
const res = cal.calibrateAll(nRange, seed, samplesPerN);
console.log(`pass 2 (${((Date.now() - t1) / 1000).toFixed(0)}s)\n`);

console.log('// ---- paste into src/core/gen/calibration.js ----');
console.log(`export const COMBINED_ZSCORE = { BperN: { mean: ${z.BperN.mean}, sd: ${z.BperN.sd} }, cross: { mean: ${z.cross.mean}, sd: ${z.cross.sd} } };`);
console.log('export const DEFAULT_THRESHOLDS_BY_METRIC = {');
for (const [id, v] of Object.entries(res)) console.log(`  ${id}: [${v.thresholds.map(r4).join(', ')}],`);
console.log('};\n');

// Sanity: pooled sample size per metric, and a histogram so a skewed/thin sample is visible.
for (const [id, v] of Object.entries(res)) {
  const s = v.samples, lo = s[0], hi = s[s.length - 1], buckets = new Array(10).fill(0);
  for (const x of s) buckets[Math.min(9, hi > lo ? Math.floor(((x - lo) / (hi - lo)) * 10) : 0)]++;
  console.log(`${id.padEnd(14)} n=${String(v.n).padEnd(4)} range ${r4(lo)}..${r4(hi)}  |${buckets.map(c => c === 0 ? '.' : c < 10 ? String(c) : '#').join('')}|  (10 equal-width buckets, low -> high)`);
}
if (res.crossPerSeg.thresholds[0] === res.crossPerSeg.thresholds[1]) {
  console.log('\nnote: crossPerSeg cutpoints repeat (most puzzles have no crossing), so two grades are unreachable — expected, see calibration.js.');
}
