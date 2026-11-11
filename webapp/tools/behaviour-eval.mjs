// Do the difficulty grades predict what players did? Reads the export of tools/behaviour.mjs.
//   node tools/behaviour-eval.mjs rows.json [options]        (--help explains every option)
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
// An abandoned game (its time is cut off) and a game with a hint (its time is not comparable)
// are left out of all statistics above; the badge table shows their share (abn% = left
// unfinished, hint% = used a hint), and the wrong turns recorded in `ev` (rows of version 1)
// are summarised.
// Confidence intervals resample whole puzzles (rows of one puzzle are not independent).
import fs from 'node:fs';
import { makeRng } from '../src/core/rng.js';
import { invert, TIME_PRIOR } from '../src/core/gotd-model.js';
import { cli, capOption } from './args-lib.mjs';
import { sum, mean, quant, spearman, fmt, pct } from './stats-lib.mjs';
import { parse } from '../src/core/format.js';
import { packPuzzle, toB64u } from '../src/core/behaviour.js';
import { NAMES, GROUP, featuresOf } from './features.mjs';

const { values: o, rest } = cli({
  usage: 'node tools/behaviour-eval.mjs rows.json [options]',
  summary: 'Do the difficulty grades predict what players did? Prints, per group of games ' +
    '(local, daily = Game of Day + replay, calib = the calibration set), the badge table and ' +
    'how every metric correlates with the time, the cells taken back and the "stuck" games.',
  positional: [{ name: 'rows.json', required: true,
    help: 'the export of `node tools/behaviour.mjs export --out rows.json`' }],
  options: {
    'gotd-dir': { type: 'string', arg: 'DIR',
      help: 'folder with the Game-of-Day puzzles, DIR/<YYYYMMDD>.txt: fills in the rows whose ' +
        'export has no puzzle (a Game-of-Day row has none unless the export was made with ' +
        '--gotd-dir)' },
    'calib-dir': { type: 'string', arg: 'DIR',
      help: 'the calibration set made by calib-set.mjs: the local games of its puzzles form a ' +
        'third group, "calib" (played blind, badges balanced)' },
    cap: capOption,
    boot: { type: 'int', arg: 'N', min: 1, default: 400,
      help: 'bootstrap resamples for the 95% intervals: whole puzzles are redrawn with ' +
        'replacement N times and the statistic is computed again each time; more = smoother ' +
        'interval ends but slower, below about 100 they are rough' },
    seed: { type: 'int', arg: 'N', default: 1,
      help: 'seed of those random redraws: the same seed gives the same intervals' },
    stuck: { type: 'number', arg: 'F', min: 0.01, max: 1, default: 0.3,
      help: 'a game counts as "stuck" when its deepest single take-back is at least F x the ' +
        'cells of the board' },
    'min-rows': { type: 'int', arg: 'N', min: 1, default: 30,
      help: 'a group with fewer plain games gets the badge table only, no metric ranking' },
  },
});
const file = rest[0];
const GOTD_DIR = o['gotd-dir'], CALIB_DIR = o['calib-dir'], CAP = o.cap, BOOT = o.boot;
const SEED = o.seed, STUCK = o.stuck, MIN_ROWS = o['min-rows'];
const SHOWN = ['grade:trap', 'trapPredicted', 'trapMax', 'trapTop3', 'trapSum', 'grade:ladder',
  'grade:decisionNodes'];

// ---------- statistics ----------
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
const isPlain = r => !r.abandoned && !r.hint;
const flagCols = (all, b) => { // the share of a badge's games left unfinished / played with a hint
  const a = all.filter(r => r.f['grade:trap'] === b);
  return `  ${pct(a.filter(r => r.abandoned).length / a.length).padStart(5)} ` +
    `${pct(a.filter(r => r.hint && !r.abandoned).length / a.length).padStart(5)}`;
};
function report(name, all) {
  const g = all.filter(isPlain), flagged = all.length - g.length;
  const keys = [...new Set(g.map(r => r.key))], groups = keys.map(() => []);
  g.forEach((r, i) => groups[keys.indexOf(r.key)].push(i));
  const sizes = {};
  for (const r of g) sizes[r.f.n] = (sizes[r.f.n] || 0) + 1;
  console.log(`\n=== ${name}: ${g.length} rows, ${keys.length} puzzles, sizes ` +
    Object.entries(sizes).map(([n, c]) => `${n}x${n}:${c}`).join(' ') +
    (flagged ? ` | left out: abandoned ${all.filter(r => r.abandoned).length}, ` +
      `hint ${all.filter(r => r.hint && !r.abandoned).length}` : ''));
  if (!g.length) return;
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

  const withEv = g.filter(r => r.events);
  if (withEv.length) {
    const n = withEv.map(r => r.events.length);
    const depth = withEv.flatMap(r => r.events.map(e => e[1]));
    console.log(`wrong turns recorded for ${withEv.length} of ${g.length} rows: none in ` +
      `${pct(n.filter(c => !c).length / n.length)}, ${mean(n).toFixed(1)} per game` +
      (depth.length ? `, median depth ${quant(depth, .5).toFixed(0)} cells` : ''));
  }
  console.log('\nbadge  rows puzzles  median s  ln(s/cell)   u/T  deep/T  stuck' +
    (flagged ? '   abn%  hint%' : ''));
  let prev = null;
  for (let b = 0; b <= 5; b++) {
    const s = g.filter(r => r.f['grade:trap'] === b);
    if (!s.length) continue;
    const med = quant(s.map(r => r.lspc), .5), np = new Set(s.map(r => r.key)).size;
    console.log(`  ${b}  ${String(s.length).padStart(6)} ${String(np).padStart(7)}` +
      `  ${quant(s.map(r => r.sec), .5).toFixed(1).padStart(8)} ${fmt(med).padStart(11)} ` +
      `${fmt(quant(s.map(r => r.regret), .5))} ${fmt(quant(s.map(r => r.deepc), .5))}` +
      `  ${pct(mean(s.map(r => r.stuck))).padStart(5)}` + (flagged ? flagCols(all, b) : '') +
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
const kinds = [...new Set(rows.filter(isPlain).map(factor))].sort();
const pooled = rows.filter(r => isPlain(r) && Number.isFinite(r.f.trapPredicted));
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
