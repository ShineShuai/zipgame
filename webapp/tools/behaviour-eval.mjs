// Do the difficulty grades predict what players did? Reads the export of tools/behaviour.mjs.
//   node tools/behaviour-eval.mjs rows.json [--gotd-dir DIR] [--cap N] [--boot B] [--seed S]
//                                           [--stuck F] [--min-rows R] [--calib-dir DIR]
// rows.json = `node tools/behaviour.mjs export --out rows.json [--gotd-dir DIR]`. A Game-of-Day
// row has no puzzle in the export unless it was made with --gotd-dir; pass --gotd-dir here to
// fill it in (DIR/<date>.txt). Two groups are evaluated apart (time scales differ ~3x):
// "local" and "daily" (Game of Day + replay); with --calib-dir DIR (the calibration set of
// tools/calib-set.mjs) the local games of its puzzles form a third group, "calib": played blind,
// badges balanced. Labels (no player id, so none depends on the
// player):
//   lspc   ln(seconds per cell): size-adjusted time; heavy-tailed, so ranks (Spearman), no means
//   regret cells taken back per cell (u / T);  deepc = deepest take-back per cell (deep / T)
//   stuck  deep >= F * T (--stuck, default 0.3): the player went far down a wrong turn
// Confidence intervals resample whole puzzles (rows of one puzzle are not independent).
import fs from 'node:fs';
import { makeRng } from '../src/core/rng.js';
import { invert, TIME_PRIOR } from '../src/core/gotd-model.js';
import { evalCap } from './lib.mjs';
import { parse } from '../src/core/format.js';
import { packPuzzle, toB64u } from '../src/core/behaviour.js';
import { NAMES, GROUP, featuresOf } from './features.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: node tools/behaviour-eval.mjs rows.json [--gotd-dir DIR] [--cap N]');
  process.exit(1);
}
const GOTD_DIR = opt('gotd-dir'), CAP = evalCap(args), BOOT = +opt('boot', 400);
const SEED = +opt('seed', 1), STUCK = +opt('stuck', 0.3), MIN_ROWS = +opt('min-rows', 30);
const CALIB_DIR = opt('calib-dir');
const SHOWN = ['grade:trap', 'trapPredicted', 'grade:ladder', 'grade:decisionNodes'];

// ---------- statistics ----------
const sum = a => a.reduce((s, v) => s + v, 0);
const mean = a => sum(a) / a.length;
const quant = (a, q) => {
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
function rank(a) { // average ranks for ties
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = [];
  for (let i = 0, j; i < idx.length; i = j + 1) {
    for (j = i; j + 1 < idx.length && idx[j + 1][0] === idx[i][0];) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
  }
  return r;
}
function pearson(x, y) {
  const mx = mean(x), my = mean(y);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - mx) * (y[i] - my);
    b += (x[i] - mx) ** 2;
    c += (y[i] - my) ** 2;
  }
  return a / Math.sqrt(b * c);
}
const spearman = (x, y) => (x.length < 4 ? NaN : pearson(rank(x), rank(y)));
const fmt = v => (Number.isFinite(v) ? v.toFixed(2).padStart(6) : '     —');
const pct = v => (100 * v).toFixed(0) + '%';

// OLS with standard errors clustered by puzzle. X rows include the intercept. -> { b, se }
function clusterOls(X, y, cl) {
  const k = X[0].length, n = X.length;
  const zero = () => Array.from({ length: k }, () => Array(k).fill(0));
  const XtX = zero(), meat = zero(), Xty = Array(k).fill(0), score = new Map();
  X.forEach((x, i) => {
    for (let a = 0; a < k; a++) {
      Xty[a] += x[a] * y[i];
      for (let c = 0; c < k; c++) XtX[a][c] += x[a] * x[c];
    }
  });
  const inv = invert(XtX), b = inv.map(r => sum(r.map((v, j) => v * Xty[j])));
  X.forEach((x, i) => {
    const e = y[i] - sum(x.map((v, j) => v * b[j])), s = score.get(cl[i]) || Array(k).fill(0);
    for (let a = 0; a < k; a++) s[a] += x[a] * e;
    score.set(cl[i], s);
  });
  for (const s of score.values()) {
    for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) meat[a][c] += s[a] * s[c];
  }
  const G = score.size, f = (G / (G - 1)) * ((n - 1) / (n - k));
  const mm = (A, B) => A.map(r => B[0].map((_, c) => sum(r.map((v, j) => v * B[j][c]))));
  const V = mm(mm(inv, meat), inv);
  return { b, se: V.map((r, i) => Math.sqrt(r[i] * f)), puzzles: G };
}

// ---------- rows ----------
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const feats = new Map();
const featOf = key => {
  if (!feats.has(key)) {
    try { feats.set(key, featuresOf({ key }, CAP)); } catch { feats.set(key, null); }
  }
  return feats.get(key);
};
const idOf = text => { // canonical id of a puzzle: its packed form, whatever its comments say
  try { return toB64u(packPuzzle(parse(text))); } catch { return null; }
};
const calibIds = new Set(CALIB_DIR ? fs.readdirSync(CALIB_DIR).filter(f => f.endsWith('.txt'))
  .map(f => idOf(read(`${CALIB_DIR}/${f}`))) : []);
const { rows: raw } = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = [];
let noPuzzle = 0, bad = 0;
for (const r of raw) {
  const key = r.key || (GOTD_DIR && r.kind !== 'local' ? read(`${GOTD_DIR}/${r.date}.txt`) : null);
  if (!key) { noPuzzle++; continue; }
  const f = r.bad ? null : featOf(key);
  if (!f) { bad++; continue; }
  const T = f.n * f.n, sec = r.ms / 1000;
  rows.push({
    ...r, key, f, T, sec, lspc: Math.log(sec / T), regret: r.u / T, deepc: r.deep / T,
    stuck: r.deep / T >= STUCK ? 1 : 0,
    group: r.kind !== 'local' ? 'daily' : calibIds.has(idOf(key)) ? 'calib' : 'local',
  });
}
console.log(`${raw.length} rows read, ${rows.length} usable; without puzzle ${noPuzzle}` +
  (noPuzzle && !GOTD_DIR ? ' (Game-of-Day rows: add --gotd-dir DIR)' : '') +
  `, undecodable ${bad}`);
const capped = new Set(rows.filter(r => r.f._capped).map(r => r.key)).size;
if (capped) console.log(`NOTE: ${capped} puzzle(s) hit the solver cap: legacy metrics are low`);

// ---------- one group ----------
function report(name, g) {
  const keys = [...new Set(g.map(r => r.key))], groups = keys.map(() => []);
  g.forEach((r, i) => groups[keys.indexOf(r.key)].push(i));
  const sizes = {};
  for (const r of g) sizes[r.f.n] = (sizes[r.f.n] || 0) + 1;
  console.log(`\n=== ${name}: ${g.length} rows, ${keys.length} puzzles, sizes ` +
    Object.entries(sizes).map(([n, c]) => `${n}x${n}:${c}`).join(' '));
  const seen = [0, 1, 2, 3, 4, 5].map(b => g.filter(r => r.f['grade:trap'] === b).length);
  const never = seen.flatMap((c, b) => (c ? [] : [b])).join(' ');
  console.log('Play badge rows 0..5: ' + seen.join(' ') +
    (never ? `  | never seen: ${never}` : ''));
  const secs = g.map(r => r.sec).sort((a, b) => a - b), top = Math.ceil(g.length / 10);
  const slow = sum(secs.slice(-top)) / sum(secs);
  console.log(`time s p50 ${quant(secs, .5).toFixed(0)} p90 ${quant(secs, .9).toFixed(0)} ` +
    `p95 ${quant(secs, .95).toFixed(0)}; slowest 10% = ${pct(slow)} of all time; ` +
    `clean (u=0) ${pct(g.filter(r => !r.u).length / g.length)}; ` +
    `stuck (deep >= ${STUCK}T) ${pct(mean(g.map(r => r.stuck)))}`);
  const waste = spearman(g.map(r => r.sec), g.map(r => r.u));
  console.log(`rho(time, u) = ${fmt(waste).trim()} (how much of the time is wasted moves)`);
  const known = g.filter(r => r.skill != null && r.skill !== 15);
  const sk = spearman(known.map(r => r.skill), known.map(r => r.lspc));
  console.log(`skill bucket vs ln(s/cell): rho ${fmt(sk).trim()} (${known.length} known rows)` +
    (Math.abs(sk) < 0.15 ? ' -> no signal: dividing time by it only adds noise' : ''));

  console.log('\nbadge  rows puzzles  median s  ln(s/cell)   u/T  deep/T  stuck');
  let prev = null;
  for (let b = 0; b <= 5; b++) {
    const s = g.filter(r => r.f['grade:trap'] === b);
    if (!s.length) continue;
    const med = quant(s.map(r => r.lspc), .5), np = new Set(s.map(r => r.key)).size;
    console.log(`  ${b}  ${String(s.length).padStart(6)} ${String(np).padStart(7)}` +
      `  ${quant(s.map(r => r.sec), .5).toFixed(1).padStart(8)} ${fmt(med).padStart(11)} ` +
      `${fmt(quant(s.map(r => r.regret), .5))} ${fmt(quant(s.map(r => r.deepc), .5))}` +
      `  ${pct(mean(s.map(r => r.stuck))).padStart(5)}` +
      (prev && med < prev.med ? `   <- below badge ${prev.b}` : ''));
    prev = { b, med };
  }
  if (g.length < MIN_ROWS) {
    return console.log(`\n(fewer than ${MIN_ROWS} rows: no metric ranking)`);
  }

  const rnd = makeRng(SEED);
  const boots = Array.from({ length: BOOT }, () =>
    keys.flatMap(() => groups[Math.floor(rnd() * keys.length)]));
  const lab = {
    lspc: g.map(r => r.lspc), regret: g.map(r => r.regret),
    deepc: g.map(r => r.deepc), stuck: g.map(r => r.stuck),
  };
  const table = NAMES.map(k => {
    const x = g.map(r => r.f[k]);
    if (x.every(v => v === x[0])) return null;
    const bs = boots.map(ix => spearman(ix.map(i => x[i]), ix.map(i => lab.lspc[i])))
      .filter(Number.isFinite), ok = bs.length > BOOT / 2;
    return {
      k, t: spearman(x, lab.lspc), lo: ok ? quant(bs, .025) : NaN, hi: ok ? quant(bs, .975) : NaN,
      r: spearman(x, lab.regret), d: spearman(x, lab.deepc), s: spearman(x, lab.stuck),
    };
  }).filter(Boolean).sort((a, b) => Math.abs(b.t || 0) - Math.abs(a.t || 0));
  console.log('\nSpearman vs ln(s/cell) [95% CI over puzzles], and vs regret / deep / stuck');
  console.log('metric'.padEnd(21), 'group'.padEnd(8),
    '   rho      CI           regret  deep  stuck');
  table.forEach((x, i) => {
    if (i >= 12 && !SHOWN.includes(x.k)) return;
    const ci = `[${fmt(x.lo).trim()}, ${fmt(x.hi).trim()}]`.padEnd(14);
    console.log(x.k.padEnd(21), (GROUP[x.k] || '').padEnd(8), fmt(x.t), ci,
      fmt(x.r), fmt(x.d), fmt(x.s));
  });
  const floor = 2.8 / Math.sqrt(Math.max(1, keys.length - 3));
  console.log(`|rho| under ~${floor.toFixed(2)} cannot be told from 0 ` +
    `with ${keys.length} puzzles`);
}
for (const name of ['calib', 'local', 'daily']) {
  const g = rows.filter(r => r.group === name);
  if (g.length) report(name, g);
}

// ---------- time per grade, all rows together ----------
const factor = r => (r.group === 'calib' ? 'calib' : r.kind); // blind games differ from local ones
const kinds = [...new Set(rows.map(factor))].sort();
const pooled = rows.filter(r => Number.isFinite(r.f.trapPredicted));
const clusters = new Set(pooled.map(r => r.key)).size;
if (pooled.length >= 20 && clusters >= 8 && new Set(pooled.map(r => r.f.trapPredicted)).size > 2) {
  const X = pooled.map(r => [
    1, ...kinds.slice(1).map(k => +(factor(r) === k)), Math.log(r.T / 49), r.f.trapPredicted,
  ]);
  const m = clusterOls(X, pooled.map(r => Math.log(r.sec)), pooled.map(r => r.key));
  const k = X[0].length, c = m.b[k - 1], h = 1.96 * m.se[k - 1];
  const x = n => 'x' + Math.exp(n).toFixed(2);
  console.log(`\nln(s) = kind(${kinds.join('/')}) + g*ln(cells/49) + c*trapPredicted ` +
    `(${pooled.length} rows, ${m.puzzles} puzzles)`);
  console.log(`  size exponent g ${m.b[k - 2].toFixed(2)} ± ${(1.96 * m.se[k - 2]).toFixed(2)}` +
    ' (1 = time proportional to cells)');
  console.log(`  c ${c.toFixed(2)} ± ${h.toFixed(2)} = ${x(c)} per grade ` +
    `[${x(c - h)}, ${x(c + h)}]; gotd-model prior ${x(TIME_PRIOR.mean[2])}`);
}
