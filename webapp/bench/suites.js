// Benchmark suites as data + run functions. Used by bench.js (Node and browser).
// Gate regressions on deterministic metrics (nodes, walls, K); ms is machine-dependent.
//
// rev: bump a suite's `rev` whenever what it measures changes in a way its `spec` cannot show
// (different measured code path, instance construction, timing method). Cases, seeds, caps and
// options are captured in `spec` automatically; the report compares only cells whose spec and rev match.
import { makePuzzle, ALGO_VERSION } from '../src/core/model.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { allEdges, edgeId, setWallId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { solve } from '../src/core/solver/solve.js';
import { generate, PLAY_SIZES, CANDIDATES } from '../src/core/gen/generate.js';
import { runSync } from '../src/core/run.js';
import { hash } from './results.js';

const pad = (value, width) => String(value).padStart(width);
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const sum = values => values.reduce((total, v) => total + v, 0);

// ---- measurement: first run is the warm-up sample; repeat fast runs, record min and median ----
const TARGET_MS = 100;
const MAX_REPS = 15;
const SLOW_MS = 500;

function timeOnce(f) {
  const t = performance.now();
  const value = f();
  return [value, performance.now() - t];
}

export function measure(f) {
  const [value, first] = timeOnce(f);
  const samples = [first];
  let spent = first;
  while (first < SLOW_MS && samples.length < MAX_REPS && spent < TARGET_MS) {
    const [, ms] = timeOnce(f);
    samples.push(ms);
    spent += ms;
  }
  samples.sort((a, b) => a - b);
  const round = x => Math.round(x * 1000) / 1000;
  return { value, ms: round(samples[0]), msMed: round(samples[Math.floor(samples.length / 2)]) };
}

// random path puzzle + random non-anchor walls
export function instance(seed, n, K, wallFrac) {
  const rnd = makeRng(seed);
  const T = n * n;
  const path = backbite(n, rnd);
  const mid = [];
  for (let i = 1; i < T - 1; i++) {
    mid.push(i);
  }
  const pos = [0, ...shuffle(mid, rnd).slice(0, K - 2).sort((a, b) => a - b), T - 1];
  const p = makePuzzle(n);
  pos.forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });
  const anchor = new Set();
  for (let i = 1; i < T; i++) {
    anchor.add(edgeId(n, path[i - 1], path[i]));
  }
  const free = allEdges(n).filter(e => !anchor.has(e));
  const count = Math.floor(wallFrac * (2 * n * (n - 1) - T + 1));
  shuffle(free, rnd).slice(0, count).forEach(e => setWallId(p.walls, e, true));
  return p;
}

const fingerprint = p => hash([Array.from(p.cp), Array.from(p.walls)]);
const sameSearch = (a, b) => a.count === b.count && JSON.stringify(a.paths) === JSON.stringify(b.paths);
const rowOf = (c, s, v, m, flags = {}) => ({ c, s, v, m, ...flags });
const timing = r => ({ ms: r.ms, msMed: r.msMed });

// ---- solver: plain vs prune2 / prop / seg / prop+seg ----
const SOLVER_CAP = 300000;
const SOLVER_CASES = [[7, 6, .3], [7, 6, .6], [9, 6, .3], [9, 8, .5], [11, 8, .5]];
const SOLVER_SEEDS = [1, 2, 3, 4, 5];
const SOLVER_VARIANTS = {
  base: {},
  prune2: { prune2: true },
  prop: { prop: true, capture: true },
  seg: { seg: true, capture: true },
  'prop+seg': { prop: true, seg: true, capture: true },
};
const solverCase = (n, K, wf) => `n=${n} K=${K} wall=${Math.round(wf * 100)}%`;

function runSolver() {
  const rows = [];
  const cases = {};
  for (const [n, K, wf] of SOLVER_CASES) {
    const c = solverCase(n, K, wf);
    const prints = [];
    for (const s of SOLVER_SEEDS) {
      const p = instance(s * 101 + n, n, K, wf);
      prints.push(fingerprint(p));
      solve(p, { nodeCap: 20000 });
      const done = {};
      for (const [name, options] of Object.entries(SOLVER_VARIANTS)) {
        const r = measure(() => solve(p, { nodeCap: SOLVER_CAP, ...options }));
        done[name] = r;
        rows.push(rowOf(c, s, name, { nodes: r.value.nodes, ...timing(r) }, r.value.exceeded ? { cap: 1 } : {}));
      }
      if (done.base.value.exceeded) {
        continue;
      }
      const reference = solve(p, { nodeCap: SOLVER_CAP, capture: true });
      for (const name of ['prop', 'seg', 'prop+seg']) {
        const r = done[name].value;
        if (!sameSearch(reference, r) || r.nodes > done.base.value.nodes) {
          rows.find(row => row.c === c && row.s === s && row.v === name).bad = 1;
        }
      }
    }
    cases[c] = { n, K, wall: wf, seeds: SOLVER_SEEDS, inputs: hash(prints) };
  }
  return { rows, spec: { common: { nodeCap: SOLVER_CAP, limit: 2 }, cases, variants: SOLVER_VARIANTS } };
}

function solverText(rows) {
  const lines = ['SOLVER  (limit 2, nodeCap 300000)   n  K wall%   base: nodes ms n/ms   | prune2: nodes ms | prop: nodes ms  vs base%  same-solutions | seg: nodes ms  vs base%  same-solutions | prop+seg: nodes ms  vs base%  same-solutions'];
  for (const [n, K, wf] of SOLVER_CASES) {
    const c = solverCase(n, K, wf);
    const of = v => rows.filter(r => r.c === c && r.v === v);
    const nodes = v => sum(of(v).map(r => r.m.nodes));
    const ms = v => sum(of(v).map(r => r.m.ms));
    const compared = of('base').filter(r => !r.cap).length;
    const block = v => {
      const same = compared - of(v).filter(r => r.bad).length;
      const pct = (100 * (nodes(v) / nodes('base') - 1)).toFixed(1);
      return `${pad(nodes(v), 8)} ${pad(ms(v).toFixed(0), 5)}  ${pad(pct, 6)}%  ${same}/${compared}`;
    };
    const rate = (nodes('base') / ms('base')).toFixed(0);
    lines.push(`                                    ${pad(n, 2)} ${pad(K, 2)} ${pad(wf * 100, 4)}   ${pad(nodes('base'), 8)} ${pad(ms('base').toFixed(0), 5)} ${pad(rate, 5)}   | ${pad(nodes('prune2'), 8)} ${pad(ms('prune2').toFixed(0), 5)}   | ${block('prop')} | ${block('seg')} | ${block('prop+seg')}`);
  }
  return lines;
}

// ---- incremental prop + fast path + local connectivity: node-for-node identical to the plain search ----
const INCR_CASES = [[9, 8, .5], [11, 8, .5], [12, 10, .5]];
const INCR_VARIANTS = {
  ref: { prop: true, capture: true, incr: false, fast: false, lconn: false },
  default: { prop: true, capture: true },
};

function runIncremental() {
  const rows = [];
  const cases = {};
  for (const [n, K, wf] of INCR_CASES) {
    const c = solverCase(n, K, wf);
    const prints = [];
    for (const s of SOLVER_SEEDS) {
      const p = instance(s * 101 + n, n, K, wf);
      prints.push(fingerprint(p));
      const a = measure(() => solve(p, { nodeCap: SOLVER_CAP, ...INCR_VARIANTS.ref }));
      const b = measure(() => solve(p, { nodeCap: SOLVER_CAP, ...INCR_VARIANTS.default }));
      const identical = a.value.nodes === b.value.nodes && a.value.exceeded === b.value.exceeded && sameSearch(a.value, b.value);
      rows.push(rowOf(c, s, 'ref', { nodes: a.value.nodes, ...timing(a) }));
      rows.push(rowOf(c, s, 'default', { nodes: b.value.nodes, ...timing(b) }, identical ? {} : { bad: 1 }));
    }
    cases[c] = { n, K, wall: wf, seeds: SOLVER_SEEDS, inputs: hash(prints) };
  }
  return { rows, spec: { common: { nodeCap: SOLVER_CAP, limit: 2 }, cases, variants: INCR_VARIANTS } };
}

function incrementalText(rows) {
  const lines = ['\nINCREMENTAL PROP + FAST PATH + LOCAL CONNECTIVITY (prop on, limit 2)   n  K wall% | reference (incr:false, fast:false, lconn:false): nodes ms | default: nodes ms | speedup  identical'];
  for (const [n, K, wf] of INCR_CASES) {
    const c = solverCase(n, K, wf);
    const of = v => rows.filter(r => r.c === c && r.v === v);
    const total = (v, metric) => sum(of(v).map(r => r.m[metric]));
    const same = of('default').length - of('default').filter(r => r.bad).length;
    const speedup = (total('ref', 'ms') / total('default', 'ms')).toFixed(2);
    lines.push(`                                                   ${pad(n, 2)} ${pad(K, 2)} ${pad(wf * 100, 4)} | ${pad(total('ref', 'nodes'), 8)} ${pad(total('ref', 'ms').toFixed(0), 6)} | ${pad(total('default', 'nodes'), 8)} ${pad(total('default', 'ms').toFixed(0), 6)} | ${pad(speedup, 5)}x  ${same}/${of('default').length}`);
  }
  return lines;
}

// ---- generator ----
const V1_MAX_N = 11; // the v1-style search (prop off) is too slow on big grids
const GEN_SEEDS = { 5: [1, 2, 3], 7: [1, 2, 3], 8: [1, 2], 9: [1, 2], 10: [1], 11: [1], 12: [1], 16: [1] };
const gen = n => GEN_SEEDS[n] || [1];

function wallTotal(p) {
  let walls = 0;
  for (const v of p.walls) {
    walls += (v & 1) + ((v >> 1) & 1);
  }
  return walls;
}

// generate() with timing; returns { ms, msMed, walls, K }.
function timedGenerate(n, seed, options) {
  let K = 0;
  const r = measure(() => runSync(generate(n, seed, options), e => {
    if (e.K) {
      K = e.K;
    }
  }));
  return { ms: r.ms, msMed: r.msMed, walls: wallTotal(r.value), K };
}

const genMetrics = r => ({ ms: r.ms, msMed: r.msMed, walls: r.walls, K: r.K });

function runGenerator() {
  const rows = [];
  const cases = {};
  for (const n of PLAY_SIZES) {
    cases[`n=${n}`] = { n, seeds: gen(n) };
    for (const seed of gen(n)) {
      if (n <= V1_MAX_N) {
        rows.push(rowOf(`n=${n}`, seed, 'prop-off', genMetrics(timedGenerate(n, seed, { prop: false }))));
      }
      rows.push(rowOf(`n=${n}`, seed, 'default', genMetrics(timedGenerate(n, seed))));
    }
  }
  return { rows, spec: { common: { algo: ALGO_VERSION, v1MaxN: V1_MAX_N }, cases, variants: { 'prop-off': { prop: false }, default: {} } } };
}

function generatorText(rows) {
  const lines = [`\nGENERATOR (seeded)   n  seed |  prop off: ms walls K |  default (ALGO_VERSION ${ALGO_VERSION}): ms walls K | speedup  walls`];
  for (const n of PLAY_SIZES) {
    for (const seed of gen(n)) {
      const find = v => rows.find(r => r.c === `n=${n}` && r.s === seed && r.v === v);
      const off = find('prop-off');
      const on = find('default');
      const offColumns = off ? `${pad(off.m.ms.toFixed(0), 16)} ${pad(off.m.walls, 5)} ${pad(off.m.K, 2)}` : `${pad('-', 16)} ${pad('-', 5)} ${pad('-', 2)}`;
      const compare = off ? `${pad((off.m.ms / on.m.ms).toFixed(2), 6)}x ${pad(on.m.walls - off.m.walls, 6)}` : `${pad('-', 7)} ${pad('-', 6)}`;
      lines.push(`                    ${pad(n, 2)} ${pad(seed, 5)} |  ${offColumns} |  ${pad(on.m.ms.toFixed(0), 12)} ${pad(on.m.walls, 5)} ${pad(on.m.K, 2)} | ${compare}`);
    }
  }
  return lines;
}

// ---- candidates: quality/time trade of the per-size candidate count ----
const QUALITY_SEEDS = { 5: 6, 7: 6, 8: 6, 9: 4, 10: 4, 11: 4, 12: 2, 16: 1 };
const qualitySeeds = n => Array.from({ length: QUALITY_SEEDS[n] || 1 }, (_, i) => i + 1);

function runCandidates() {
  const rows = [];
  const cases = {};
  for (const n of PLAY_SIZES) {
    cases[`n=${n}`] = { n, seeds: qualitySeeds(n), k: CANDIDATES[n] };
    for (const seed of qualitySeeds(n)) {
      rows.push(rowOf(`n=${n}`, seed, 'one', genMetrics(timedGenerate(n, seed, { candidates: 1 }))));
      rows.push(rowOf(`n=${n}`, seed, 'default', genMetrics(timedGenerate(n, seed))));
    }
  }
  return { rows, spec: { common: { algo: ALGO_VERSION }, cases, variants: { one: { candidates: 1 }, default: {} } } };
}

function candidatesText(rows) {
  const lines = ['\nCANDIDATES (mean over seeds)   n seeds |  1 candidate: ms walls |  default: k ms walls | time   walls'];
  for (const n of PLAY_SIZES) {
    const of = v => rows.filter(r => r.c === `n=${n}` && r.v === v);
    const avg = (v, metric) => mean(of(v).map(r => r.m[metric]));
    const oneMs = avg('one', 'ms');
    const manyMs = avg('default', 'ms');
    const oneWalls = avg('one', 'walls');
    const manyWalls = avg('default', 'walls');
    lines.push(`                              ${pad(n, 2)} ${pad(qualitySeeds(n).length, 5)} |  ${pad(oneMs.toFixed(0), 12)} ${pad(oneWalls.toFixed(1), 5)} |  ${pad(CANDIDATES[n], 8)} ${pad(manyMs.toFixed(0), 5)} ${pad(manyWalls.toFixed(1), 5)} | ${pad((manyMs / oneMs).toFixed(1), 4)}x ${pad(((100 * (manyWalls - oneWalls)) / oneWalls).toFixed(0), 4)}%`);
  }
  return lines;
}

export const SUITES = [
  { id: 'solver', rev: 1, run: runSolver, text: solverText },
  { id: 'incremental', rev: 1, run: runIncremental, text: incrementalText },
  { id: 'generator', rev: 1, run: runGenerator, text: generatorText },
  { id: 'candidates', rev: 1, run: runCandidates, text: candidatesText },
];
