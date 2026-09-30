// Fit / evaluate the trap grade against hand ratings.
//   node tools/fit-trap.mjs ratings.json [--features trapMax,trapTop3,altFrac] [--lambda 10] [--write]
// ratings.json: [{ "key": "<puzzle text, format.js>", "human": 0..5 }, ...] — the same shape as the design
// app's rating log, so paste it straight from the browser console:
//   copy(localStorage.getItem('zip-difficulty-rating-log-v1'))
// Prints leave-one-out (LOO) accuracy for the trap grade vs. the shipped grades, then the TRAP_MODEL
// literal. With --write it replaces the <TRAP_MODEL>..</TRAP_MODEL> block in src/core/trap.js in place (weights + fit
// metadata that the design panel displays); without it, it only prints the block. LOO is optimistic if the feature set
// was chosen on the same data.
import fs from 'node:fs';
import { parse } from '../src/core/format.js';
import { trapMetrics, trapGradeOf } from '../src/core/trap.js';
import { gradesFor } from '../src/core/grades.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const file = args.find(a => !a.startsWith('--') && a !== opt('features') && a !== opt('lambda'));
if (!file) { console.error('usage: node tools/fit-trap.mjs ratings.json [--features a,b,c] [--lambda 3]'); process.exit(1); }
const features = opt('features', 'trapMax,trapTop3,altFrac').split(',');
const lambda = +opt('lambda', 10);

const rows = JSON.parse(fs.readFileSync(file, 'utf8')).map(e => {
  const p = parse(e.key), t = trapMetrics(p);
  if (!t.ok) return null;
  const g = gradesFor(p);
  return { human: e.human, t, shipped: g ? g.grades.decisionNodes : 5, combined: g ? g.grades.combined : 5 };
}).filter(Boolean);
const H = rows.map(r => r.human), n = rows.length;

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) || 1; };
const stats = Object.fromEntries(features.map(k => { const c = rows.map(r => r.t[k]); return [k, { mean: mean(c), sd: sd(c) }]; }));
const design = r => [1, ...features.map(k => (r.t[k] - stats[k].mean) / stats[k].sd)];

// ridge (intercept unpenalised), Gaussian elimination
function ridge(X, y, lam) {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  X.forEach((x, i) => { for (let a = 0; a < p; a++) { b[a] += x[a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += x[a] * x[c]; } });
  for (let a = 1; a < p; a++) A[a][a] += lam;
  for (let i = 0; i < p; i++) {
    let m = i; for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < p; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < p; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const w = new Array(p);
  for (let i = p - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < p; c++) s -= A[i][c] * w[c]; w[i] = s / A[i][i]; }
  return w;
}
const dot = (x, w) => x.reduce((s, v, i) => s + v * w[i], 0);

const X = rows.map(design);
const loo = rows.map((_, i) => dot(X[i], ridge(X.filter((_, j) => j !== i), H.filter((_, j) => j !== i), lambda)));

function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }
const spearman = (x, y) => pearson(rank(x), rank(y));
const report = (name, pred) => {
  const g = pred.map(trapGradeOf), err = g.map((v, i) => v - H[i]);
  report.last = { rho: spearman(pred, H), mae: mean(err.map(Math.abs)) };
  console.log(name.padEnd(28), 'rho', (Number.isFinite(spearman(pred, H)) ? spearman(pred, H).toFixed(2) : '  —').padStart(5), '| MAE', mean(err.map(Math.abs)).toFixed(2), '| within 1:', (100 * err.filter(e => Math.abs(e) <= 1).length / n).toFixed(0) + '%', '| bias', mean(err).toFixed(2));
};
console.log(`n=${n} rated puzzles, features=${features.join(',')}, lambda=${lambda}`);
report('predict-median baseline', H.map(() => H.slice().sort((a, b) => a - b)[n >> 1]));
report('shipped decisionNodes', rows.map(r => r.shipped));
report('shipped combined', rows.map(r => r.combined));
for (const k of features) console.log(`single: ${k}`.padEnd(28), 'rho', spearman(rows.map(r => r.t[k]), H).toFixed(2).padStart(5));
report('trap grade (LOO ridge)', loo);

const looStats = report.last; // the 'trap grade (LOO ridge)' line above
const w = ridge(X, H, lambda);
const obj = (m) => '{ ' + features.map(k => `${k}: ${m[k]}`).join(', ') + ' }';
const block = `// <TRAP_MODEL>
export const TRAP_MODEL = {
  features: [${features.map(k => `'${k}'`).join(', ')}],
  mean: ${obj(Object.fromEntries(features.map(k => [k, +stats[k].mean.toFixed(4)])))},
  sd: ${obj(Object.fromEntries(features.map(k => [k, +stats[k].sd.toFixed(4)])))},
  w: ${obj(Object.fromEntries(features.map((k, i) => [k, +w[i + 1].toFixed(4)])))},
  b: ${+w[0].toFixed(4)},
  fit: { n: ${n}, lambda: ${lambda}, looRho: ${+looStats.rho.toFixed(2)}, looMae: ${+looStats.mae.toFixed(2)} },
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
