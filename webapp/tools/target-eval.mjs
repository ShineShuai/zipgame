// Does the targeted generator (src/core/gen/target.js) still reach every grade? Run it after every refit of the trap grade
// (node tools/fit-trap.mjs --write): the generator reads the grade's cuts from TRAP_MODEL, so a refit needs no code change,
// but a shifted band can make a grade easier or harder to reach, and this prints how much.
//   node tools/target-eval.mjs [--sizes 6,7,8,9] [--grades 0,1,2,3,4,5] [--seeds 8] [--effort 1] [--min-hit 0.7]
//                              [--max-ms 10000] [--no-minimize] [--independent] [--cap 1000000]
// Per size and target grade: hit = runs whose best puzzle has exactly the target grade (the Play badge), inside = also
// clear of the band's edges, mean number of tried changes, restarts and seconds. Grades a size cannot show (5x5 <= 2, 6x6 <= 3)
// are skipped. --min-hit R: exit 1 when any (size, grade) hit rate is below R (default: only report).
// --max-ms N: a time cap per run instead of the try cap (the run searches until the target is met or N ms have passed, else the closest puzzle).
// --no-minimize: do not strip unneeded walls inside the search (the first version of the generator). The table shows the mean walls per cell.
// --independent: the search optimises the trap score, a model fitted on hand ratings, so it can only be trusted if puzzles
// aimed at harder grades are also harder by measures the search never looked at. For every hit this computes the solver's
// guess points per cell (decisionNodes/cell), backtrack overhead per N (B/N) and the technique ladder's grade, prints their mean
// per target grade and their Spearman rank correlation (1 = same order as the target grade) with the target. A near-zero or
// negative correlation means the search is exploiting the trap model, not finding harder puzzles. Slower: --cap N is the
// reference-solve node cap of those metrics.
import { generateTargeted, maxTargetGrade, proposalBudget } from '../src/core/gen/target.js';
import { runSync } from '../src/core/run.js';
import { serialize } from '../src/core/format.js';
import { TRAP_MODEL } from '../src/core/trap.js';
import { featuresOf } from './features.mjs';
import { evalCap } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const list = (name, dflt) => String(opt(name, dflt)).split(',').map(Number);
const need = (ok, msg) => { if (!ok) { console.error(msg); process.exit(1); } };
const sizes = list('sizes', '6,7,8,9'), seeds = +opt('seeds', 8), effort = +opt('effort', 1), minHit = +opt('min-hit', 0);
const wanted = opt('grades') ? list('grades') : [0, 1, 2, 3, 4, 5];
const independent = args.includes('--independent'), CAP = evalCap(args), maxMs = +opt('max-ms', 0), minimize = !args.includes('--no-minimize');
need(sizes.every(n => Number.isInteger(n) && n >= 5 && n <= 16), '--sizes needs integers 5..16, e.g. --sizes 7,8,9');
need(wanted.every(g => Number.isInteger(g) && g >= 0 && g <= 5), '--grades needs integers 0..5');
need(Number.isInteger(seeds) && seeds >= 1 && effort > 0 && Number.isFinite(minHit) && maxMs >= 0, '--seeds >= 1, --effort > 0, --min-hit a number, --max-ms >= 0');

const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const pearson = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; };
const spearman = (x, y) => pearson(rank(x), rank(y));
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

console.log(`trap model cuts: [${(TRAP_MODEL.cuts || []).map(c => c.toFixed(2)).join(', ')}]  fit: ${TRAP_MODEL.fit ? `${TRAP_MODEL.fit.n} ratings, leave-one-out rho ${TRAP_MODEL.fit.looRho}` : 'no fit metadata'}`);
let failed = 0;
const hitsByGrade = new Map(); // target grade -> feature rows of the hits (for --independent)
for (const n of sizes) {
  const top = maxTargetGrade(n), grades = wanted.filter(g => g <= top);
  console.log(`\n${n}x${n}  (highest grade ${top}; ${maxMs ? `time cap ${maxMs} ms` : `effort ${effort} = ${proposalBudget(n, effort)} tried changes`} per run; ${minimize ? 'wall-minimal' : 'walls not stripped'}; ${seeds} seeds)`);
  console.log('  target   hit  inside  changes  restarts  seconds  walls/T   grades reached');
  for (const g of grades) {
    let hit = 0, inside = 0, changes = 0, restarts = 0, ms = 0, wallsT = 0, made = 0; const got = [];
    for (let s = 1; s <= seeds; s++) {
      const t0 = performance.now(), r = runSync(generateTargeted(n, g, s * 7919 + n * 101 + g, { effort, maxMs, minimize }));
      ms += performance.now() - t0;
      if (!r.puzzle) { got.push('x'); continue; }
      got.push(r.grade); changes += r.proposals; restarts += r.restarts; wallsT += r.walls / (n * n); made++;
      if (r.hit) { hit++; if (r.inside) inside++; if (independent) { const row = featuresOf({ key: serialize(r.puzzle) }, CAP); (hitsByGrade.get(g) ?? hitsByGrade.set(g, []).get(g)).push(row); } }
    }
    const rate = hit / seeds, bad = rate < minHit;
    if (bad) failed++;
    console.log(`  ${String(g).padStart(4)}   ${`${hit}/${seeds}`.padStart(5)}  ${String(inside).padStart(5)}  ${f(changes / seeds, 0).padStart(7)}  ${f(restarts / seeds, 1).padStart(8)}  ${f(ms / seeds / 1000).padStart(7)}  ${f(wallsT / Math.max(1, made), 3).padStart(7)}   [${got.join(' ')}]${bad ? `   < --min-hit ${minHit}` : ''}`);
  }
}
if (independent) {
  console.log('\nIndependent check (hits only, all sizes pooled): mean per target grade, and Spearman rho with the target grade');
  const metrics = ['decisionNodes/cell', 'B/N', 'grade:ladder', 'ladHardest'], gs = [...hitsByGrade.keys()].sort((a, b) => a - b);
  console.log('  ' + 'metric'.padEnd(20) + gs.map(g => `g${g}`.padStart(8)).join('') + '     rho');
  for (const m of metrics) {
    const xs = [], ys = [];
    for (const g of gs) for (const r of hitsByGrade.get(g)) { xs.push(g); ys.push(r[m]); }
    console.log('  ' + m.padEnd(20) + gs.map(g => f(mean(hitsByGrade.get(g).map(r => r[m]))).padStart(8)).join('') + '  ' + f(spearman(xs, ys)).padStart(6));
  }
}
if (failed) { console.error(`\n${failed} (size, grade) cell(s) below --min-hit ${minHit}`); process.exit(1); }
