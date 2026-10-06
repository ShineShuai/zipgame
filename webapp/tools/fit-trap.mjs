// Fit / evaluate the trap grade against hand ratings.
//   node tools/fit-trap.mjs [tools/ratings.json] [--features trapMax,trapTop3,altFrac,lTr] [--lambda 10] [--cuts anchors|fit|round]
//                           [--anchor-weight 3] [--ladder-work-cap N] [--cap 1000000] [--write]
// Grade = the ridge score cut at TRAP_MODEL.cuts. --cuts anchors (default) fits only the 0|1 and 3|4 boundaries and spaces
// the others evenly (2 parameters, least overfit); fit = all five free (more anchor hits, but the 4|5 cut is overfit);
// round = the old round(score). The cuts are fitted on the training part of every leave-one-out fold too, so the printed
// leave-one-out grades are honest about them. Anchor ratings (human <= 0.5 or >= 3.5) count --anchor-weight times in the
// cut fit (not in the ridge): they are the ratings trusted most.
// ratings.json (default: tools/ratings.json): [{ "key": "<puzzle text>", "human": 0..5, "lo": .., "hi": .. }, ...] — exactly what the
// design app's "Export ratings.json" button writes (see src/core/ratings-io.js for the format).
// Prints leave-one-out (LOO) accuracy for the trap grade vs. the shipped grades, then the TRAP_MODEL
// literal. With --write it replaces the <TRAP_MODEL>..</TRAP_MODEL> block in src/core/trap.js in place (weights + fit
// metadata that the design panel displays); without it, it only prints the block. LOO is optimistic if the feature set
// was chosen on the same data.
import fs from 'node:fs';
import { parse } from '../src/core/format.js';
import { trapMetrics, TRAP_CFG, capGradeBySize } from '../src/core/trap.js';
import { gradesFor } from '../src/core/grades.js';
import { ratingWeight, UNSURE_WEIGHT } from '../src/core/ratings-io.js';
import { evalCap } from './lib.mjs';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const VALUE_OPTS = ['features', 'lambda', 'cap', 'cuts', 'anchor-weight', 'ladder-work-cap'].map(k => opt(k));
const file = args.find(a => !a.startsWith('--') && !VALUE_OPTS.includes(a)) || new URL('./ratings.json', import.meta.url).pathname;
const features = opt('features', 'trapMax,trapTop3,altFrac,lTr').split(',');
const lambda = +opt('lambda', 10);
const CUTS_MODE = opt('cuts', 'anchors'), ANCHOR_W = +opt('anchor-weight', 3);
if (!['anchors', 'fit', 'round'].includes(CUTS_MODE)) { console.error('--cuts must be anchors, fit or round'); process.exit(1); }
const WORKCAP = +opt('ladder-work-cap', TRAP_CFG.ladderWorkCap);
if (WRITE && WORKCAP !== TRAP_CFG.ladderWorkCap) { console.error(`--write needs the production --ladder-work-cap (${TRAP_CFG.ladderWorkCap}): lTr depends on it`); process.exit(1); }
const CFG = { ...TRAP_CFG, ladderWorkCap: WORKCAP };
const CAP = evalCap(args);

const rows = JSON.parse(fs.readFileSync(file, 'utf8')).map(e => {
  const p = parse(e.key), t = trapMetrics(p, CFG);
  if (!t.ok) return null;
  const g = gradesFor(p, CAP);
  return { human: e.human, n: p.n, w: ratingWeight(e), t, shipped: g ? g.grades.decisionNodes : 5, combined: g ? g.grades.combined : 5 };
}).filter(Boolean);
const H = rows.map(r => r.human), W = rows.map(r => r.w), n = rows.length;
const nUnsure = rows.filter(r => r.w < 1).length;

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const wmean = (a, w) => a.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((s, v) => s + v, 0);
const wsd = (a, w) => { const m = wmean(a, w); return Math.sqrt(wmean(a.map(v => (v - m) ** 2), w)) || 1; };
const stats = Object.fromEntries(features.map(k => { const c = rows.map(r => r.t[k]); return [k, { mean: wmean(c, W), sd: wsd(c, W) }]; }));
const design = r => [1, ...features.map(k => (r.t[k] - stats[k].mean) / stats[k].sd)];

// ridge (intercept unpenalised), Gaussian elimination
// Weighted ridge (intercept unpenalised): row i counts w[i] times — 1 for a sure rating, UNSURE_WEIGHT for an unsure one.
function ridge(X, y, lam, w = y.map(() => 1)) {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  X.forEach((x, i) => { for (let a = 0; a < p; a++) { b[a] += w[i] * x[a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += w[i] * x[a] * x[c]; } });
  for (let a = 1; a < p; a++) A[a][a] += lam;
  for (let i = 0; i < p; i++) {
    let m = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < p; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < p; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const coef = new Array(p);
  for (let i = p - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < p; c++) s -= A[i][c] * coef[c]; coef[i] = s / A[i][i]; }
  return coef;
}
const dot = (x, w) => x.reduce((s, v, i) => s + v * w[i], 0);

const X = rows.map(design);

// ---- cutpoints: the score thresholds between grades 0|1 .. 4|5 (grade = how many a score has reached)
const isAnchor = h => h <= 0.5 || h >= 3.5;
const gradeAt = (pred, cuts) => cuts.filter(c => pred >= c).length;
function quantile(sorted, q) { const x = q * (sorted.length - 1), lo = Math.floor(x), hi = Math.ceil(x); return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo); }
function fitCuts(pred, h, wt, mode) {
  if (mode === 'round') return [0.5, 1.5, 2.5, 3.5, 4.5];
  const sorted = [...pred].sort((a, b) => a - b);
  const cand = [...new Set(Array.from({ length: 60 }, (_, i) => quantile(sorted, 0.02 + 0.96 * i / 59)))];
  const cost = c => pred.reduce((s, v, i) => s + wt[i] * Math.abs(gradeAt(v, c) - h[i]), 0);
  if (mode === 'anchors') { // only the 0|1 and 3|4 boundaries are free; 1|2 and 2|3 sit evenly between them, 4|5 one step above
    let best = [Infinity, null];
    for (const a of cand) for (const b of cand) {
      if (b <= a) continue;
      const st = (b - a) / 3, c = [a, a + st, a + 2 * st, b, b + st], k = cost(c);
      if (k < best[0]) best = [k, c];
    }
    return best[1];
  }
  let cuts = [0.1, 0.4, 0.7, 0.85, 0.95].map(q => quantile(sorted, q)), best = cost(cuts); // 'fit': coordinate descent, all five free
  for (let it = 0; it < 4; it++) for (let j = 0; j < 5; j++) {
    const lo = j ? cuts[j - 1] : -Infinity, hi = j < 4 ? cuts[j + 1] : Infinity;
    for (const v of cand) { if (!(lo < v && v < hi)) continue; const c = cuts.slice(); c[j] = v; const k = cost(c); if (k < best - 1e-9) { best = k; cuts = c; } }
  }
  return cuts;
}
const cutWeights = (h, wt) => h.map((v, i) => wt[i] * (isAnchor(v) ? ANCHOR_W : 1));
const ridgeFit = (idx) => ridge(idx.map(j => X[j]), idx.map(j => H[j]), lambda, idx.map(j => W[j]));
const loo = [], looGrade = [];
rows.forEach((r, i) => {
  const idx = rows.map((_, j) => j).filter(j => j !== i), co = ridgeFit(idx);
  const trainPred = idx.map(j => dot(X[j], co)), h = idx.map(j => H[j]);
  const cuts = fitCuts(trainPred, h, cutWeights(h, idx.map(j => W[j])), CUTS_MODE);
  loo.push(dot(X[i], co));
  looGrade.push(capGradeBySize(gradeAt(loo[i], cuts), r.n));
});

function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }
const spearman = (x, y) => pearson(rank(x), rank(y));
const report = (name, pred, grades = pred.map(v => Math.max(0, Math.min(5, Math.round(v))))) => {
  const g = grades, err = g.map((v, i) => v - H[i]);
  report.last = { rho: spearman(pred, H), mae: mean(err.map(Math.abs)) };
  console.log(name.padEnd(28), 'rho', (Number.isFinite(spearman(pred, H)) ? spearman(pred, H).toFixed(2) : '  —').padStart(5), '| MAE', mean(err.map(Math.abs)).toFixed(2), '| within 1:', (100 * err.filter(e => Math.abs(e) <= 1).length / n).toFixed(0) + '%', '| bias', mean(err).toFixed(2));
};
console.log(`n=${n} rated puzzles (${nUnsure} unsure, counted at weight ${UNSURE_WEIGHT}), features=${features.join(',')}, lambda=${lambda}`);
report('predict-median baseline', H.map(() => H.slice().sort((a, b) => a - b)[n >> 1]));
report('shipped decisionNodes', rows.map(r => r.shipped));
report('shipped combined', rows.map(r => r.combined));
for (const k of features) console.log(`single: ${k}`.padEnd(28), 'rho', spearman(rows.map(r => r.t[k]), H).toFixed(2).padStart(5));
report('trap grade, rounded (LOO)', loo);
report(`trap grade, cuts=${CUTS_MODE} (LOO)`, loo, looGrade);

const looStats = report.last; // the cut-based line above
// Anchor hits: the easy and hard ratings the badge must get right (the app showed 0 of 17 easy as 0, no hard as 4+ before the cuts).
const easy = rows.map((r, i) => r.human <= 0.5 ? i : -1).filter(i => i >= 0), hard = rows.map((r, i) => r.human >= 3.5 ? i : -1).filter(i => i >= 0);
const looAnchors = { easy: [easy.filter(i => looGrade[i] === 0).length, easy.length], hard3: [hard.filter(i => looGrade[i] >= 3).length, hard.length], hard4: [hard.filter(i => looGrade[i] >= 4).length, hard.length] };
console.log(`anchor hits (LOO): rated <= 0.5 -> badge 0: ${looAnchors.easy.join('/')} | rated >= 3.5 -> badge >= 3: ${looAnchors.hard3.join('/')}, >= 4: ${looAnchors.hard4.join('/')}`);
console.log('badges produced (LOO), grades 0..5:', [0, 1, 2, 3, 4, 5].map(g => looGrade.filter(v => v === g).length).join(' / '));
const w = ridge(X, H, lambda, W);
const finalPred = X.map(x => dot(x, w));
const cuts = fitCuts(finalPred, H, cutWeights(H, W), CUTS_MODE).map(c => +c.toFixed(4));
const obj = (m) => '{ ' + features.map(k => `${k}: ${m[k]}`).join(', ') + ' }';
const block = `// <TRAP_MODEL>
export const TRAP_MODEL = {
  features: [${features.map(k => `'${k}'`).join(', ')}],
  mean: ${obj(Object.fromEntries(features.map(k => [k, +stats[k].mean.toFixed(4)])))},
  sd: ${obj(Object.fromEntries(features.map(k => [k, +stats[k].sd.toFixed(4)])))},
  w: ${obj(Object.fromEntries(features.map((k, i) => [k, +w[i + 1].toFixed(4)])))},
  b: ${+w[0].toFixed(4)},
  cuts: [${cuts.join(', ')}],
  fit: { n: ${n}, lambda: ${lambda}, looRho: ${+looStats.rho.toFixed(2)}, looMae: ${+looStats.mae.toFixed(2)}, cuts: '${CUTS_MODE}', looAnchors: { easy: [${looAnchors.easy}], hard3: [${looAnchors.hard3}], hard4: [${looAnchors.hard4}] } },
};
// </TRAP_MODEL>`;
if (WRITE) {
  const target = new URL('../src/core/trap.js', import.meta.url);
  const src = fs.readFileSync(target, 'utf8');
  const re = /\/\/ <TRAP_MODEL>[\s\S]*?\/\/ <\/TRAP_MODEL>/;
  if (!re.test(src)) { console.error('markers // <TRAP_MODEL> ... // </TRAP_MODEL> not found in src/core/trap.js'); process.exit(1); }
  fs.writeFileSync(target, src.replace(re, () => block));
  console.log('\nwrote TRAP_MODEL to src/core/trap.js (n=' + n + ', LOO rho ' + looStats.rho.toFixed(2) + ', MAE ' + looStats.mae.toFixed(2) + ')');
} else {
  console.log('\nPaste into src/core/trap.js (or rerun with --write):\n' + block);
}
