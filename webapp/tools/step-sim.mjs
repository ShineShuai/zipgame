// Simulated players for tools/step-fit.mjs: to check that the fit finds what is there (and nothing
// when nothing is), and to learn how many games it needs.
//   node tools/step-sim.mjs --out rows.json [options]    simulate games, write the rows
//   node tools/step-sim.mjs --power [options]            simulate + fit again and again
// (--help explains every option.)
// The puzzles are those of tools/ratings.json (sizes 6-11). A simulated game faces every step of
// its puzzle's solution; at a step with wrong moves it takes m of them (geometric, mean h = the
// sum of the rates of the moves by bucket, see step-lib.mjs), each one walking on some cells
// before it is taken back. Truths = the cells a wrong move of each bucket wastes (obvious :
// shallow : deep : capped), the rate being that divided by the walk length (1.5 / 3 / 7 / 14
// cells):
//   hand     0.25 : 1.25 : 3.25 : 5.25  the hand-set trap points 0/1/3/5 plus a floor
//   flat     1 : 1 : 1 : 1              every wrong move costs the same
//   steep    0.5 : 1 : 3 : 12           deep and capped traps cost much more than the points say
//   obvious  2 : 1.5 : 2 : 3            the obvious moves cost as much as the deep ones
// --events: the mean number of wrong turns per game (the rates are scaled to it), --sigma: spread
// of the players (log-normal); the skill bucket moves the rate too (effect 0.3 per 3 buckets).
// Rows come out in the shape of the behaviour export, so step-fit.mjs reads them as real ones.
// --power: simulate + fit again and again; prints how often each gate passes per number of games
// (the false alarms under `hand`, the detections under the others). --params adds the fitted
// points of one run with the most games against the truth.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeRng, shuffle } from '../src/core/rng.js';
import { EV_MAX_EVENTS } from '../src/core/behaviour.js';
import { featuresOf } from './features.mjs';
import { cli, capOption } from './args-lib.mjs';
import { stepsOfPuzzle, analyse, parameters } from './step-lib.mjs';
import { median, sum } from './stats-lib.mjs';

export const TRUTHS = {
  hand: [0.25, 1.25, 3.25, 5.25],
  flat: [1, 1, 1, 1],
  steep: [0.5, 1, 3, 12],
  obvious: [2, 1.5, 2, 3],
};
export const WALK = [1.5, 3, 7, 14];
const GAMMA = 0.3;

// failures before the first success when each try fails with probability h / (1 + h)
const geom = (h, rnd) => (h > 0 ? Math.floor(Math.log(1 - rnd()) / Math.log(h / (1 + h))) : 0);
const normal = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// puzzles: [{ key, P }] (P = stepsOfPuzzle). -> rows in the shape of the behaviour export.
export function simulateRows(puzzles, truth, opts = {}) {
  const { games = 400, events = 3, sigma = 0.5, seed = 1 } = opts;
  const rnd = makeRng(seed), rel = TRUTHS[truth];
  if (!rel) throw new Error('unknown truth ' + truth);
  const rate = rel.map((v, b) => v / WALK[b]);
  const perGame = puzzles.map(({ P }) =>
    sum(P.steps.map(st => sum(st.c.map((c, b) => c * rate[b])))));
  const scale = events / (sum(perGame) / puzzles.length);
  const lambda = rate.map(v => v * scale), order = shuffle(puzzles.map((_, i) => i), rnd);
  const rows = [];
  for (let g = 0; g < games; g++) {
    const { key, P } = puzzles[order[g % puzzles.length]];
    const known = rnd() > 0.15;
    const skill = known ? Math.min(14, Math.max(0, Math.round(7 + 1.5 * normal(rnd)))) : 15;
    const s = known ? (skill - 7) / 3 : 0;
    const theta = Math.exp(GAMMA * s + sigma * normal(rnd) - sigma * sigma / 2);
    const ev = [];
    let u = 0, deep = 0;
    for (const st of P.steps) {
      const w = st.c.map((c, b) => c * lambda[b]), total = sum(w);
      for (let m = geom(theta * total, rnd); m > 0; m--) {
        let x = rnd() * total, b = 0;
        while (b < 3 && x >= w[b]) x -= w[b++];
        const d = Math.min(P.T - st.i - 1, 1 + geom(WALK[b] - 1, rnd));
        u += d;
        deep = Math.max(deep, d);
        if (ev.length < EV_MAX_EVENTS) ev.push([st.i + 1, d]);
      }
    }
    const ms = Math.round(1000 * (0.3 * P.T + u) * Math.exp(0.3 * normal(rnd)));
    rows.push({
      where: 'sim', id: g + 1, day: 20800 + (g % 30), ms: Math.max(600, ms), u, deep, s: 0,
      pz: null, ev: null, v: 1, kind: 'local', skill, date: '20261101', key, bad: false,
      hint: false, abandoned: false, events: ev,
    });
  }
  return { rows, lambda };
}

// the puzzles of the ratings: [{ key, P }], those with wrong moves, `count` of them (seeded)
export function ratedPuzzles(file, count, seed, cap) {
  const rated = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = shuffle([...new Set(rated.map(r => r.key))], makeRng(seed));
  const out = [];
  for (const key of keys) {
    if (out.length >= count) break;
    const P = stepsOfPuzzle(key, cap);
    if (P && P.n >= 6 && P.n <= 11 && P.steps.length >= 5) out.push({ key, P });
  }
  return out;
}

// ---------- command line ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: o } = cli({
    usage: 'node tools/step-sim.mjs (--out FILE | --power) [options]',
    summary: 'Simulated players for step-fit.mjs. --out writes simulated rows (the shape of the ' +
      'behaviour export); --power repeats simulate + fit and prints how often each gate of the ' +
      'acceptance rule passes for several numbers of games.',
    options: {
      out: { type: 'string', arg: 'FILE', help: 'write the simulated rows to this file' },
      power: { type: 'flag',
        help: 'run the power study: simulate and fit again and again; with --truth hand the ' +
          'passes are false alarms, with another truth they are detections' },
      params: { type: 'flag',
        help: '(with --power) also print the fitted points of one run with the largest number ' +
          'of games next to the true ones' },
      truth: { type: 'string', arg: 'NAME', choices: Object.keys(TRUTHS), default: 'hand',
        help: 'the cells a wrong move of each bucket wastes, obvious : shallow : deep : ' +
          'capped. hand = 0.25:1.25:3.25:5.25 (the hand-set points 0/1/3/5 plus a floor), flat ' +
          '= 1:1:1:1, steep = 0.5:1:3:12, obvious = 2:1.5:2:3' },
      games: { type: 'string', arg: 'N|LIST',
        defaultText: '400 with --out, 100,200,400,800 with --power',
        help: 'games to simulate: one number with --out, a comma list of sizes with --power' },
      puzzles: { type: 'int', arg: 'N', min: 1, default: 60,
        help: 'how many puzzles of ratings.json (sizes 6-11) the games are played on' },
      events: { type: 'number', arg: 'X', min: 0.1, default: 3,
        help: 'mean wrong turns per simulated game (the rates are scaled to it)' },
      sigma: { type: 'number', arg: 'X', min: 0, default: 0.5,
        help: 'spread of the players (log-normal); 0 = all players alike' },
      reps: { type: 'int', arg: 'N', min: 1, default: 20,
        help: '(with --power) simulations for each number of games' },
      boot: { type: 'int', arg: 'N', min: 1, default: 100,
        help: '(with --power) bootstrap resamples per simulation, as step-fit --boot' },
      seed: { type: 'int', arg: 'N', default: 1,
        help: 'seed of the simulation and of the choice of puzzles: the same seed gives the ' +
          'same rows' },
      ratings: { type: 'string', arg: 'FILE', defaultText: 'tools/ratings.json',
        help: 'the file whose puzzles are used (a list of { key } with the puzzle text)' },
      cap: capOption,
    },
  });
  if (Boolean(o.out) === Boolean(o.power)) {
    console.error('step-sim: give exactly one of --out FILE and --power (see --help)');
    process.exit(1);
  }
  const out = (...parts) => console.log(parts.join(''));
  const truth = o.truth, seed = o.seed, cap = o.cap;
  const ratings = o.ratings ?? new URL('./ratings.json', import.meta.url).pathname;
  const puzzles = ratedPuzzles(ratings, o.puzzles, seed, cap);
  const sim = { events: o.events, sigma: o.sigma };
  const sizes = (o.games ?? (o.out ? '400' : '100,200,400,800')).split(',').map(Number);
  if (!sizes.every(n => Number.isInteger(n) && n >= 1) || (o.out && sizes.length !== 1)) {
    console.error('step-sim: --games needs one whole number with --out, a list with --power');
    process.exit(1);
  }
  console.error(`${puzzles.length} puzzles, truth ${truth}`);
  if (o.out) {
    const { rows, lambda } = simulateRows(puzzles, truth, { ...sim, games: sizes[0], seed });
    const meta = { truth, lambda, walk: WALK, gamma: GAMMA };
    fs.writeFileSync(o.out, JSON.stringify({ sim: meta, rows }));
    console.error(`wrote ${rows.length} rows to ${o.out}`);
  } else {
    const reps = o.reps, boot = o.boot, trap = new Map();
    const steps = new Map(puzzles.map(p => [p.key, p.P]));
    const stepsFor = key => steps.get(key);
    const current = key => {
      if (!trap.has(key)) trap.set(key, featuresOf({ key }, cap).trapPredicted);
      return trap.get(key);
    };
    const rel = TRUTHS[truth], ratio = rel.map(v => v / rel[1]);
    out(`truth ${truth}: points relative to shallow = `, ratio.map(v => v.toFixed(2)).join(' : '));
    out('games  reps  A pass  B pass  ACCEPT  REJECT  dLL/game (median [95% low])',
      '  rho new / current');
    for (const games of sizes) {
      const r = { A: 0, B: 0, acc: 0, rej: 0, d: [], lo: [], rn: [], rc: [] };
      for (let rep = 0; rep < reps; rep++) {
        const { rows } = simulateRows(puzzles, truth, { ...sim, games, seed: seed * 1000 + rep });
        const { res } = analyse(rows, stepsFor, current, { boot, seed: rep + 1 });
        r.A += res.gate.A;
        r.B += res.gate.B;
        r.acc += res.verdict === 'ACCEPT';
        r.rej += res.verdict === 'REJECT';
        r.d.push(res.est.dLL);
        r.lo.push(res.ci.dLL[0]);
        r.rn.push(res.est.rn);
        r.rc.push(res.est.rc);
      }
      const p = v => `${Math.round(100 * v / reps)}%`.padStart(6);
      out(String(games).padStart(5), ' ', String(reps).padStart(5), '  ', p(r.A), '  ', p(r.B),
        '  ', p(r.acc), '  ', p(r.rej), '  ', median(r.d).toFixed(3),
        ' [', median(r.lo).toFixed(3), ']  ', median(r.rn).toFixed(2), ' / ',
        median(r.rc).toFixed(2));
    }
    if (o.params) {
      const { rows } = simulateRows(puzzles, truth, { ...sim, games: sizes.at(-1), seed });
      const games = analyse(rows, stepsFor, current, { boot: 10 }).data.games;
      const q = parameters(games, { boot: 100 });
      out('points (relative to shallow), estimate [95% CI] vs truth:');
      q.est.points.forEach((v, b) => {
        const c = q.ci.points[b].map(x => x.toFixed(2)).join(', ');
        out(`  bucket ${b}: ${v.toFixed(2)} [${c}]  truth ${ratio[b].toFixed(2)}`);
      });
    }
  }
}
