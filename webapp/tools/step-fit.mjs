// Fit the step-level model of wrong turns to the behaviour rows, compare it with the grade the
// game
// uses today, and say whether the data justify changing that grade.
//   node tools/step-fit.mjs rows.json [--gotd-dir DIR] [--cap N] [--folds 5] [--boot 400]
//                                     [--pboot 100] [--seed 1] [--no-skill]
// rows.json = `node tools/behaviour.mjs export --out rows.json` (row version 1 carries the wrong
// turns
// in `ev`; older rows are skipped). --gotd-dir DIR fills in the Game-of-Day puzzles
// (DIR/<date>.txt).
//
// What it does (the model is described in step-lib.mjs): at every step of a puzzle's solution the
// wrong moves are sorted into the four buckets of the trap grade by how deep the solver has to go
// to
// refute them (obvious / shallow / deep / capped). The wrong turns the players really took are
// counted per step, and the rate of a wrong move of each bucket is fitted. Today's grade assumes
// 0 / 1 / 3 / 5 points; the fit finds what the players say. Per bucket it prints
//   lambda  wrong turns per game and wrong move of that bucket (a reference player)
//   D       cells the player walks on before taking it back
//   w       lambda * D = cells wasted per wrong move: what a point should stand for
//   points  w relative to the shallow bucket, to compare with TRAP_CFG.points 0 / 1 / 3 / 5
//
// ACCEPTANCE RULE. The grade of src/core/trap.js (the points, TRAP_MODEL, its cut points) is
// changed
// on the strength of this tool only if, on games not used for the fit (5-fold cross-validation,
// the
// folds hold whole puzzles) and with 95% intervals from resampling whole puzzles:
//   0. data     at least 200 games on at least 40 puzzles (RULE in step-lib.mjs). Less:
//   INCONCLUSIVE.
//   A. weights  the free bucket rates predict the held-out wrong turns better than the hand-set
//               points do: the log-likelihood per game is higher, the interval's low end above 0.
//   B. score    the new puzzle score (expected cells wasted per cell of the board) ranks the games
//   by
//               the cells they really wasted (u / T) better than the grade's own score does
//               (trapPredicted): the difference of the Spearman rho is at least 0.05 and the low
//               end
//               of its interval is above 0.
//   ACCEPT = A and B. PARTIAL = one of them (the verdict line says what it allows). Neither:
//   REJECT
//   from 800 games on (RULE.confirmGames: a clear deviation from the points is found with 95%
//   probability from there, see step-sim.mjs --power), before that NO EVIDENCE YET, not a
//   rejection.
// The cut points are moved separately, from the badge table of behaviour-eval.mjs.
import fs from 'node:fs';
import { evalCap } from './lib.mjs';
import { featuresOf } from './features.mjs';
import { TRAP_CFG } from '../src/core/trap.js';
import { BUCKETS, RULE, stepsOfPuzzle, analyse, parameters } from './step-lib.mjs';
import { sum, fmt, pct } from './stats-lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: node tools/step-fit.mjs rows.json [--gotd-dir DIR] [--boot 400]');
  process.exit(1);
}
const GOTD_DIR = opt('gotd-dir'), CAP = evalCap(args), SEED = +opt('seed', 1);
const BOOT = +opt('boot', 400), PBOOT = +opt('pboot', 100), FOLDS = +opt('folds', 5);
const NO_SKILL = args.includes('--no-skill');
const out = (...parts) => console.log(parts.join(''));

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const { rows: raw } = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = raw.map(r => ({
  ...r, key: r.key || (GOTD_DIR && r.kind !== 'local' ? read(`${GOTD_DIR}/${r.date}.txt`) : null),
}));
const stepCache = new Map(), trapCache = new Map();
const stepsFor = key => {
  if (!stepCache.has(key)) stepCache.set(key, stepsOfPuzzle(key, CAP));
  return stepCache.get(key);
};
const current = key => {
  if (!trapCache.has(key)) trapCache.set(key, featuresOf({ key }, CAP).trapPredicted);
  return trapCache.get(key);
};

const { data, held, res } = analyse(rows, stepsFor, current,
  { folds: FOLDS, boot: BOOT, seed: SEED, useSkill: !NO_SKILL });
const g = data.games, w = data.why, nPuzzles = new Set(g.map(x => x.key)).size;
out(`${w.rows} rows read; usable games ${g.length} on ${nPuzzles} puzzles`);
out('left out: no wrong-turn record ', w.noEvents, ' (older page), abandoned ', w.abandoned,
  ', hint ', w.hint, ', hit the event cap ', w.capped, ', no puzzle or solution ', w.noPuzzle);
if (!g.length) {
  out('Nothing to fit: no game with wrong-turn events yet (needs row version 1).');
  process.exit(0);
}
out('wrong turns ', data.events, ' (', (data.events / g.length).toFixed(1), ' per game); ',
  pct(data.unexplained / Math.max(1, data.events)),
  ' at a step the profile lists no wrong move for');
out(pct(g.filter(x => !x.m.size).length / g.length), ' of the games had no wrong turn at all');

// ---------- the fitted buckets ----------
const per = [0, 1, 2, 3].map(b => sum(g.map(x => sum(x.P.steps.map(s => s.c[b])))));
const par = parameters(g, { boot: PBOOT, seed: SEED });
const ci = c => `[${fmt(c[0]).trim()}, ${fmt(c[1]).trim()}]`;
const cell = (v, c, digits, width) => `${v.toFixed(digits)} ${ci(c)}`.padEnd(width);
out('\nbucket    wrong moves  lambda [95% CI]        D cells [CI]       w cells [CI]',
  '        points [CI]        hand');
BUCKETS.forEach((name, b) => {
  out(name.padEnd(9), ' ', String(per[b]).padStart(10), '  ',
    cell(par.est.lambda[b], par.ci.lambda[b], 4, 22), cell(par.est.D[b], par.ci.D[b], 1, 19),
    cell(par.est.w[b], par.ci.w[b], 3, 21), cell(par.est.points[b], par.ci.points[b], 2, 19),
    TRAP_CFG.points[b]);
});
out('skill effect gamma ', par.est.gamma.toFixed(2), ' ', ci(par.ci.gamma),
  ' per 3 skill buckets', NO_SKILL ? ' (switched off)' : '');

// ---------- the two gates ----------
const e = res.est, c = res.ci, f3 = v => v.toFixed(3);
out(`\nheld-out log-likelihood per game (${FOLDS}-fold by puzzle, ${held.length} games)`);
out('  hand-set points over equal rates  ', f3(e.dUni), ' ', ci(c.dUni));
out('  free bucket rates over hand-set   ', f3(e.dLL), ' ', ci(c.dLL), '   <- gate A');
out('\nSpearman rho of a puzzle score with the cells the games wasted (u / T), held-out puzzles');
out('  new score (expected cells wasted)  ', fmt(e.rn), ' ', ci(c.rn));
out("  trapPredicted (today's grade)      ", fmt(e.rc), ' ', ci(c.rc));
out('  wrong moves per cell (no traps)    ', fmt(e.ra), ' ', ci(c.ra));
out("  new minus today's                  ", fmt(e.diff), ' ', ci(c.diff),
  `   <- gate B (>= ${RULE.minDeltaRho})`);

const say = {
  ACCEPT: 'the weights differ from the hand-set points and the new score predicts better',
  REJECT: 'the data give no reason to change the grade',
  'NO EVIDENCE YET': `no difference so far; ${RULE.confirmGames} games are needed to rule one out`,
  INCONCLUSIVE: `not enough data: ${res.games}/${RULE.minGames} games, ` +
    `${res.puzzles}/${RULE.minPuzzles} puzzles`,
  PARTIAL: res.gate.A
    ? 'only A: the weights differ from the hand-set points, the new score is not better than ' +
      "today's grade yet: update TRAP_CFG.points, then refit TRAP_MODEL (fit-trap.mjs --write)"
    : 'only B: the new score predicts better, its weights do not differ from the hand-set ones',
};
const yes = ok => (ok ? 'pass' : 'fail');
out('\nVERDICT ', res.verdict, ': ', say[res.verdict]);
out('  data ', res.gate.enough ? 'ok' : 'too few', ' | A ', yes(res.gate.A),
  ' | B ', yes(res.gate.B));
if (res.gate.A) {
  out('suggested TRAP_CFG.points = [', par.est.points.map(v => +v.toFixed(1)).join(', '),
    '] (from the free fit)');
}
