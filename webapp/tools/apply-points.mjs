// Apply the trap points the players' wrong turns call for: check the acceptance rule, show what it
// would change, and (only with --write) rewrite the grade, in one reviewable step.
//   node tools/apply-points.mjs rows.json [options]        (--help explains every option)
// rows.json = `node tools/behaviour.mjs export --out rows.json` (row version 1: the wrong turns).
//
// What it does:
//   1. step-fit: fits the rate of a wrong move per trap bucket and judges it with the acceptance
//   rule of
//      tools/step-fit.mjs. A change is allowed only with enough data (RULE) and gate A passed: the
//      free
//      bucket rates predict held-out wrong turns better than the hand-set points 0/1/3/5.
//      Otherwise it
//      stops ("Refused"); --force only lets the DRY RUN go on, --write never overrides the rule.
//   2. The new points are the cells a wrong move of each bucket wastes, shallow = 1 (the `points`
//   line
//      of the fit). The trap grade is a ridge model over features computed with the points, so it
//      is
//      refitted on the human ratings (tools/fit-trap.mjs --points ...), cut points included.
//   3. It prints, before and after: the leave-one-out agreement with the human ratings, and, for
//   the
//      behaviour rows, how well the grade score ranks the games by time, cells taken back, deepest
//      take-back and stuck games (with 95% intervals over puzzles) and how many puzzles get each
//      badge.
//      The behaviour figures are in-sample (the points came from the wrong turns of these games):
//      the
//      honest held-out test is gate B of step-fit; this shows what the change does to the whole
//      picture.
//   4. With --write: rewrites TRAP_CFG.points and the TRAP_MODEL block of src/core/trap.js
//   (--target: a
//      copy) through fit-trap.mjs --write, then lists what to redo by hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from '../src/core/format.js';
import { cellCount } from '../src/core/model.js';
import {
  solutionPath, trapProfile, trapMetricsFromProfile, ladderTrials, TRAP_CFG, TRAP_MODEL,
} from '../src/core/trap.js';
import { makeRng } from '../src/core/rng.js';
import { cli } from './args-lib.mjs';
import { OFFLINE_TRAP_CFG } from './lib.mjs';
import { readRows, isPlain } from './rows-lib.mjs';
import { FIT_OPTIONS, RULE, stepsOfPuzzle, analyse, parameters } from './step-lib.mjs';
import { spearman, resampleClusters, interval, fmt, pct } from './stats-lib.mjs';

const { values: o, rest } = cli({
  usage: 'node tools/apply-points.mjs rows.json [options]',
  summary: 'Check the acceptance rule of step-fit, show what the trap points found in the ' +
    'players\' wrong turns would change in the grade (human ratings and behaviour rows), and ' +
    'with --write rewrite TRAP_CFG.points and TRAP_MODEL in src/core/trap.js. Without --write ' +
    'nothing is written.',
  positional: [{ name: 'rows.json', required: true,
    help: 'the export of `node tools/behaviour.mjs export --out rows.json` (row version 1)' }],
  options: {
    ...FIT_OPTIONS,
    ratings: { type: 'string', arg: 'FILE', defaultText: 'tools/ratings.json',
      help: 'the human ratings the grade model is refitted on (the file of fit-trap.mjs)' },
    stuck: { type: 'number', arg: 'F', min: 0.01, max: 1, default: 0.3,
      help: 'a game counts as "stuck" when its deepest single take-back is at least F x the ' +
        'cells of the board (as behaviour-eval --stuck)' },
    write: { type: 'flag',
      help: 'rewrite TRAP_CFG.points and the TRAP_MODEL block of trap.js; without it nothing is ' +
        'written (dry run). Needs enough data and gate A; --force does not override that' },
    force: { type: 'flag',
      help: 'go on with the dry run although the rule does not allow a change' },
    target: { type: 'string', arg: 'FILE', defaultText: 'src/core/trap.js',
      help: 'the trap.js that --write rewrites; to try it on a copy first' },
  },
});
const out = (...parts) => console.log(parts.join(''));
const ratingsFile = o.ratings ?? new URL('./ratings.json', import.meta.url).pathname;
const fitTrap = new URL('./fit-trap.mjs', import.meta.url).pathname;

// ---------- the puzzles, graded by the grade of today and by a candidate ----------
const infos = new Map(), stepCache = new Map();
function puzzleInfo(key) {
  if (!infos.has(key)) {
    const p = parse(key), p0 = solutionPath(p, OFFLINE_TRAP_CFG.pathCap);
    infos.set(key, p0 ? {
      p, path: p0, T: cellCount(p), profile: trapProfile(p, p0, OFFLINE_TRAP_CFG),
      ladTrials: ladderTrials(p, OFFLINE_TRAP_CFG),
    } : null);
  }
  return infos.get(key);
}
const metrics = (key, cfg, model) => {
  const I = puzzleInfo(key);
  return trapMetricsFromProfile(I.p, I.path, I.profile, cfg, I.ladTrials, model);
};
const stepsFor = key => {
  if (!stepCache.has(key)) stepCache.set(key, stepsOfPuzzle(key, o.cap));
  return stepCache.get(key);
};

// ---------- 1. the rule ----------
const rows = readRows(rest[0], { gotdDir: o['gotd-dir'] });
const current = key => metrics(key, OFFLINE_TRAP_CFG, TRAP_MODEL).predicted;
const { data, res } = analyse(rows, stepsFor, current,
  { folds: o.folds, boot: o.boot, seed: o.seed, useSkill: !o['no-skill'] });
if (!data.games.length) {
  out('No game with wrong-turn events in ', rest[0], ': nothing to apply (needs row version 1).');
  process.exit(1);
}
const par = parameters(data.games, { boot: o.pboot, seed: o.seed });
const yes = ok => (ok ? 'pass' : 'fail');
out(`step-fit rule: ${res.games} games on ${res.puzzles} puzzles (needs ${RULE.minGames} / ` +
  `${RULE.minPuzzles}) | data ${res.gate.enough ? 'ok' : 'too few'} | ` +
  `gate A ${yes(res.gate.A)} | gate B ${yes(res.gate.B)} -> ${res.verdict}`);
const points = par.est.points.map(v => +v.toFixed(2));
const ci = c => `[${fmt(c[0]).trim()}, ${fmt(c[1]).trim()}]`;
out('\ntrap points (shallow = 1)   obvious  shallow  deep   capped');
out('  now                       ', TRAP_CFG.points.map(v => String(v).padStart(7)).join('  '));
out('  from the wrong turns      ', points.map(v => v.toFixed(2).padStart(7)).join('  '));
out('  95% interval              ', par.ci.points.map(c => ci(c).padStart(7)).join('  '));
if (points.some((v, i) => i && v < points[i - 1])) {
  out('  WARNING: the points do not rise with the depth of the trap;',
    ' look at step-fit before applying.');
}
const allowed = res.gate.enough && res.gate.A;
if (!allowed) {
  out('\nRefused: a change needs enough data and gate A (the free bucket rates beat the hand-set ',
    'points on held-out wrong turns).');
  if (!o.force || o.write) {
    out(o.write && o.force ? '--write never overrides the rule.'
      : 'Use --force for a dry run anyway.');
    process.exit(1);
  }
  out('--force: the dry run goes on, nothing will be written.');
}

// ---------- 2. before / after on the human ratings ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-points-'));
const runFit = (name, extra) => {
  const json = path.join(tmp, name + '.json');
  const r = spawnSync(process.execPath,
    [fitTrap, ratingsFile, '--cap', String(o.cap), '--json', json, ...extra],
    { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) {
    console.error(r.stdout + r.stderr);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(json, 'utf8'));
};
const was = runFit('now', []), will = runFit('new', ['--points', points.join(',')]);
const frac = a => `${a[0]}/${a[1]}`.padStart(7);
const row2 = (label, a, b) => out(`  ${label.padEnd(38)} ${a.padStart(8)}  ${b.padStart(8)}`);
out(`\nhuman ratings (leave-one-out, ${was.loo.n} of ${was.loo.of} rated puzzles)`);
out('                                           now       new');
row2('Spearman rho of the score', was.loo.rho.toFixed(2), will.loo.rho.toFixed(2));
row2('mean absolute error of the badge', was.loo.mae.toFixed(2), will.loo.mae.toFixed(2));
row2('rated <= 0.5 shown as badge 0', frac(was.loo.anchors.easy), frac(will.loo.anchors.easy));
row2('rated >= 3.5 shown as badge >= 3', frac(was.loo.anchors.hard3),
  frac(will.loo.anchors.hard3));
row2('badges produced 0..5', was.loo.badges.join('/'), will.loo.badges.join('/'));
row2('cut points of the grade', was.model.cuts.join(' '), will.model.cuts.join(' '));

// ---------- 3. before / after on the behaviour rows ----------
const newCfg = { ...OFFLINE_TRAP_CFG, points };
const games = rows.filter(r => isPlain(r) && r.key && puzzleInfo(r.key)).map(r => {
  const T = puzzleInfo(r.key).T, a = metrics(r.key, OFFLINE_TRAP_CFG, TRAP_MODEL);
  const b = metrics(r.key, newCfg, will.model);
  return {
    key: r.key, group: r.kind === 'local' ? 'local' : 'daily', was: a, now: b,
    y: [Math.log(r.ms / 1000 / T), r.u / T, r.deep / T, r.deep / T >= o.stuck ? 1 : 0],
  };
});
const labels = ['ln(s per cell)', 'cells taken back (u/T)', 'deepest take-back (deep/T)',
  `stuck (deep >= ${o.stuck} T)`];
for (const name of ['local', 'daily']) {
  const g = games.filter(x => x.group === name), keys = [...new Set(g.map(x => x.key))];
  if (g.length < 20) {
    out(`\nbehaviour rows, ${name}: ${g.length} games, too few to compare`);
    continue;
  }
  const idx = keys.map(() => []);
  g.forEach((x, i) => idx[keys.indexOf(x.key)].push(i));
  const rnd = makeRng(o.seed + 7);
  const stat = ix => labels.map((_, l) => {
    const y = ix.map(i => g[i].y[l]), a = spearman(ix.map(i => g[i].was.predicted), y);
    return [a, spearman(ix.map(i => g[i].now.predicted), y)];
  });
  const all = stat(g.map((_, i) => i));
  const draws = Array.from({ length: o.boot }, () => stat(resampleClusters(idx, rnd)));
  out(`\nbehaviour rows, ${name} (${g.length} games on ${keys.length} puzzles):`,
    ' Spearman rho of the grade score with what the players did');
  out('                                    now     new    new - now [95% CI over puzzles]');
  labels.forEach((label, l) => {
    const d = draws.map(s => s[l][1] - s[l][0]), diff = all[l][1] - all[l][0];
    out(`  ${label.padEnd(30)} ${fmt(all[l][0])} ${fmt(all[l][1])}   ${fmt(diff)}  `,
      ci(interval(d, o.boot)));
  });
  const count = k => [0, 1, 2, 3, 4, 5].map(b => g.filter(x => x[k].grade === b).length).join('/');
  out('  games per badge 0..5: now ', count('was'), ' | new ', count('now'));
}
out('\nThe behaviour figures are in-sample: the points were fitted to the wrong turns of ',
  'these games.');
const e = res.est, c = res.ci;
out(`Held out (gate B), rho with the cells taken back: today's grade score ${fmt(e.rc).trim()}, `,
  `expected-waste score of the step model ${fmt(e.rn).trim()} (difference ${fmt(e.diff).trim()} `,
  `${ci(c.diff)}).`);
if (e.diff >= RULE.minDeltaRho) {
  out('Note: the step model ranks the games better than the grade does, and new points alone');
  out('move the grade less than that: the grade is a ridge model over the worst steps (trapMax,');
  out('trapTop3, altFrac, lTr), the step model sums the cost of all wrong moves. A grade');
  out('feature built on that sum would carry the rest; it is not part of this tool.');
}

// ---------- 4. write ----------
if (!o.write) {
  out('\nDry run: nothing written. Rerun with --write to rewrite TRAP_CFG.points and ',
    'TRAP_MODEL in ', o.target ?? 'src/core/trap.js', '.');
} else {
  const args = [fitTrap, ratingsFile, '--cap', String(o.cap), '--points', points.join(','),
    '--write'];
  if (o.target) args.push('--target', o.target);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) {
    console.error(r.stdout + r.stderr);
    process.exit(1);
  }
  out('\n', r.stdout.trim().split('\n').pop());
  out('Now, by hand:');
  out('  1. node test/tests.js: tests that pin a grade or the points need new expected values.');
  out('  2. Regenerate what is keyed to the badge: tools/gotd-fit.mjs (maps it onto the human');
  out('     scale), the calibration set (tools/calib-set.mjs: chosen by the old badge).');
  out('  3. Rebuild and deploy. Rows already collected keep their puzzles, so behaviour-eval can');
  out('     regrade them: compare old and new badges on the same rows.');
}
fs.rmSync(tmp, { recursive: true, force: true });
