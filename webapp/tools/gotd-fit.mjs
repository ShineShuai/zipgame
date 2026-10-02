#!/usr/bin/env node
// Fit every difficulty metric / grade in features.mjs to the hand ratings, rank them, write tools/gotd-models.json.
// tools/gotd-seed.mjs reads that file: the best candidates become the synthetic seed players of a Game-of-Day.
//   node tools/gotd-fit.mjs [tools/ratings.json] [--out tools/gotd-models.json] [--check]
//   --check   only compare the ratings hash stored in the output with the ratings file (exit 1 when stale); fast, no fitting
// Per candidate: h = a + b * f(x) (f = identity or log1p, chosen by leave-one-out MAE), or for integer grades also the mean rating per grade.
// Rows where a solver metric is undefined (reference solve capped) are left out of that candidate's fit, as at seeding time.
// A grade metric (grade:*) whose fitted grade -> rating map is not non-decreasing is dropped: "grade 3" would be rated easier than "grade 2".
// A candidate whose leave-one-out predictions rank the puzzles against the human ratings (Spearman <= 0) is dropped too: its fit rests on a few
// rows and flips when one of them is left out (ladProbe2 is 0 for almost every puzzle).
// Ranking = skill = 1 - LOO weighted MAE / LOO MAE of a constant prediction, both on the candidate's own rows (so a solver metric fitted on
// the easier uncapped puzzles is not favoured). Candidates with skill <= MIN_SKILL are no candidates. A candidate is also dropped when a
// better one is derived from the same metric (grade:B vs B/N) or ranks the puzzles almost identically (|Spearman| >= 0.95). `top3` / `top10` = share of 200 bootstrap fits
// (scored on the left-out rows) in which the candidate lands in the top 3 / 10: how stable the order is. Size `n` is not a candidate:
// the size effect belongs to the time model (gotd-model.js), not to the difficulty scale.
// Trap and ladder keep their own fits (fit-trap.mjs, ladder.js constants); their entries here only map them onto the human scale.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { NAMES, GROUP, needsSolver, isGrade, featuresOf } from './features.mjs';
import { ratingWeight } from '../src/core/ratings-io.js';
import { TRAP_MODEL } from '../src/core/trap.js';
import { makeRng } from '../src/core/rng.js';
import { spearman } from '../src/core/stats-merge.js';
import { fitCandidate, dedupe, predictH, isMonotone } from '../src/core/gotd-model.js';

const args = process.argv.slice(2);
const here = p => new URL(p, import.meta.url).pathname;
const ratingsFile = args.find(a => a.endsWith('.json') && a !== args[args.indexOf('--out') + 1]) || here('./ratings.json');
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : here('./gotd-models.json');
const raw = fs.readFileSync(ratingsFile, 'utf8'), sha = crypto.createHash('sha256').update(raw).digest('hex');

if (args.includes('--check')) {
  const have = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).ratings?.sha256 : null;
  console.log(have === sha ? 'gotd-models.json matches ratings.json' : 'gotd-models.json is stale: run  node tools/gotd-fit.mjs');
  process.exit(have === sha ? 0 : 1);
}

const R = JSON.parse(raw), H = R.map(r => r.human), W = R.map(ratingWeight);
const t0 = Date.now(), F = R.map(featuresOf);
const BASE = { 'grade:decisionNodes': 'decisionNodes/cell', 'grade:B': 'B/N', 'grade:cross': 'crossPerSeg', 'grade:trap': 'trapPredicted' };
const familyOf = id => BASE[id] || id, MIN_SKILL = 0.02;
const defined = id => F.map((f, i) => i).filter(i => !(needsSolver(id) && F[i]._capped));
const column = (id, rows) => rows.map(i => F[i][id]);

const fitOn = (id, rows) => fitCandidate(column(id, rows), rows.map(i => H[i]), rows.map(i => W[i]), { bucket: isGrade(id) });
const cands = NAMES.filter(id => id !== 'n').map(id => {
  const rows = defined(id), fit = fitOn(id, rows);
  return fit && { id, group: GROUP[id], rows, solver: needsSolver(id), ...fit };
}).filter(c => c && c.skill > MIN_SKILL).sort((a, b) => b.skill - a.skill);
const unstable = cands.filter(c => !(c.rho > 0)).map(c => ({ id: c.id, because: `its leave-one-out predictions rank the puzzles against the ratings (rho ${c.rho === null ? 'n/a' : c.rho.toFixed(2)})` }));

const corrCache = new Map();
const corr = (a, b) => {
  const key = a + '|' + b;
  if (!corrCache.has(key)) {
    const rows = defined(a).filter(i => defined(b).includes(i)), r = spearman(column(a, rows), column(b, rows));
    corrCache.set(key, r === null ? 0 : Math.abs(r));
  }
  return corrCache.get(key);
};
const ordered = cands.filter(c => c.rho > 0 && (!isGrade(c.id) || isMonotone(c.model)));
const notOrdered = cands.filter(c => !ordered.includes(c) && c.rho > 0).map(c => ({ id: c.id, because: 'its grades are not rated in increasing order: ' + (c.model.kind === 'bucket' ? Object.entries(c.model.table).map(([g, h]) => `${g}:${h.toFixed(2)}`).join(' ') : 'negative slope') }));
const { kept, dropped: dups } = dedupe(ordered, familyOf, corr), dropped = [...notOrdered, ...unstable, ...dups];

// Bootstrap: refit every kept candidate on a resample, score it on the rows the resample did not contain.
const rnd = makeRng(12345), B = 200, top3 = {}, top10 = {}, sk = {};
for (let b = 0; b < B; b++) {
  const inBag = Array.from({ length: R.length }, () => Math.floor(rnd() * R.length)), oob = new Set(R.map((_, i) => i));
  inBag.forEach(i => oob.delete(i));
  const scored = [];
  for (const c of kept) {
    const rows = inBag.filter(i => c.rows.includes(i)), test = [...oob].filter(i => c.rows.includes(i)), fit = fitOn(c.id, rows);
    if (!fit || !test.length) continue;
    const wsum = rs => rs.reduce((s, i) => s + W[i], 0), mean = rows.reduce((s, i) => s + W[i] * H[i], 0) / wsum(rows);
    const err = pred => test.reduce((s, i) => s + W[i] * Math.abs(pred(i) - H[i]), 0) / wsum(test);
    const skill = 1 - err(i => predictH(fit.model, F[i][c.id])) / err(() => mean);
    scored.push({ id: c.id, skill }); (sk[c.id] = sk[c.id] || []).push(skill);
  }
  scored.sort((a, b2) => b2.skill - a.skill).forEach((s, k) => { if (k < 3) top3[s.id] = (top3[s.id] || 0) + 1; if (k < 10) top10[s.id] = (top10[s.id] || 0) + 1; });
}

const sd = xs => { const m = xs.reduce((a, v) => a + v, 0) / (xs.length || 1); return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const r4 = x => (x === null || x === undefined ? x : +x.toFixed(4));
const roundModel = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([g, x]) => [g, r4(x)])) : v]));
const ranked = kept.map(c => ({ id: c.id, group: c.group, solver: c.solver, rows: c.rows.length, ...(isGrade(c.id) ? { seen: [...new Set(c.rows.map(i => F[i][c.id]))].sort((a, b) => a - b) } : {}), skill: r4(c.skill), skillSd: r4(sd(sk[c.id] || [])), looMae: r4(c.mae), looRho: r4(c.rho), top3: (top3[c.id] || 0) / B, top10: (top10[c.id] || 0) / B, model: roundModel(c.model) }));
const out = {
  ratings: { n: R.length, sha256: sha }, trapFitN: TRAP_MODEL.fit ? TRAP_MODEL.fit.n : null,
  note: 'generated by tools/gotd-fit.mjs, do not edit by hand', ranked, dropped,
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');

console.log(`${R.length} ratings, ${NAMES.length - 1} metrics fitted in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${ranked.length} candidates kept, ${dropped.length} dropped`);
console.log('rank  candidate              group    rows  skill   +-sd  LOO-MAE  LOO-rho  top3  top10  fit');
ranked.forEach((c, i) => console.log(String(i + 1).padStart(4), ' ', c.id.padEnd(22), c.group.padEnd(8), String(c.rows).padStart(4), c.skill.toFixed(2).padStart(6), c.skillSd.toFixed(2).padStart(6), c.looMae.toFixed(3).padStart(8), String(c.looRho?.toFixed(2) ?? '—').padStart(8), (c.top3 * 100).toFixed(0).padStart(4) + '%', (c.top10 * 100).toFixed(0).padStart(5) + '%', ' ', c.model.kind === 'bucket' ? 'bucket means' : `${c.model.kind}: ${c.model.a} + ${c.model.b}*x`));
console.log('dropped: ' + dropped.map(d => `${d.id} (${d.because.includes(' ') ? d.because : '~' + d.because})`).join('; '));
console.log(`no better than a constant (skill <= ${MIN_SKILL}): ` + NAMES.filter(id => id !== 'n' && !cands.some(c => c.id === id)).join(', '));
if (TRAP_MODEL.fit && TRAP_MODEL.fit.n !== R.length) console.log(`WARNING: the trap model was fitted on ${TRAP_MODEL.fit.n} ratings, ratings.json has ${R.length}: run node tools/fit-trap.mjs --write first, then this tool again`);
