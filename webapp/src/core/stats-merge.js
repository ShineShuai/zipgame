// Pure math for the stats page: validate and merge backend replies, percentiles from histogram bins, anomaly flags, rank correlation.
import { NB, T0_MS, RATIO, TOP_K, MIN_MS, MAX_MS, binOf } from './hist.js';
import { utcDateString } from '../features/daily.js';

const isInt = Number.isInteger, sum = xs => xs.reduce((a, x) => a + x, 0), byValue = (a, b) => a - b;

// Backend reply { days: [{ d, n, sum, bins: [[bin, n]...], best: [ms...] }] } -> [{ d, n, sum, bins: number[NB], best }], or null if malformed.
export function parseDays(r) {
  if (!r || !Array.isArray(r.days)) return null;
  const out = [];
  for (const x of r.days) {
    if (!x || !isInt(x.d) || !isInt(x.n) || x.n < 1 || !isInt(x.sum) || x.sum < 0 || !Array.isArray(x.bins) ||
        !Array.isArray(x.best) || x.best.length > TOP_K || !x.best.every(v => isInt(v) && v >= 0)) return null;
    const bins = new Array(NB).fill(0);
    for (const b of x.bins) {
      if (!Array.isArray(b) || !isInt(b[0]) || b[0] < 0 || b[0] >= NB || !isInt(b[1]) || b[1] < 1) return null;
      bins[b[0]] += b[1];
    }
    out.push({ d: x.d, n: x.n, sum: x.sum, bins, best: [...x.best].sort(byValue) });
  }
  return out;
}

// Adds up the per-backend day lists: n, sum and bins add, best = the TOP_K fastest of the union (exact, all four are mergeable).
export function mergeDays(lists) {
  const byDay = new Map();
  for (const day of lists.flat()) {
    const m = byDay.get(day.d);
    if (!m) { byDay.set(day.d, { ...day, bins: [...day.bins], best: [...day.best] }); continue; }
    m.n += day.n; m.sum += day.sum;
    day.bins.forEach((c, k) => { m.bins[k] += c; });
    m.best = m.best.concat(day.best).sort(byValue).slice(0, TOP_K);
  }
  return [...byDay.values()].sort((a, b) => a.d - b.d);
}

// Bin k covers [binLo(k), binHi(k)) ms: log-spaced, except bin 0 (everything below 1.1 s, down to MIN_MS) and bin NB-1 (overflow, up to MAX_MS).
export const binLo = k => (k === 0 ? MIN_MS : T0_MS * RATIO ** k);
export const binHi = k => (k === NB - 1 ? MAX_MS : T0_MS * RATIO ** (k + 1));

// q-quantile (0..1) in ms, interpolated geometrically inside the bin that holds it; null when there are no counts.
export function quantile(bins, q) {
  const total = sum(bins);
  if (!total) return null;
  const target = q * total; let acc = 0;
  for (let k = 0; k < NB; k++) {
    if (bins[k] && acc + bins[k] >= target) return binLo(k) * (binHi(k) / binLo(k)) ** ((target - acc) / bins[k]);
    acc += bins[k];
  }
  return binHi(NB - 1);
}

// Seconds: exact mean, top = mean of the TOP_K fastest (only when n > TOP_K, like hist.js summarize), p10/p50/p90 from the bins (~ +-5 %).
export function dayStats(day) {
  const at = q => { const v = quantile(day.bins, q); return v === null ? null : v / 1000; };
  return {
    d: day.d, n: day.n, mean: day.sum / day.n / 1000, p10: at(0.1), p50: at(0.5), p90: at(0.9),
    top: day.n > TOP_K && day.best.length === TOP_K ? sum(day.best) / TOP_K / 1000 : null,
    fastest: day.best.length ? day.best[0] / 1000 : null,
  };
}

// Anomaly flags for one day: { invariant, heuristic }. An invariant hit means a bug, a manual edit or a partial write;
// heuristics hint at bogus submits. `medianN` = median n over the range, for spike detection.
export function flagsOf(day, medianN = 0) {
  const invariant = [], heuristic = [], p50 = quantile(day.bins, 0.5);
  if (sum(day.bins) !== day.n) invariant.push('sum(bins) != n');
  if (day.best.length !== Math.min(day.n, TOP_K)) invariant.push('best count');
  if (day.best.length && binOf(day.best[0]) !== day.bins.findIndex(c => c > 0)) invariant.push('fastest not in lowest bin');
  if (day.sum < day.n * MIN_MS || day.sum > day.n * MAX_MS) invariant.push('sum out of range');
  if (day.n >= 10 && day.best.length && p50 && day.best[0] < p50 / 4) heuristic.push('fastest < median/4');
  if (day.n >= 10 && day.bins[0] / day.n > 0.2) heuristic.push('bin 0 > 20 %');
  if (medianN && day.n > 5 * medianN) heuristic.push('n > 5x median');
  return { invariant, heuristic };
}

export const median = xs => { const s = [...xs].sort(byValue), h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : 0; };

function ranks(xs) { // average ranks, ties share the mean rank
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]), r = new Array(xs.length);
  for (let i = 0, j; i < idx.length; i = j + 1) {
    for (j = i; j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]];) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
  }
  return r;
}
// Spearman rank correlation, or null with < 3 points or a constant series.
export function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const a = ranks(xs), b = ranks(ys), ma = sum(a) / a.length, mb = sum(b) / b.length;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : null;
}

// The last `count` UTC days ending at `now`, oldest first, as YYYYMMDD numbers.
export const dayList = (count, now = new Date()) => Array.from({ length: count }, (_, i) => +utcDateString(new Date(now.getTime() - (count - 1 - i) * 86400000)));
