// Difficulty grade calibration: pooled-quantile thresholds over decisionNodes, computed ACROSS the
// full N range a picker offers rather than separately per N.
//
// Why pooled, not per-N: difficulty is not monotone in N (see zip-puzzle-theory memory — the
// inverted-U vs K effect, and K itself is picked relative to each N's own cell count). Per-N
// quantiles would define "grade 4" as "harder than 80% of THIS SIZE's own puzzles" — two puzzles
// both called grade 4 at N=7 and N=11 could then have very different absolute decisionNodes, and a
// request like "N in [7,11], difficulty 4" would return puzzles that don't actually feel equivalent
// to each other, defeating the point of a difficulty axis meant to be orthogonal to size. Pooling
// the calibration sample across every N in range fixes that: thresholds are cutpoints over the
// union of decisionNodes values seen across all those sizes, so a grade means the same thing
// (relative position in that pooled distribution) regardless of which N a puzzle ended up at.
//
// This is still a self-referential scale (relative to what THIS generator produces), not an
// absolute human-difficulty scale — there is no human solve data yet to calibrate against (see
// difficulty.js's module comment). It's a non-arbitrary starting point, not a finished one.
import { makeRng } from '../rng.js';
import { generate, generateUnique } from './generate.js';
import { runSync } from '../run.js';
import { metricsFor, refNodeCap, gradeOf } from '../difficulty.js';
import { spatialMetrics } from '../spatial.js';

// Quantile cut fractions for grade boundaries 0|1|2|3|4|5 (5 cuts -> 6 buckets). Shared by every
// metric calibrated below — each metric gets its OWN thresholds computed over its OWN pooled
// sample (calling calibrateMetric per metric), never another metric's cutpoints: B and
// decisionNodes have very different numeric ranges (tens vs. thousands), so reusing one's
// thresholds on the other would bucket almost everything into one grade.
export const QUANTILES = [0.2, 0.4, 0.6, 0.8];

// K ~ the inverted-U sweet spot band your own ablations found (~0.1-0.16*N^2 peak difficulty),
// widened a bit so the calibration sample still covers easy/hard extremes, not just the peak.
function calibrationK(n, rnd) {
  const cells = n * n;
  const lo = Math.max(4, Math.round(0.05 * cells));
  const hi = Math.max(lo + 1, Math.round(0.35 * cells));
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

// Every metric that has its own calibrated 0-5 grading, keyed by id — the single source of truth
// both calibrateMetric() and the UI layers use so a grade's id and its thresholds can never drift
// out of sync with each other. `fromMetrics(m, spatial)` pulls this metric's value out of an
// ALREADY-COMPUTED metricsFor()/spatialMetrics() result — see sampleAt() below, which runs each of
// those exactly once per puzzle and lets every metric here read from that shared result, rather
// than each metric re-running its own solve() independently (decisionNodes and B in particular
// both come from the very same reference solve — computing them separately would solve twice for
// no reason).
//
// Picked from what correlated best against a 25-puzzle hand-labeled sample so far (see
// difficulty.js's module comment for the full method): decisionNodes (r=0.26), B (r=0.31), and
// crossPerSeg (r=0.34) were the top three non-size-driven candidates. None of these are validated
// — "best of a weak field" — so treat every grade below with the same caution as decisionNodes'
// own shipped grade.
// z-scoring constants for the combined grade below: mean/sd of B/N and crossPerSeg over the pooled
// calibration sample. Stored, not recomputed per call, so a puzzle's combined score is a pure
// function of ITS OWN metrics — grading one puzzle never depends on which other puzzles happen to be
// in memory. Regenerate with tools/calibrate.mjs whenever the generator or thresholds change.
export const COMBINED_ZSCORE = { BperN: { mean: 3.1588, sd: 1.6547 }, cross: { mean: 0.0861, sd: 0.128 } };
export const combinedScore = (m, s) =>
  (m.B / m.n - COMBINED_ZSCORE.BperN.mean) / COMBINED_ZSCORE.BperN.sd
  + (s.crossPerSeg - COMBINED_ZSCORE.cross.mean) / COMBINED_ZSCORE.cross.sd;

// decisionNodes and B are graded SIZE-NORMALIZED (decisionNodes per cell, B per row of the grid).
// Raw decisionNodes/B grow with grid size independent of how hard a puzzle feels: measured on fresh
// play-app puzzles, the raw-metric grade rose almost linearly with N (mean 1.9 at N=7 to 4.0 at
// N=11) while hand ratings showed no such trend. Per-cell / per-N versions are nearly uncorrelated
// with N (r=0.10 / 0.03 on the rated sample), which is what "difficulty orthogonal to size" needs.
// (`n` is passed in via the metrics object — see metricsFor's caller in sampleAt/gradesFor.)
export const GRADED_METRICS = {
  decisionNodes: { fromMetrics: (m) => m.decisionNodes / (m.n * m.n), label: 'decisionNodes / cell', kind: 'solver' },
  B: { fromMetrics: (m) => m.B / m.n, label: 'B / N (backtrack)', kind: 'solver' },
  crossPerSeg: { fromMetrics: (m, s) => s.crossPerSeg, label: 'crossPerSeg', kind: 'spatial' },
  overlapPerSeg: { fromMetrics: (m, s) => s.overlapPerSeg, label: 'overlapPerSeg', kind: 'spatial' },
  // Sum of z(B/N) and z(crossPerSeg). Chosen because that pair had the best correlation with
  // the 25 hand-rated puzzles (r=0.44) — but it was picked AFTER scanning ~6 pairs on those same 25
  // puzzles, so that r is optimistically biased. Treat as a hypothesis to keep testing, not a fit.
  combined: { fromMetrics: combinedScore, label: 'combined (B/N + cross)', kind: 'combo' },
};

// Generate one calibration sample at size n with the SAME generator the play app uses (generate(),
// not generateUnique with a hand-picked K band): grades are meant to describe the puzzles players
// actually get, and generate()'s K distribution / best-of-several-candidates minimization differ
// enough from a plain generateUnique sweep that calibrating on the latter mis-centres every cutpoint.
// Runs metricsFor() (one reference solve()) and spatialMetrics() (geometry only, no solve) EXACTLY
// ONCE per puzzle; every metric reads its value from those shared results via fromMetrics, so adding
// a metric never adds another solve. Synchronous (runSync drains the generator) — calibration is an
// offline job, not something for the interactive generation path.
function sampleAt(n, rnd) {
  const seed = Math.floor(rnd() * 4294967296) >>> 0;
  const puzzle = runSync(generate(n, seed));
  const m = { ...metricsFor(puzzle, refNodeCap(n)), n };
  if (m.exceeded) return null; // couldn't confirm uniqueness within budget — not a usable sample
  const s = spatialMetrics(puzzle);
  const out = {};
  for (const [id, { fromMetrics }] of Object.entries(GRADED_METRICS)) out[id] = fromMetrics(m, s);
  return out;
}

// Build pooled quantile thresholds for ONE metric from `samplesPerN` puzzles at EACH size in nRange
// (a fixed count per size, independent of how many a real generation run would attempt at that
// size — CANDIDATES weights effort very unevenly across N, and calibration must not silently
// over-represent whichever N is cheapest to generate). Returns { thresholds, samples, n }.
export function calibrateMetric(metricId, nRange, seed, samplesPerN = 40) {
  const rnd = makeRng(seed);
  const samples = [];
  for (const n of nRange) {
    for (let i = 0; i < samplesPerN; i++) {
      const all = sampleAt(n, rnd);
      if (all != null && Number.isFinite(all[metricId])) samples.push(all[metricId]);
    }
  }
  samples.sort((a, b) => a - b);
  const thresholds = QUANTILES.map(q => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]);
  return { thresholds, samples, n: samples.length };
}

// Calibrates EVERY metric in GRADED_METRICS at once, sharing the same generated puzzles across all
// of them (one generation pass, not one per metric) — the natural way to calibrate more than one
// grading without multiplying generation cost. Returns { [metricId]: { thresholds, samples, n } }.
export function calibrateAll(nRange, seed, samplesPerN = 40) {
  const rnd = makeRng(seed);
  const samplesById = Object.fromEntries(Object.keys(GRADED_METRICS).map(id => [id, []]));
  for (const n of nRange) {
    for (let i = 0; i < samplesPerN; i++) {
      const all = sampleAt(n, rnd);
      if (all == null) continue;
      for (const id of Object.keys(GRADED_METRICS)) if (Number.isFinite(all[id])) samplesById[id].push(all[id]);
    }
  }
  const out = {};
  for (const [id, samples] of Object.entries(samplesById)) {
    samples.sort((a, b) => a - b);
    out[id] = { thresholds: QUANTILES.map(q => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]), samples, n: samples.length };
  }
  return out;
}

// Backwards-compatible single-metric alias (decisionNodes only) — kept because generateAtDifficulty
// and existing callers were written against "the" calibration before more metrics existed.
export function calibrate(nRange, seed, samplesPerN = 40) {
  return calibrateMetric('decisionNodes', nRange, seed, samplesPerN);
}

// Default thresholds for the play app's own N range (see PLAY_SIZES in gen/generate.js). Real
// output of calibrateAll([7,8,9,10,11], 424242, 25): 125 pooled puzzles per metric, sampled with the
// SAME generate() the play app uses (not hand-picked). Values for decisionNodes and B are for the
// SIZE-NORMALIZED forms (decisionNodes per cell, B per N) — see GRADED_METRICS. Still provisional: a
// self-referential scale (relative to this generator's own output), not a human-validated one.
// Re-run `node tools/calibrate.mjs` (~2.5 min) and replace this, plus COMBINED_ZSCORE, if the
// generator, prune config, or supported N range changes — a stale calibration drifts silently even
// though nothing here would error.
export const DEFAULT_THRESHOLDS_BY_METRIC = {
  decisionNodes: [3.375, 6.49, 8.037, 10.8],
  B: [1.541, 2.646, 3.249, 4.352],
  // crossPerSeg is exactly 0 for many generated puzzles (no two non-adjacent checkpoint segments
  // cross), so its lowest two cuts collapse to 0: grade 0-1 both mean "no crossing" in practice.
  crossPerSeg: [0, 0, 0.08333, 0.1667],
  overlapPerSeg: [0.25, 0.4167, 0.5385, 0.7],
  // Cuts over the combined z-score (see COMBINED_ZSCORE / combinedScore above).
  combined: [-1.404, -0.373, 0.3096, 1.244],
};
export const DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS_BY_METRIC.decisionNodes; // legacy export, existing callers
// Kept as an alias for callers that want an explicit "I have no calibration, don't crash" fallback
// distinct from "the app's real default" — currently the same values; a true unknown-range fallback
// would want to be wider than a calibrated range's own thresholds, so don't assume these interchange
// forever if this list of supported N ever changes without a re-calibration.
export const FALLBACK_THRESHOLDS = DEFAULT_THRESHOLDS;

// ---- N-ranged generation to a target grade ----
//
// There's no way to construct a puzzle with a target decisionNodes directly (that's not meaningfully
// different from solving the search problem itself), so this is rejection sampling: pick an N in
// range (and a K biased toward the difficulty-appropriate band), generate, grade, keep if it matches.
// Because difficulty isn't monotone in N, the search varies BOTH K and N, not just K at a fixed N —
// a target grade might be easy to hit at N=7 and hard at N=9, or vice versa.
export function* generateAtDifficulty(nRange, targetGrade, thresholds, rnd, o = {}) {
  const tries = o.tries || 30;
  const [lo, hi] = [Math.min(...nRange), Math.max(...nRange)];
  for (let i = 0; i < tries; i++) {
    const n = lo + Math.floor(rnd() * (hi - lo + 1));
    const K = calibrationK(n, rnd);
    const result = yield* generateUnique(n, K, rnd, { tries: o.triesPerAttempt || 15 });
    if (!result.unique) continue;
    const metrics = metricsFor(result.puzzle, refNodeCap(n));
    const grade = gradeOf(metrics.decisionNodes, thresholds);
    yield { frac: (i + 1) / tries, n, grade, target: targetGrade };
    if (grade === targetGrade) return { ...result, n, metrics, grade };
  }
  return null;
}
