// Correlate the grading metrics with what players actually did, using the play log (src/features/playlog.js).
//   node tools/playlog-eval.mjs playlog.json [more.json ...] [--cap 1000000] [--min-solved 20]
// Get the file in the play app: hold V, click "play log" (downloads playlog.json). Every puzzle you solve adds a record,
// so this is a growing, objective label next to the hand ratings: no rating effort, no opinion drift.
// Labels (per solved puzzle, hints not used, because a hint changes time and path):
//   effort = ln(seconds) minus what its size predicts (least-squares line of ln seconds on ln cells, over your own solves):
//            0 = typical for its size, +0.69 = twice as slow as usual.
//   regret = cells drawn and taken back, per cell of the board (undone / T): the wasted-moves measure the trap score estimates.
//   deep   = the most cells taken back in one go, per cell (maxUndone / T): how far the worst wrong turn went before it was noticed.
// Prints Spearman rho (rank correlation, 1 = same order) of every metric against each label, then the labels by Play badge.
// Few solves or a changing skill make these numbers soft: play a few dozen puzzles per size before trusting a difference of 0.1.
import fs from 'node:fs';
import { evalCap } from './lib.mjs';
import { NAMES, GROUP, featuresOf } from './features.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const MIN_SOLVED = +opt('min-solved', 20);
const files = args.filter((a, i) => !a.startsWith('--') && !['--cap', '--min-solved'].includes(args[i - 1]));
if (!files.length) { console.error('usage: node tools/playlog-eval.mjs playlog.json [more.json ...] [--cap N] [--min-solved N]'); process.exit(1); }
const CAP = evalCap(args);

const seen = new Set(), recs = [];
for (const f of files) for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) { const id = r.at + '|' + r.key; if (!seen.has(id)) { seen.add(id); recs.push(r); } }
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }
const spearman = (x, y) => x.length < 4 ? NaN : pearson(rank(x), rank(y));
const fmt = v => Number.isFinite(v) ? v.toFixed(2).padStart(6) : '     —';

const solved = recs.filter(r => r.solved && !r.hints && r.ms > 0);
console.log(`${recs.length} records, ${recs.filter(r => r.solved).length} solved, ${solved.length} solved without hints (used for the labels), ${recs.filter(r => !r.solved).length} abandoned`);
if (solved.length < MIN_SOLVED) console.log(`WARNING: fewer than ${MIN_SOLVED} usable solves: the correlations below are noise. Play more and rerun.`);
if (!solved.length) process.exit(0);

// size-adjusted effort
const lnT = r => Math.log(r.n * r.n), lnS = r => Math.log(r.ms / 1000);
const sizes = [...new Set(solved.map(r => r.n))];
let a = mean(solved.map(lnS)), b = 0;
if (sizes.length >= 2) { const mx = mean(solved.map(lnT)), my = a; b = solved.reduce((s, r) => s + (lnT(r) - mx) * (lnS(r) - my), 0) / solved.reduce((s, r) => s + (lnT(r) - mx) ** 2, 0); a = my - b * mx; }
console.log(`size model: ln seconds = ${a.toFixed(2)} + ${b.toFixed(2)} * ln cells (${sizes.length} size(s): ${sizes.sort((x, y) => x - y).join(', ')})`);

const featCache = new Map();
const feat = r => { if (!featCache.has(r.key)) featCache.set(r.key, featuresOf({ key: r.key }, CAP)); return featCache.get(r.key); };
const rows = solved.map(r => { const T = r.n * r.n; return { r, f: feat(r), effort: lnS(r) - (a + b * lnT(r)), regret: r.undone / T, deep: r.maxUndone / T }; });
if (rows.some(x => x.f._capped)) console.log(`NOTE: ${rows.filter(x => x.f._capped).length} puzzle(s) hit the solver cap (--cap ${CAP}); their legacy metrics are lower bounds.`);

const within = (k, lab) => { const per = sizes.map(n => rows.filter(x => x.r.n === n)).filter(g => g.length >= 8).map(g => spearman(g.map(x => x.f[k]), g.map(x => x[lab]))).filter(Number.isFinite); return per.length ? mean(per) : NaN; };
const table = NAMES.filter(k => k !== 'n').map(k => {
  const col = rows.map(x => x.f[k]);
  return { k, effort: spearman(col, rows.map(x => x.effort)), within: within(k, 'effort'), regret: spearman(col, rows.map(x => x.regret)), deep: spearman(col, rows.map(x => x.deep)) };
}).sort((x, y) => Math.abs(y.effort || 0) - Math.abs(x.effort || 0));
console.log('\nmetric'.padEnd(22), 'group'.padEnd(8), 'effort', ' within-size', ' regret', '  deep');
for (const x of table) console.log(x.k.padEnd(21), (GROUP[x.k] || '').padEnd(8), fmt(x.effort), fmt(x.within).padStart(11), fmt(x.regret), fmt(x.deep));

console.log('\nby Play badge (grade:trap):  count  abandoned  effort (x of size average)  regret (cells wasted per cell)');
for (const g of [0, 1, 2, 3, 4, 5]) {
  const rs = rows.filter(x => x.f['grade:trap'] === g), all = recs.filter(r => feat(r)['grade:trap'] === g), ab = all.filter(r => !r.solved).length;
  if (!all.length) continue;
  console.log(`  badge ${g}:`.padEnd(14), String(all.length).padStart(5), (ab + '/' + all.length).padStart(10), rs.length ? ('x' + Math.exp(mean(rs.map(x => x.effort))).toFixed(2)).padStart(20) : '—'.padStart(20), rs.length ? mean(rs.map(x => x.regret)).toFixed(2).padStart(27) : '');
}
console.log('\nA useful badge shows effort and regret rising with the grade. Rank agreement above is per puzzle; the badge table shows whether the cutpoints put the steps where players feel them.');
