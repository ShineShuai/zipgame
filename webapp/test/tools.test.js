// Tests of the research tools (tools/*.mjs): fitting, simulation and evaluation scripts run by hand, some end to end in child
// processes (about 40 s together). They are not part of `npm test` or the pre-commit hook; run them with
//   npm run test:tools
// after a change to tools/ or to what they read (core/trap.js, features/playlog.js, tools/ratings.json).
import test from 'node:test';
import fs from 'node:fs';
import { parse } from '../src/core/format.js';
import { validate } from '../src/core/model.js';
import { solutionPath, trapProfile } from '../src/core/trap.js';
import { newTrace, traceTrack, traceEvents } from '../src/features/playlog.js';
import { parseArgs, helpText, ArgsError } from '../tools/args-lib.mjs';
import {
  stepsOfPuzzle, gamesOf, verdict, crossValidate, bucketOf, parameters,
} from '../tools/step-lib.mjs';
import { simulateRows, ratedPuzzles } from '../tools/step-sim.mjs';

const eq = (a, b, m = '') => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m} expected ${B} got ${A}`); };
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const t = (name, fn) => test(name, fn);
const ta = t;

ta('playlog-eval: runs end to end on a small play log and prints the metrics and the badge table', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const rated = JSON.parse(fs.readFileSync(new URL('../tools/ratings.json', import.meta.url))).filter(r => parse(r.key).n <= 6).slice(0, 6);
  ok(rated.length >= 4, 'the ratings hold enough small puzzles for the smoke test');
  const recs = rated.flatMap((r, i) => [0, 1].map(k => { const p = parse(r.key), T = p.n * p.n; return { v: 1, key: r.key, n: p.n, ms: 4000 + 900 * i + 300 * k, solved: true, hints: 0, mode: 'local', pushes: T + i, undone: i, maxUndone: i, backtracks: i ? 1 : 0, resets: 0, at: i * 2 + k + 1 }; }));
  recs.push({ ...recs[0], solved: false, at: 99 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlog-')), f = path.join(dir, 'playlog.json'); fs.writeFileSync(f, JSON.stringify(recs));
  const r = spawnSync(process.execPath, [new URL('../tools/playlog-eval.mjs', import.meta.url).pathname, f, '--cap', '20000', '--min-solved', '5'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(r.status, 0, r.stderr);
  ok(r.stdout.includes(`${recs.length} records`) && r.stdout.includes('1 abandoned') && r.stdout.includes('grade:trap') && r.stdout.includes('by Play badge'), r.stdout.slice(0, 400));
  ok(!/NaN|undefined/.test(r.stdout.replace(/—/g, '')), 'no NaN/undefined in the output');
});
ta('behaviour-eval: runs end to end on exported rows, fills Game-of-Day puzzles, skips bad rows',
  async () => {
    const fs = await import('node:fs'), os = await import('node:os');
    const path = await import('node:path'), { spawnSync } = await import('node:child_process');
    const ratings = JSON.parse(fs.readFileSync(new URL('../tools/ratings.json', import.meta.url)));
    const rated = ratings.filter(r => parse(r.key).n <= 6).slice(0, 8);
    ok(rated.length >= 6, 'the ratings hold enough small puzzles for the smoke test');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behaviour-eval-'));
    const gotd = path.join(dir, 'gotd'), f = path.join(dir, 'rows.json');
    fs.mkdirSync(gotd);
    const row = (i, kind, key, date) => ({
      where: 'turso', id: i, day: 20700 + i, ms: 4000 + 650 * i, u: (3 * i) % 7, deep: (3 * i) % 5,
      s: 0, pz: 'x', ev: null, v: 0, kind, skill: 7, date, key, bad: false,
    });
    const local = rated.flatMap((r, i) =>
      [0, 1].map(k => row(2 * i + k, 'local', r.key, '20261001')));
    const daily = rated.slice(0, 6).flatMap((r, i) => {
      const date = `2026100${i + 1}`;
      fs.writeFileSync(path.join(gotd, date + '.txt'), r.key);
      return [0, 1, 2].map(k => row(40 + 3 * i + k, k ? 'replay' : 'gotd', null, date));
    });
    const flagged = [{ ...local[0], id: 90, abandoned: true },
      { ...local[1], id: 91, abandoned: true },
      { ...local[2], id: 92, hint: true }];
    const withEv = local.map((r, i) => (i < 4 ? { ...r, events: [[3, 2]] } : r));
    const rows = [...withEv, ...daily, ...flagged, { ...local[0], bad: true }];
    fs.writeFileSync(f, JSON.stringify({ rows }));
    const tool = new URL('../tools/behaviour-eval.mjs', import.meta.url).pathname;
    const run = extra => spawnSync(process.execPath,
      [tool, f, '--cap', '20000', '--min-rows', '10', '--boot', '50', ...extra],
      { encoding: 'utf8' });
    const r = run(['--gotd-dir', gotd]), bare = run([]);
    fs.rmSync(dir, { recursive: true, force: true });
    eq(r.status, 0, r.stderr); eq(bare.status, 0, bare.stderr);
    ok(r.stdout.includes('=== local: 16 rows') && r.stdout.includes('=== daily: 18 rows')
      && r.stdout.includes('undecodable 1'), r.stdout.slice(0, 300));
    ok(r.stdout.includes('left out: abandoned 2, hint 1') && r.stdout.includes('abn%'),
      'flagged rows');
    ok(r.stdout.includes('wrong turns recorded for 4 of 16 rows'),
      'the wrong turns are summarised');
    ok(r.stdout.includes('Play badge rows 0..5') && r.stdout.includes('Spearman vs ln(s/cell)')
      && r.stdout.includes('size exponent'), 'badge table, metric table, time model printed');
    ok(bare.stdout.includes('without puzzle 18') && bare.stdout.includes('--gotd-dir')
      && !bare.stdout.includes('=== daily'), bare.stdout.slice(0, 300));
    ok(!/NaN|undefined/.test(r.stdout + bare.stdout), 'no NaN/undefined in the output');
  });
ta('calib-set: builds a block-balanced set; behaviour-eval groups it as "calib"', async () => {
  const fs = await import('node:fs'), os = await import('node:os');
  const path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-')), out = path.join(dir, 'set');
  const tool = new URL('../tools/calib-set.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath,
    [tool, '--out', out, '--plan', '5:2', '--cache', path.join(dir, 'pool')],
    { encoding: 'utf8' });
  eq(r.status, 0, r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  eq([index.v, index.sizes[5].length, index.block[5]], [1, 6, 3], '5x5: badges 0..2, 3 per block');
  const grade = Object.fromEntries(manifest.map(m => [m.file, m.grade]));
  eq(index.sizes[5].map(f => grade[f]).slice(0, 3).sort(), [0, 1, 2], 'block 1 holds every badge');
  eq(index.sizes[5].map(f => grade[f]).slice(3).sort(), [0, 1, 2], 'block 2 holds every badge');
  const texts = index.sizes[5].map(f => fs.readFileSync(path.join(out, f), 'utf8'));
  ok(texts.every(x => validate(parse(x)).ok), 'every file is a valid puzzle');
  eq(new Set(texts).size, 6, 'all different');
  ok(index.sizes[5].every(f => /^cal-5-\d{3}\.txt$/.test(f)), 'names carry no grade');
  // behaviour rows on two of its puzzles and on one other puzzle: groups calib / local
  const rated = JSON.parse(fs.readFileSync(new URL('../tools/ratings.json', import.meta.url)));
  const other = rated.find(r => parse(r.key).n === 6).key, row = (i, key) => ({
    where: 'turso', id: i, day: 20700 + i, ms: 3000 + 500 * i, u: i % 4, deep: i % 3, s: 0,
    pz: 'x',
    ev: null, v: 0, kind: 'local', skill: 7, date: '20261001', key, bad: false,
  });
  const rows = [...texts.slice(0, 4), other].flatMap((k, i) => [row(2 * i, k), row(2 * i + 1, k)]);
  const f = path.join(dir, 'rows.json'); fs.writeFileSync(f, JSON.stringify({ rows }));
  const evalTool = new URL('../tools/behaviour-eval.mjs', import.meta.url).pathname;
  const ev = spawnSync(process.execPath,
    [evalTool, f, '--calib-dir', out, '--min-rows', '5', '--boot', '20', '--cap', '20000'],
    { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(ev.status, 0, ev.stderr);
  ok(ev.stdout.includes('=== calib: 8 rows, 4 puzzles') && ev.stdout.includes('=== local: 2 rows'),
    ev.stdout.slice(0, 300));
  ok(!/NaN|undefined/.test(ev.stdout), 'no NaN/undefined in the output');
});
const stepRatings = new URL('../tools/ratings.json', import.meta.url).pathname;
t('step-lib: a wrong move of the trap profile, played, is the event at its step + 1', () => {
  const key = JSON.parse(fs.readFileSync(stepRatings, 'utf8')).find(r => parse(r.key).n === 7).key;
  const p = parse(key), sol = solutionPath(p), prof = trapProfile(p,
    sol), w = prof[prof.length >> 1];
  const tr = newTrace(), path = [...sol.slice(0, w.i + 1), w.cell];
  traceTrack(tr, path, sol); traceTrack(tr, path.slice(0, -1), sol);
  eq(traceEvents(tr), [[w.i + 1, 1]],
    'the player path left the solution after w.i + 1 right cells');
  const P = stepsOfPuzzle(key), at = P.steps.find(s => s.i === w.i);
  eq(at.c[bucketOf(w)] > 0, true, 'the step lists that wrong move in its bucket');
  const row = { key, events: [[w.i + 1, 1]], abandoned: false, hint: false, skill: 7, u: 1,
    deep: 1 };
  eq([...gamesOf([row], () => P).games[0].m], [[w.i, 1]],
    'and the game counts it at the profile step');
  eq(gamesOf([{ ...row, events: [[1000, 2]] }], () => P).unexplained, 1,
    'a step the profile lacks is unexplained');
});
t('step-lib: games the fit cannot use are counted by reason', () => {
  const key = JSON.parse(fs.readFileSync(stepRatings, 'utf8')).find(r => parse(r.key).n === 6).key;
  const P = stepsOfPuzzle(key), ok = { key, events: [], abandoned: false, hint: false, skill: 7,
    u: 0, deep: 0 };
  const rows = [ok, { ...ok, abandoned: true }, { ...ok, hint: true }, { ...ok, events: null },
    { ...ok, events: Array.from({ length: 31 }, () => [1, 1]) }, { ...ok, key: null }];
  const d = gamesOf(rows, k => (k ? P : null));
  eq([d.games.length, d.why.abandoned, d.why.hint, d.why.noEvents, d.why.capped, d.why.noPuzzle],
    [1, 1, 1, 1, 1, 1]);
});
t('step-fit: the fit finds the rates of simulated players, no difference when there is none',
  () => {
  const puzzles = ratedPuzzles(stepRatings, 40,
    1), steps = new Map(puzzles.map(x => [x.key, x.P]));
  eq(puzzles.length, 40);
  const games = truth => gamesOf(simulateRows(puzzles, truth, { games: 1500, seed: 3 }).rows,
    k => steps.get(k)).games;
  const steep = parameters(games('steep'), { boot: 0 }).est.points;
  ok(steep[3] > 8 && steep[3] < 17 && steep[0] > 0.3 && steep[0] < 0.7,
    'steep truth 0.5 : 1 : 3 : 12: ' + steep);
  const flat = parameters(games('flat'), { boot: 0 }).est.points;
  ok([flat[0], flat[2]].every(v => v > 0.7 && v < 1.4), 'flat truth 1 : 1 : 1 : 1: ' + flat);
  ok(flat[3] > 0.3 && flat[3] < 2.5, 'the capped bucket is thin on 40 puzzles: ' + flat[3]);
  const dll = truth => {
    const held = crossValidate(games(truth), { folds: 5, seed: 1 });
    return verdict(held, () => 0, { boot: 60 });
  };
  const same = dll('hand'), diff = dll('steep');
  ok(Math.abs(same.est.dLL) < 0.02 && !same.gate.A,
    'the hand-set shape is the truth: no gain, gate A fails');
  ok(diff.est.dLL > 0.03 && diff.gate.A,
    'other weights are the truth: the free rates win, gate A passes');
  eq(diff.gate.enough, true, '1500 games on 40 puzzles are enough data for the rule');
});
t('step-fit: an under-sized data set is INCONCLUSIVE, the written rule is in the header', () => {
  const puzzles = ratedPuzzles(stepRatings, 20,
    1), steps = new Map(puzzles.map(x => [x.key, x.P]));
  const games = gamesOf(simulateRows(puzzles, 'hand', { games: 150, seed: 2 }).rows,
    k => steps.get(k)).games;
  eq(verdict(crossValidate(games), () => 0, { boot: 20 }).verdict, 'INCONCLUSIVE');
  const head = fs.readFileSync(new URL('../tools/step-fit.mjs', import.meta.url), 'utf8').slice(0,
    4000);
  ok(head.includes('ACCEPTANCE RULE'));
  ok(head.includes('at least 200 games on at least 40 puzzles'));
});
ta('step-sim + step-fit: simulate rows, fit them from the command line', async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-')), f = path.join(dir, 'rows.json');
  const tool = n => new URL('../tools/' + n, import.meta.url).pathname;
  const sim = spawnSync(process.execPath,
    [tool('step-sim.mjs'), '--out', f, '--truth', 'steep', '--games', '450', '--puzzles', '45'],
    { encoding: 'utf8' });
  eq(sim.status, 0, sim.stderr);
  const fit = spawnSync(process.execPath,
    [tool('step-fit.mjs'), f, '--boot', '30', '--pboot', '10', '--cap',
      '20000'], { encoding: 'utf8' });
  const old = JSON.parse(fs.readFileSync(f, 'utf8')); old.rows.forEach(r => { r.events = null; });
  fs.writeFileSync(f, JSON.stringify(old));
  const none = spawnSync(process.execPath, [tool('step-fit.mjs'), f], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(fit.status, 0, fit.stderr);
  ok(/usable games \d+ on 4\d puzzles/.test(fit.stdout), fit.stdout.slice(0, 400));
  ok(['VERDICT', 'gate A', 'capped'].every(w => fit.stdout.includes(w)), 'report parts');
  const shown = fit.stdout.replace(/\[NaN[^\]]*\]/g, '');
  ok(!/NaN|undefined/.test(shown), 'no NaN/undefined outside empty intervals');
  ok(none.stdout.includes('Nothing to fit'),
    'rows without wrong-turn records: a plain message, no crash');
});
t('args-lib: options are declared once; parsed, checked, listed by --help', () => {
  const spec = {
    usage: 'node x.mjs rows.json [options]', summary: 'What it does.',
    positional: [{ name: 'rows.json', required: true, help: 'the rows' }],
    options: {
      boot: { type: 'int', arg: 'N', min: 1, max: 1000, default: 400, help: 'resamples' },
      seed: { type: 'number', arg: 'X', default: 1, help: 'the seed' },
      mode: { type: 'string', arg: 'NAME', choices: ['a', 'b'], default: 'a', help: 'the mode' },
      dir: { type: 'list', arg: 'DIR', help: 'folders' },
      quiet: { type: 'flag', help: 'less output' },
      out: { type: 'string', arg: 'FILE', required: true, help: 'the output' },
    },
  };
  const argv = ['--quiet', 'r.json', '--boot=50', '--dir', 'a', '--dir', 'b', '--out', 'o',
    '--seed', '-3'];
  const got = parseArgs(argv, spec);
  eq(got.values, { quiet: true, boot: 50, dir: ['a', 'b'], out: 'o', seed: -3, mode: 'a' });
  eq(got.rest, ['r.json'], 'a flag before the positional argument does not swallow it');
  eq(parseArgs(['r.json', '--out', 'o'], spec).values.boot, 400, 'defaults are filled in');
  eq(parseArgs(['--help'], spec).help, true);
  const bad = (argv, text) => {
    let msg = '';
    try { parseArgs(argv, spec); } catch (e) { ok(e instanceof ArgsError); msg = e.message; }
    ok(msg.includes(text), `${argv.join(' ')} -> ${msg}`);
  };
  bad(['r.json', '--out', 'o', '--bot', '5'], 'unknown option --bot');
  bad(['r.json', '--out', 'o', '--boot'], '--boot needs a value');
  bad(['r.json', '--out', 'o', '--boot', '--seed', '1'], '--boot needs a value');
  bad(['r.json', '--out', 'o', '--boot', 'x'], 'needs a number');
  bad(['r.json', '--out', 'o', '--boot', '2.5'], 'whole number');
  bad(['r.json', '--out', 'o', '--boot', '0'], 'at least 1');
  bad(['r.json', '--out', 'o', '--boot', '5000'], 'at most 1000');
  bad(['r.json', '--out', 'o', '--mode', 'c'], 'one of a, b');
  bad(['r.json', '--out', 'o', '--quiet=1'], 'takes no value');
  bad(['r.json'], '--out is required');
  bad(['--out', 'o'], 'rows.json is required');
  bad(['r.json', 'extra', '--out', 'o'], 'unexpected argument extra');
  const help = helpText(spec);
  ok(Object.keys(spec.options).every(k => help.includes('--' + k)), 'every option is listed');
  ok(help.includes('default 400') && help.includes('one of a | b'));
  ok(help.includes('may be repeated'));
});
ta('fit-trap: --points / --json / --target refit on other points and write a copy only',
  async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-trap-')), at = f => path.join(dir, f);
  const rated = JSON.parse(fs.readFileSync(stepRatings, 'utf8'));
  const sub = rated.filter(r => parse(r.key).n <= 8).slice(0, 24);
  fs.writeFileSync(at('r.json'), JSON.stringify(sub));
  const trapJs = new URL('../src/core/trap.js', import.meta.url).pathname;
  const before = createHash('sha1').update(fs.readFileSync(trapJs)).digest('hex');
  fs.copyFileSync(trapJs, at('trap-copy.mjs'));
  const run = extra => spawnSync(process.execPath,
    [new URL('../tools/fit-trap.mjs', import.meta.url).pathname,
    at('r.json'), '--cap', '100000', ...extra], { encoding: 'utf8' });
  const a = run(['--json', at('a.json')]);
  const b = run(['--points', '0,2,6,10', '--json', at('b.json')]);
  eq([a.status, b.status], [0, 0], a.stderr + b.stderr);
  const load = f => JSON.parse(fs.readFileSync(at(f), 'utf8'));
  const A = load('a.json'), B = load('b.json');
  eq([A.points, B.points], [[0, 1, 3, 5], [0, 2, 6, 10]]);
  eq(A.model.features, ['trapMax', 'trapTop3', 'altFrac', 'lTr']);
  ok(Math.abs(B.model.mean.trapMax / A.model.mean.trapMax - 2) < 1e-3,
    'twice the points, twice the trap scores');
  eq([B.model.cuts, B.loo.rho], [A.model.cuts, A.loo.rho],
    'the standardised model does not care for the scale');
  const bad = run(['--points', '1,2,3']);
  eq(bad.status, 1, 'three numbers are not four points');
  const w = run(['--points', '0,2.5,6,10', '--write', '--target', at('trap-copy.mjs')]);
  eq(w.status, 0, w.stderr);
  const text = fs.readFileSync(at('trap-copy.mjs'), 'utf8');
  ok(/points: \[0, 2\.5, 6, 10\]/.test(text) && text.includes('// <TRAP_MODEL>'),
    'points and model written to the copy');
  const check = spawnSync(process.execPath, ['--check', at('trap-copy.mjs')],
    { encoding: 'utf8' });
  eq(check.status, 0, 'the rewritten copy still parses: ' + check.stderr);
  eq(createHash('sha1').update(fs.readFileSync(trapJs)).digest('hex'), before,
    'src/core/trap.js untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});
ta('apply-points: refuses without gate A, shows the change, writes only a copy on --write',
  async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-')), at = f => path.join(dir, f);
  const tool = n => new URL('../tools/' + n, import.meta.url).pathname;
  const node = (...args) => spawnSync(process.execPath, args,
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rated = JSON.parse(fs.readFileSync(stepRatings, 'utf8'));
  const sub = rated.filter(r => parse(r.key).n <= 8).slice(0, 24);
  fs.writeFileSync(at('r.json'), JSON.stringify(sub));
  const trapJs = new URL('../src/core/trap.js', import.meta.url).pathname;
  const sha = f => createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const before = sha(trapJs);
  fs.copyFileSync(trapJs, at('trap-copy.mjs'));
  const sim = (truth, games) => node(tool('step-sim.mjs'), '--out', at(truth + '.json'),
    '--truth', truth,
    '--games', String(games), '--puzzles', '40').status;
  eq([sim('hand', 600), sim('steep', 1500)], [0, 0]);
  const common = ['--boot', '20', '--pboot', '5', '--cap', '100000', '--ratings', at('r.json')];
  const refused = node(tool('apply-points.mjs'), at('hand.json'), ...common, '--target',
    at('trap-copy.mjs'));
  eq(refused.status, 1, refused.stderr);
  ok(refused.stdout.includes('Refused'), refused.stdout);
  ok(refused.stdout.includes('Use --force for a dry run anyway'), 'the way out is named');
  const both = node(tool('apply-points.mjs'), at('hand.json'), ...common, '--force', '--write',
    '--target', at('trap-copy.mjs'));
  eq(both.status, 1, 'the rule cannot be forced into --write');
  ok(both.stdout.includes('never overrides the rule'), both.stdout);
  const copyBefore = sha(at('trap-copy.mjs'));
  const dry = node(tool('apply-points.mjs'), at('steep.json'), ...common, '--target',
    at('trap-copy.mjs'));
  eq(dry.status, 0, dry.stderr + dry.stdout);
  ok(dry.stdout.includes('gate A pass') && dry.stdout.includes('from the wrong turns'),
    dry.stdout.slice(0, 500));
  ok(dry.stdout.includes('human ratings (leave-one-out'), 'before/after on the ratings');
  ok(dry.stdout.includes('behaviour rows, local'), 'before/after on the behaviour rows');
  ok(dry.stdout.includes('Dry run: nothing written'), 'a dry run says so');
  eq(sha(at('trap-copy.mjs')), copyBefore, 'the dry run wrote nothing');
  const done = node(tool('apply-points.mjs'), at('steep.json'), ...common, '--write', '--target',
    at('trap-copy.mjs'));
  eq(done.status, 0, done.stderr + done.stdout);
  ok(done.stdout.includes('wrote TRAP_MODEL and TRAP_CFG.points'), done.stdout);
  ok(done.stdout.includes('Now, by hand'), 'the checklist follows');
  const text = fs.readFileSync(at('trap-copy.mjs'), 'utf8');
  ok(!text.includes('points: [0, 1, 3, 5]'), 'the old points are gone');
  ok(/points: \[0\.\d+, 1, /.test(text), 'the copy has the new points');
  eq(node('--check', at('trap-copy.mjs')).status, 0, 'and still parses');
  eq(sha(trapJs), before, 'src/core/trap.js untouched');
  ok(!/NaN|undefined/.test(dry.stdout.replace(/\[NaN[^\]]*\]/g, '')), 'no NaN/undefined');
  fs.rmSync(dir, { recursive: true, force: true });
});
