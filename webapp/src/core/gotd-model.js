// Game-of-Day seed players: pure math, no I/O. Used by tools/gotd-fit.mjs and tools/gotd-seed.mjs.
//   1. fitCandidate / dedupe     map one difficulty metric to the human 0-5 scale (fit on tools/ratings.json), drop near-duplicates
//   2. selectEntries             which candidates become seed players of a day: top 3 + the next 7 without min and max = 3..8
//   3. withoutSeeds / fitTime    solve time of a puzzle from its grid size N and human-scale difficulty h, learned from the backends
import { MIN_MS, MAX_MS, binOf } from './hist.js';
import { spearman } from './stats-merge.js';

const sum = xs => xs.reduce((a, x) => a + x, 0);
export const clampH = h => Math.max(0, Math.min(5, h));

// ---------- 1. metric -> human scale ----------
export const TRANSFORMS = { id: v => v, log: v => Math.sign(v) * Math.log1p(Math.abs(v)) };
export const MIN_ROWS = 20;

// Weighted least squares y ~ a + b * x; a constant x gives the weighted mean.
export function wls(x, y, w = x.map(() => 1)) {
  const W = sum(w), mx = sum(x.map((v, i) => w[i] * v)) / W, my = sum(y.map((v, i) => w[i] * v)) / W;
  let sxx = 0, sxy = 0;
  x.forEach((v, i) => { sxx += w[i] * (v - mx) ** 2; sxy += w[i] * (v - mx) * (y[i] - my); });
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

// model = { kind: 'id' | 'log', a, b }  h = a + b * f(x)       or   { kind: 'bucket', table: { grade: mean rating }, fallback }
export const predictH = (m, x) => clampH(m.kind === 'bucket' ? (m.table[x] ?? m.fallback) : m.a + m.b * TRANSFORMS[m.kind](x));

// xs = metric values, ys = human ratings, ws = rating weights (rows where the metric is defined). The kind is chosen by leave-one-out
// weighted MAE of the clamped prediction: id / log, plus `bucket` (mean rating per grade) for integer grades.
// -> { model, mae, base, skill, rho, preds } or null with < MIN_ROWS rows or a constant metric. preds = the LOO predictions; base = the LOO MAE
// of always predicting the mean rating of the other rows; skill = 1 - mae / base, which compares candidates fitted on different row sets
// (a solver metric is fitted without the capped puzzles, whose ratings are higher and more spread out).
export function fitCandidate(xs, ys, ws, { bucket = false } = {}) {
  const n = xs.length, all = [...Array(n).keys()];
  if (n < MIN_ROWS || new Set(xs).size < 2) return null;
  const wmean = rows => sum(rows.map(i => ws[i] * ys[i])) / sum(rows.map(i => ws[i]));
  const fit = (kind, rows) => {
    if (kind !== 'bucket') return { kind, ...wls(rows.map(i => TRANSFORMS[kind](xs[i])), rows.map(i => ys[i]), rows.map(i => ws[i])) };
    const t = {};
    for (const i of rows) { const e = t[xs[i]] || (t[xs[i]] = [0, 0]); e[0] += ws[i] * ys[i]; e[1] += ws[i]; }
    return { kind, table: Object.fromEntries(Object.entries(t).map(([g, [s, w]]) => [g, s / w])), fallback: wmean(rows) };
  };
  let best = null;
  for (const kind of bucket ? [...Object.keys(TRANSFORMS), 'bucket'] : Object.keys(TRANSFORMS)) {
    const preds = all.map(i => predictH(fit(kind, all.filter(j => j !== i)), xs[i]));
    const mae = sum(all.map(i => ws[i] * Math.abs(preds[i] - ys[i]))) / sum(ws);
    if (!best || mae < best.mae) best = { kind, mae, preds };
  }
  const base = sum(all.map(i => ws[i] * Math.abs(wmean(all.filter(j => j !== i)) - ys[i]))) / sum(ws);
  return { model: fit(best.kind, all), mae: best.mae, base, skill: 1 - best.mae / base, rho: spearman(best.preds, ys), preds: best.preds };
}

// ranked = candidates best first; familyOf(id) = the metric a grade is derived from; corr(a, b) = |rank correlation| of two metrics.
// A candidate is dropped when a better one is from the same family or is almost the same ranking (>= limit).
export function dedupe(ranked, familyOf, corr, limit = 0.95) {
  const kept = [], dropped = [];
  for (const c of ranked) {
    const twin = kept.find(k => familyOf(k.id) === familyOf(c.id) || corr(k.id, c.id) >= limit);
    if (twin) dropped.push({ id: c.id, because: twin.id }); else kept.push(c);
  }
  return { kept, dropped };
}

// A grade metric's own grade -> human-scale map must not fall as the grade rises: "grade 3" claims to be harder than "grade 2".
export const isMonotone = m => (m.kind === 'bucket' ? Object.keys(m.table).sort((a, b) => a - b).every((g, i, ks) => !i || m.table[g] >= m.table[ks[i - 1]]) : m.b >= 0);

// ---------- 2. which candidates play ----------
export const TOP = 3, EXTRA = 7;
// A candidate behind the top 3 plays only with skill >= EXTRA_MIN_SKILL (skill: 1 - leave-one-out error / error of always guessing the mean rating).
// 0.10 is 1 to 1.5 bootstrap standard deviations of the skill (0.06-0.10 at 76 ratings, printed by gotd-fit.mjs): below that a candidate is hardly distinguishable from a constant.
export const EXTRA_MIN_SKILL = 0.1;
// ranked = candidates best first; hOf(id) = human-scale difficulty of THIS puzzle, undefined when the metric does not exist for it.
// The first TOP defined candidates always play; of the next EXTRA the lowest and the highest h are dropped (when there are >= 3).
// `badge` = { id, h }: the production grade (Play badge, unrounded). It always plays: when it is not among the TOP it takes the last of
// those places, so the count stays 3..8. Candidates behind the top places need `skill >= minSkill` (ranked[i].skill).
// -> { played, cut, weak } (all ordered by h except `weak`, which keeps the rank order)
//   played = [{ id, h, role: 'top' | 'extra' }]
//   cut    = [{ id, h, role: 'lowest' | 'highest' }]  extras dropped as the lowest / highest h of THIS puzzle (not of the skill ranking)
//   weak   = [{ id, skill }]                          candidates among the next EXTRA that are below minSkill
// Throws with fewer than TOP candidates.
export function pickEntries(ranked, hOf, badge = null, minSkill = 0) {
  const live = ranked
    .map(c => ({ id: c.id, skill: c.skill ?? Infinity, h: c.id === badge?.id ? badge.h : hOf(c.id) }))
    .filter(c => Number.isFinite(c.h));
  let top = live.slice(0, TOP);
  if (badge && !top.some(c => c.id === badge.id)) top = [...top.slice(0, TOP - 1), { id: badge.id, h: badge.h }];
  if (top.length < TOP) throw new Error(`only ${top.length} defined candidate(s), need ${TOP}`);

  const behind = live.filter(c => !top.some(t => t.id === c.id)).slice(0, EXTRA);
  const weak = behind.filter(c => c.skill < minSkill).map(c => ({ id: c.id, skill: c.skill }));
  const extra = behind.filter(c => c.skill >= minSkill).sort((a, b) => a.h - b.h);
  const trimmed = extra.length >= 3;
  const cut = trimmed ? [{ ...extra[0], role: 'lowest' }, { ...extra.at(-1), role: 'highest' }] : [];
  const kept = trimmed ? extra.slice(1, -1) : extra;
  const played = [...top.map(x => ({ ...x, role: 'top' })), ...kept.map(x => ({ ...x, role: 'extra' }))];
  return { played: played.sort((a, b) => a.h - b.h), cut, weak };
}
export const selectEntries = (ranked, hOf, badge = null, minSkill = 0) => pickEntries(ranked, hOf, badge, minSkill).played;

// ---------- 3. h, N -> solve time ----------
// Drawing the path alone takes time: the fastest play seen was 7.1 s on 36 cells (0.2 s per cell, a replay). A first solve of a puzzle with a
// non-zero grade needs thinking on top, so a time below FLOOR_S_PER_CELL * N^2 is a replay, not a first solve: it is left out of the calibration
// and no seed player is faster. Puzzles larger than 6x6 are never grade 0. 0.5 s per cell = drawing plus about as much again for thinking (a judgement).
export const FLOOR_S_PER_CELL = 0.5;
export const floorMs = n => Math.round(FLOOR_S_PER_CELL * 1000 * n * n);
export const needsThinking = (n, h) => n >= 7 || Math.round(h) >= 1;
// bins without the ones entirely below the floor (the bin that contains it stays): { bins, n, cut } with `cut` players dropped.
export function aboveFloor(bins, n) {
  const from = binOf(floorMs(n)), kept = bins.map((c, b) => (b < from ? 0 : c));
  return { bins: kept, n: sum(kept), cut: sum(bins) - sum(kept) };
}

// ln(median ms) = alpha + gamma * ln(N^2 / refN^2) + c * (h - refH), fitted as a Bayesian linear regression (Gaussian prior, known noise)
// so that a database with one or two days still gives a sane answer and the data takes over as days accumulate.
// The prior means are guesses, not measurements: alpha = 100 s at 7x7 / h 1.5 (141 s at h 2, 71 s at h 1; 60 s was too fast for a first solve), time proportional to the cell count (gamma 1), time doubling
// per grade (c = ln 2). They only matter until the backends have days with >= minReal real players; the first real day (6x6, 10 players, 8 of
// them 7-15 s = 0.2-0.4 s per cell, close to the drawing time alone) was not used for this: too few players, probably replays.
// Noise per observed day: tau (puzzle-to-puzzle scatter) plus the sampling error of a median of `count` players (1.25 sigma / sqrt(count)).
export const TIME_PRIOR = { refN: 7, refH: 1.5, mean: [Math.log(100000), 1, Math.LN2], sd: [1, 0.3, 0.25], tau: 0.3, sigma: 0.6, minReal: 20 };
const timeX = (n, h, P) => [1, Math.log((n * n) / (P.refN * P.refN)), h - P.refH];

export function invert(M) { // Gauss-Jordan with partial pivoting; M is small and positive definite here
  const k = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => +(i === j))]);
  for (let i = 0; i < k; i++) {
    let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i]; for (let c = 0; c < 2 * k; c++) A[i][c] /= d;
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; for (let c = 0; c < 2 * k; c++) A[r][c] -= f * A[i][c]; }
  }
  return A.map(r => r.slice(k));
}

// points = [{ n: grid size, h, y: ln(median ms), count: real players }] -> { mean: [alpha, gamma, c], sd: [..] (posterior), points }
export function fitTime(points, P = TIME_PRIOR) {
  const L = P.sd.map((s, i) => P.sd.map((_, j) => (i === j ? 1 / s ** 2 : 0))), b = P.mean.map((m, i) => m / P.sd[i] ** 2);
  for (const p of points) {
    const x = timeX(p.n, p.h, P), v = P.tau ** 2 + (1.25 * P.sigma) ** 2 / p.count;
    x.forEach((xi, i) => { b[i] += xi * p.y / v; x.forEach((xj, j) => { L[i][j] += xi * xj / v; }); });
  }
  const cov = invert(L);
  return { mean: cov.map(r => sum(r.map((c, j) => c * b[j]))), sd: cov.map((r, i) => Math.sqrt(r[i])), points: points.length };
}
export const predictMs = (model, n, h, P = TIME_PRIOR) => Math.min(MAX_MS, Math.max(MIN_MS, Math.round(Math.exp(sum(timeX(n, clampH(h), P).map((x, i) => x * model.mean[i]))))));

// A backend day (parseDays shape plus `seeds`) without its seed players: { d, n, sum, bins, best, seeds: [] } of the real players, or null when
// the seeds do not fit inside the aggregate (they were not written by us, or the day was edited by hand).
// `best` loses the seed times that were among the fastest, so it can hold fewer than TOP_K entries (the real 11th fastest is not stored).
export function withoutSeeds(day) {
  const seeds = day.seeds || [];
  const bins = [...day.bins];
  for (const ms of seeds) {
    bins[binOf(ms)] -= 1;
    if (bins[binOf(ms)] < 0) return null;
  }
  const n = day.n - seeds.length;
  const total = day.sum - sum(seeds);
  if (n < 0 || total < 0) return null;
  const best = [...(day.best || [])];
  for (const ms of seeds) {
    const at = best.indexOf(ms);
    if (at >= 0) best.splice(at, 1);
  }
  return { d: day.d, n, sum: total, bins, best, seeds: [] };
}
