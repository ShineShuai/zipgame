#!/usr/bin/env node
// Score EVERY difficulty metric in the code base against hand ratings, then compare whole grading models with
// leave-one-out (LOO) cross-validation, so "which is best" is answered on puzzles the model did not see.
//   node tools/metrics-eval.mjs [tools/ratings.json] [--split 43] [--csv features.csv]
// ratings JSON: [{ key: puzzle text, human, lo?, hi? }] (lo/hi = the range you stated, e.g. "2 or 3" -> 2,3; used for
// the "in range" score; without them a rating counts as the single value `human`).
// Part 1  one row per metric: Spearman rho vs human, 95% bootstrap CI, and rho after removing puzzle size (rank residuals).
// Part 2  grading models: existing grades as shipped, and ridge models refit inside every LOO fold.
//         "forward-select (nested)" also picks its features inside each fold, so its score includes the cost of choosing.
// Part 3  chronological holdout: models fit on the first --split puzzles (default 43 = the labels ladder.js was designed on),
//         scored on the rest — the fairest test for the fixed-formula ladder grade.
// Part 4  the ladder grade's own constants (wideFrac threshold, probe-trials cutoff, size floors): sweep + nested re-tuning.
// Scores: rho = Spearman; in-range = grade lies in [lo,hi]; MAE = mean |grade - human|; 0->0 = human-0 puzzles graded 0.
import fs from 'node:fs';
import { parse } from '../src/core/format.js';
import { fullDiagnostics } from '../src/core/difficulty.js';
import { spatialMetrics } from '../src/core/spatial.js';
import { gradesFor } from '../src/core/grades.js';
import { trapMetrics } from '../src/core/trap.js';
import { ladder, wideFrac, grade as ladderGrade } from '../src/core/ladder.js';
import { maxNumber } from '../src/core/model.js';

const args = process.argv.slice(2);
const file = args.find(a => a.endsWith('.json')) || new URL('./ratings.json', import.meta.url).pathname;
const csvOut = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const SPLIT = args.includes('--split') ? +args[args.indexOf('--split') + 1] : 43;
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
const n = R.length, H = R.map(r => r.human), LO = R.map(r => r.lo ?? r.human), HI = R.map(r => r.hi ?? r.human);

// ---------- 1. every metric, per puzzle ----------
// group: struct = puzzle shape only, legacy = solver cost (difficulty.js), spatial = checkpoint geometry (spatial.js),
//        grade = an existing 0-5 grade as shipped, trap = core/trap.js, ladder = core/ladder.js.
// log: count-like features are log-scaled before entering a ridge model (Spearman does not care).
const DEFS = [
  ['n', 'struct'], ['K', 'struct'], ['walls/T', 'struct'], ['K/T', 'struct'], ['segLen', 'struct'], ['turns/T', 'struct'],
  ['decisionNodes/cell', 'legacy', 1], ['B/N', 'legacy'], ['maxDecisionDepth', 'legacy'], ['naiveGap', 'legacy', 1], ['firstGap', 'legacy', 1], ['regression', 'legacy'], ['nodes/cell', 'legacy', 1], ['legCollide', 'legacy'],
  ['crossPerSeg', 'spatial'], ['overlapPerSeg', 'spatial'],
  ['grade:decisionNodes', 'grade'], ['grade:B', 'grade'], ['grade:cross', 'grade'], ['grade:combined', 'grade'],
  ['trapMax', 'trap'], ['trapTop3', 'trap'], ['trapDeep', 'trap'], ['altFrac', 'trap'], ['alts/T', 'trap'], ['trapPredicted', 'trap'], ['grade:trap', 'trap'],
  ['ladHardest', 'ladder'], ['ladChain', 'ladder', 1], ['ladTerr', 'ladder', 1], ['ladProbe1', 'ladder', 1], ['ladProbe2', 'ladder', 1], ['ladSearch', 'ladder', 1], ['ladTrials', 'ladder', 1], ['wideFrac', 'ladder'], ['grade:ladder', 'ladder'],
];
const NAMES = DEFS.map(d => d[0]), GROUP = Object.fromEntries(DEFS.map(d => [d[0], d[1]])), LOG = new Set(DEFS.filter(d => d[2]).map(d => d[0]));
const t0 = Date.now();
const F = R.map(r => {
  const p = parse(r.key), T = p.n * p.n, K = maxNumber(p), d = fullDiagnostics(p), sp = spatialMetrics(p), g = gradesFor(p), tr = trapMetrics(p), L = ladder(p);
  const walls = p.walls.reduce((a, w) => a + (w & 1) + ((w >> 1) & 1), 0);
  let turns = 0; if (tr.ok) for (let i = 2; i < tr.path.length; i++) if (tr.path[i] - tr.path[i - 1] !== tr.path[i - 1] - tr.path[i - 2]) turns++;
  const wf = L.solved && L.path ? wideFrac(p, L.path).frac : 0, lg = ladderGrade(p, L).grade;
  return {
    n: p.n, K, 'walls/T': walls / T, 'K/T': K / T, segLen: (T - 1) / Math.max(1, K - 1), 'turns/T': turns / T,
    'decisionNodes/cell': d.decisionNodes / T, 'B/N': d.B / p.n, maxDecisionDepth: d.maxDecisionDepth, naiveGap: d.naiveGap, firstGap: d.firstGap, regression: d.regression, 'nodes/cell': d.nodes / T, legCollide: d.legCollideDependent ? 1 : 0,
    crossPerSeg: sp.crossPerSeg, overlapPerSeg: sp.overlapPerSeg,
    'grade:decisionNodes': g ? g.grades.decisionNodes : 5, 'grade:B': g ? g.grades.B : 5, 'grade:cross': g ? g.grades.crossPerSeg : 5, 'grade:combined': g ? g.grades.combined : 5,
    trapMax: tr.trapMax, trapTop3: tr.trapTop3, trapDeep: tr.trapDeep, altFrac: tr.altFrac, 'alts/T': tr.alternatives / T, trapPredicted: tr.predicted, 'grade:trap': tr.grade,
    ladHardest: L.hardest ?? 0, ladChain: L.passes?.[2] ?? 0, ladTerr: L.passes?.[3] ?? 0, ladProbe1: L.passes?.[4] ?? 0, ladProbe2: L.passes?.[5] ?? 0, ladSearch: L.search?.nodes ?? 0, ladTrials: L.probeTrials ?? 0, wideFrac: wf, 'grade:ladder': lg,
    _capped: d.exceeded ? 1 : 0, _ladBad: L.exceeded || L.contradiction ? 1 : 0, _ladSolved: L.solved && L.path ? 1 : 0,
  };
});
console.log(`${n} rated puzzles, all metrics computed in ${((Date.now() - t0) / 1000).toFixed(1)}s (${F.filter(f => f._capped).length} hit the reference-solve cap; their solver metrics are lower bounds and their grades count as 5)`);
if (csvOut) fs.writeFileSync(csvOut, ['human', 'lo', 'hi', ...NAMES].join(',') + '\n' + F.map((f, i) => [H[i], LO[i], HI[i], ...NAMES.map(k => f[k])].join(',')).join('\n'));

// ---------- stats helpers ----------
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) || 1; };
function rank(a) { const ix = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; let i = 0; while (i < ix.length) { let j = i; while (j + 1 < ix.length && ix[j + 1][0] === ix[i][0]) j++; for (let k = i; k <= j; k++) r[ix[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b && c ? a / Math.sqrt(b * c) : NaN; }
const spearman = (x, y) => pearson(rank(x), rank(y));
const resid = (y, x) => { const b = pearson(x, y) * sd(y) / sd(x), a = mean(y) - b * mean(x); return y.map((v, i) => v - a - b * x[i]); };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const col = k => F.map(f => f[k]);
const dist = (g, i) => g < LO[i] ? LO[i] - g : g > HI[i] ? g - HI[i] : 0;
const clampGrade = p => Math.max(0, Math.min(5, Math.round(p)));

// ---------- Part 1: per-metric table ----------
const rn = rank(col('n')), rH = rank(H);
const rows = NAMES.map(k => {
  const x = col(k), rho = spearman(x, H), rx = rank(x);
  const boots = []; for (let b = 0; b < 1000; b++) { const ii = Array.from({ length: n }, () => (rnd() * n) | 0); const v = spearman(ii.map(i => x[i]), ii.map(i => H[i])); if (Number.isFinite(v)) boots.push(v); }
  boots.sort((a, b) => a - b);
  return { k, rho, lo: boots[Math.floor(boots.length * .025)], hi: boots[Math.floor(boots.length * .975)], partial: pearson(resid(rx, rn), resid(rH, rn)) };
}).sort((a, b) => (Number.isFinite(b.rho) ? Math.abs(b.rho) : -1) - (Number.isFinite(a.rho) ? Math.abs(a.rho) : -1));
console.log('\n== Part 1: every metric vs hand rating (Spearman, n=' + n + ') ==');
console.log('metric'.padEnd(20), 'group'.padEnd(8), '   rho', '   95% CI (bootstrap)', '  rho|size');
for (const r of rows) console.log(r.k.padEnd(20), GROUP[r.k].padEnd(8), (Number.isFinite(r.rho) ? r.rho.toFixed(2) : '  —').padStart(6), ('[' + r.lo?.toFixed(2) + ', ' + r.hi?.toFixed(2) + ']').padStart(20), (Number.isFinite(r.partial) ? r.partial.toFixed(2) : '—').padStart(9));

// ---------- Part 2: models, LOO ----------
const feat = (k, i) => LOG.has(k) ? Math.log2(1 + F[i][k]) : F[i][k];
function ridgeFit(keys, idx, lam) {
  const p = keys.length + 1, mu = keys.map(k => mean(idx.map(j => feat(k, j)))), s = keys.map(k => sd(idx.map(j => feat(k, j))));
  const row = j => [1, ...keys.map((k, a) => (feat(k, j) - mu[a]) / s[a])];
  const M = Array.from({ length: p }, (_, i) => [...Array(p).fill(0), ...Array.from({ length: p }, (_, c) => (c === i ? 1 : 0))]), b = Array(p).fill(0), R2 = idx.map(row);
  R2.forEach((x, t) => { for (let a = 0; a < p; a++) { b[a] += x[a] * H[idx[t]]; for (let c = 0; c < p; c++) M[a][c] += x[a] * x[c]; } });
  for (let a = 1; a < p; a++) M[a][a] += lam;
  for (let i = 0; i < p; i++) { let m = i; for (let r = i + 1; r < p; r++) if (Math.abs(M[r][i]) > Math.abs(M[m][i])) m = r; [M[i], M[m]] = [M[m], M[i]]; const dv = M[i][i]; for (let c = 0; c < 2 * p; c++) M[i][c] /= dv; for (let r = 0; r < p; r++) if (r !== i) { const f = M[r][i]; for (let c = 0; c < 2 * p; c++) M[r][c] -= f * M[i][c]; } }
  const Ainv = M.map(r => r.slice(p)), w = Ainv.map(r => r.reduce((s2, v, c) => s2 + v * b[c], 0));
  return { w, Ainv, row, R2 };
}
const predict = (m, j) => m.row(j).reduce((s, v, c) => s + v * m.w[c], 0);
function innerLoss(keys, idx, lam) { // closed-form LOO loss (interval distance + small MAE term), used only to choose features inside a fold
  const m = ridgeFit(keys, idx, lam); let s = 0;
  m.R2.forEach((x, t) => { const pr = x.reduce((a, v, c) => a + v * m.w[c], 0), h = x.reduce((a, v, r) => a + v * m.Ainv[r].reduce((q, e, c) => q + e * x[c], 0), 0), loo = H[idx[t]] - (H[idx[t]] - pr) / (1 - h); s += dist(loo, idx[t]) + 0.01 * Math.abs(loo - H[idx[t]]); });
  return s / idx.length;
}
const all = [...Array(n).keys()], LAM = 10;
const POOL = NAMES.filter(k => !k.startsWith('grade:') && k !== 'trapPredicted' && k !== 'regression' && GROUP[k] !== 'struct' || k === 'n' || k === 'K/T' || k === 'turns/T' || k === 'segLen');
function forward(idx, maxK = 4) {
  let chosen = [], best = mean(idx.map(i => dist(mean(idx.map(j => H[j])), i)));
  for (let step = 0; step < maxK; step++) {
    let pick = null;
    for (const k of POOL) { if (chosen.includes(k)) continue; const l = innerLoss([...chosen, k], idx, LAM); if (l < best - 0.005) { best = l; pick = k; } }
    if (!pick) break; chosen.push(pick);
  }
  return chosen;
}
const looModel = keys => all.map(i => predict(ridgeFit(keys, all.filter(j => j !== i), LAM), i));
const picks = [];
const looForward = all.map(i => { const tr = all.filter(j => j !== i), ks = forward(tr); picks.push(ks); return ks.length ? predict(ridgeFit(ks, tr, LAM), i) : mean(tr.map(j => H[j])); });

function score(name, pred, integer = false, idx = all) {
  const g = integer ? pred : pred.map(clampGrade), zero = idx.filter(i => HI[i] === 0), rho = spearman(idx.map(i => pred[i]), idx.map(i => H[i]));
  console.log(name.padEnd(46), (Number.isFinite(rho) && Math.abs(rho) < 0.999 ? rho.toFixed(2) : '—').padStart(5), ((100 * mean(idx.map(i => +(dist(g[i], i) === 0)))).toFixed(0) + '%').padStart(9), mean(idx.map(i => Math.abs(g[i] - H[i]))).toFixed(2).padStart(6), mean(idx.map(i => dist(g[i], i))).toFixed(2).padStart(9), (zero.filter(i => g[i] === 0).length + '/' + zero.length).padStart(6), '  ' + [0, 1, 2, 3, 4, 5].map(k => idx.filter(i => g[i] === k).length).join(' '));
}
console.log('\n== Part 2: grading models (LOO: a puzzle is never scored by a model that saw it) ==');
console.log('model'.padEnd(46), '  rho', ' in-range', '   MAE', ' dist-to-range', ' 0->0', '  grades 0..5 used');
score('constant (training mean)', all.map(i => mean(all.filter(j => j !== i).map(j => H[j]))));
console.log('   (rho of a constant is undefined, shown —)');
console.log('-- existing grades exactly as shipped (nothing refit; capped puzzles count as 5) --');
for (const k of ['grade:decisionNodes', 'grade:B', 'grade:cross', 'grade:combined', 'grade:ladder']) score(k.replace('grade:', 'shipped ') + (k === 'grade:ladder' ? ' (fixed formula)' : ''), col(k), true);
score('shipped trap grade (weights fit on ALL 70: optimistic)', col('trapPredicted'));
console.log('-- ridge, refit inside every fold (lambda ' + LAM + ') --');
const SETS = {
  'trap (shipped features)': ['trapMax', 'trapTop3', 'altFrac'],
  'trap + wideFrac': ['trapMax', 'trapTop3', 'altFrac', 'wideFrac'],
  'trap + ladTrials': ['trapMax', 'trapTop3', 'altFrac', 'ladTrials'],
  'trap + wideFrac + ladTrials': ['trapMax', 'trapTop3', 'altFrac', 'wideFrac', 'ladTrials'],
  'trap + wideFrac + ladTrials + n': ['trapMax', 'trapTop3', 'altFrac', 'wideFrac', 'ladTrials', 'n'],
  'wideFrac + ladTrials + altFrac': ['wideFrac', 'ladTrials', 'altFrac'],
  'ladder only (wideFrac, trials, probe2)': ['wideFrac', 'ladTrials', 'ladProbe2'],
  'legacy only (decisionNodes, B/N, cross)': ['decisionNodes/cell', 'B/N', 'crossPerSeg'],
};
const results = {};
for (const [name, keys] of Object.entries(SETS)) { results[name] = looModel(keys); score(name, results[name]); }
score('forward-select from all metrics (nested)', looForward);
const cnt = {}; picks.forEach(ks => ks.forEach(k => cnt[k] = (cnt[k] || 0) + 1));
console.log('   features chosen across the ' + n + ' folds: ' + Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(', '));
const fin = forward(all);
console.log('   forward selection on all ' + n + ' puzzles picks: ' + (fin.join(', ') || '(none)'));


// ---------- Part 3: chronological holdout ----------
if (SPLIT > 0 && SPLIT < n - 4) {
  const tr = all.slice(0, SPLIT), te = all.slice(SPLIT);
  console.log(`\n== Part 3: fit on the first ${SPLIT} puzzles, score the last ${te.length} (ratings were added over time, so this is also a check against drift) ==`);
  console.log('model'.padEnd(46), '  rho', ' in-range', '   MAE', ' dist-to-range', ' 0->0', '  grades 0..5 used');
  score('constant (mean of first ' + SPLIT + ')', all.map(() => mean(tr.map(j => H[j]))), false, te);
  score('ladder grade (fixed formula, no fitting)', col('grade:ladder'), true, te);
  score('shipped trap grade (weights saw all ' + n + ': optimistic)', col('trapPredicted'), false, te);
  for (const [name, keys] of [['trap ridge', SETS['trap (shipped features)']], ['trap + ladProbe2 ridge', ['trapMax', 'trapTop3', 'altFrac', 'ladProbe2']]]) {
    const m = ridgeFit(keys, tr, LAM), pr = all.map(i => (te.includes(i) ? predict(m, i) : NaN));
    score(name + ' fit on first ' + SPLIT, pr, false, te);
  }
  for (const k of ['grade:decisionNodes', 'grade:combined']) score(k.replace('grade:', 'shipped ') + ' (calibrated on generated puzzles)', col(k), true, te);
  console.log(`   mean rating: first ${SPLIT} = ${mean(tr.map(j => H[j])).toFixed(2)}, last ${te.length} = ${mean(te.map(j => H[j])).toFixed(2)}  (a big gap means a fitted model regresses toward the wrong mean)`);
}

// ---------- Part 4: the ladder grade's own constants ----------
// Mirror of ladder.js grade(); constants pulled out so they can be swept. Checked against the real function below.
const SHIPPED = { tWf: 0.15, tTrials: 3500, floors: true, gateLo: 4 };
const ladMirror = (f, c) => {
  if (f._ladBad) return 5;
  if (c.floors && f.n <= 5) return 0;
  if (c.floors && f.n === 6) return 1;
  if (f.ladHardest >= 5) return f.ladTrials >= c.tTrials ? 5 : c.gateLo;
  if (!f._ladSolved) return 2;
  return f.wideFrac > c.tWf ? 2 : 1;
};
const ladCol = c => F.map(f => ladMirror(f, c));
const drift = all.filter(i => ladCol(SHIPPED)[i] !== F[i]['grade:ladder']).length;
console.log('\n== Part 4: ladder.js grade() constants ==');
if (drift) console.log(`   WARNING: my mirror of grade() disagrees with ladder.js on ${drift} puzzles - ladder.js changed, update ladMirror in this file before trusting Part 4.`);
const lossOf = (g, idx) => mean(idx.map(i => dist(g[i], i) + 0.01 * Math.abs(g[i] - H[i])));
const line = (label, g) => console.log('  ' + label.padEnd(30), 'in-range', ((100 * mean(all.map(i => +(dist(g[i], i) === 0)))).toFixed(0) + '%').padStart(4), ' MAE', mean(all.map(i => Math.abs(g[i] - H[i]))).toFixed(2), ' grade-5 count', g.filter(v => v === 5).length);
console.log('wideFrac threshold (shipped ' + SHIPPED.tWf + '): a plateau, not a peak, is what you want to see');
for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.3]) line('tWf = ' + t.toFixed(2), ladCol({ ...SHIPPED, tWf: t }));
console.log('probe-trials cutoff for grade 5 (shipped ' + SHIPPED.tTrials + ')');
for (const t of [1000, 2000, 3500, 6000, 1e9]) line('tTrials = ' + (t >= 1e9 ? 'never' : t), ladCol({ ...SHIPPED, tTrials: t }));
line('no size floors', ladCol({ ...SHIPPED, floors: false }));
const G = []; for (const tWf of [0.05, 0.1, 0.15, 0.2, 0.25]) for (const tTrials of [1000, 2000, 3500, 6000]) for (const floors of [true, false]) G.push({ ...SHIPPED, tWf, tTrials, floors });
const gcols = G.map(ladCol), chosen = [], nestedG = all.map(i => {
  const trn = all.filter(j => j !== i); let best = 0, bl = Infinity;
  gcols.forEach((g, gi) => { const l = lossOf(g, trn); if (l < bl - 1e-9) { bl = l; best = gi; } });
  chosen.push(best); return gcols[best][i];
});
console.log('nested re-tuning (constants chosen without the scored puzzle):');
line('shipped constants', ladCol(SHIPPED)); line('re-tuned in every fold', nestedG);
const cc = {}; chosen.forEach(gi => { const k = `tWf ${G[gi].tWf}, tTrials ${G[gi].tTrials}, floors ${G[gi].floors}`; cc[k] = (cc[k] || 0) + 1; });
console.log('   chosen: ' + Object.entries(cc).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} (${c}/${n} folds)`).join('; '));
const gate = all.filter(i => F[i].ladHardest >= 5);
console.log(`probe2 gate: ${gate.length} puzzles need nested guessing; human ratings of those: ${gate.map(i => H[i]).join(', ')}  (mean ${mean(gate.map(i => H[i])).toFixed(2)}; ${gate.filter(i => H[i] <= 2).length} rated <= 2 = gate false positives)`);

console.log('\nreading guide: in-range and dist-to-range respect the range you gave; MAE compares to the midpoint. A model is only better than another if it wins by more than the noise (~+-0.10 rho, ~+-6% in-range at n=' + n + ').');
