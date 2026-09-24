// Browser: open bench/index.html via a local server. Node: node bench/bench.js
// Gate regressions on `nodes` (deterministic); ms is machine-dependent and only informational.
import { makePuzzle } from '../src/core/model.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { allEdges, edgeId, setWallId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { solve } from '../src/core/solver/solve.js';
import { generate, PLAY_SIZES, CANDIDATES } from '../src/core/gen/generate.js';
import { runSync } from '../src/core/run.js';

const lines = [], log = s => lines.push(s);
function instance(seed, n, K, wallFrac) { // random path puzzle + random non-anchor walls
  const rnd = makeRng(seed), T = n * n, path = backbite(n, rnd), mid = []; for (let i = 1; i < T - 1; i++) mid.push(i);
  const pos = [0, ...shuffle(mid, rnd).slice(0, K - 2).sort((a, b) => a - b), T - 1], p = makePuzzle(n);
  pos.forEach((q, i) => { p.cp[path[q]] = i + 1; });
  const anchor = new Set(); for (let i = 1; i < T; i++) anchor.add(edgeId(n, path[i - 1], path[i]));
  shuffle(allEdges(n).filter(e => !anchor.has(e)), rnd).slice(0, Math.floor(wallFrac * (2 * n * (n - 1) - T + 1))).forEach(e => setWallId(p.walls, e, true));
  return p;
}
const time = f => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };

log('SOLVER  (limit 2, nodeCap 300000)   n  K wall%   base: nodes ms n/ms   | prune2: nodes ms | prop: nodes ms  vs base%  same-solutions | seg: nodes ms  vs base%  same-solutions | prop+seg: nodes ms  vs base%  same-solutions');
let equivalenceFailures = 0; // rows where prop/seg changed the solutions or visited more nodes than the plain search
for (const [n, K, wf] of [[7, 6, .3], [7, 6, .6], [9, 6, .3], [9, 8, .5], [11, 8, .5]]) {
  let nb = 0, mb = 0, np = 0, mp = 0, nq = 0, mq = 0, same = 0, cmp = 0, ns = 0, ms_ = 0, sameS = 0, nr = 0, mr = 0, sameR = 0;
  for (let s = 1; s <= 5; s++) {
    const p = instance(s * 101 + n, n, K, wf); solve(p, { nodeCap: 20000 });
    const [a, ta] = time(() => solve(p, { nodeCap: 300000 })), [b, tb] = time(() => solve(p, { nodeCap: 300000, prune2: true })), [c, tc] = time(() => solve(p, { nodeCap: 300000, prop: true, capture: true }));
    const [d, td] = time(() => solve(p, { nodeCap: 300000, seg: true, capture: true })), [e, te] = time(() => solve(p, { nodeCap: 300000, prop: true, seg: true, capture: true }));
    nb += a.nodes; mb += ta; np += b.nodes; mp += tb; nq += c.nodes; mq += tc; ns += d.nodes; ms_ += td; nr += e.nodes; mr += te;
    if (!a.exceeded) {
      cmp++;
      const A = solve(p, { nodeCap: 300000, capture: true });
      if (A.count === c.count && JSON.stringify(A.paths) === JSON.stringify(c.paths) && c.nodes <= a.nodes) same++;
      if (A.count === d.count && JSON.stringify(A.paths) === JSON.stringify(d.paths) && d.nodes <= a.nodes) sameS++;
      if (A.count === e.count && JSON.stringify(A.paths) === JSON.stringify(e.paths) && e.nodes <= a.nodes) sameR++;
    }
  }
  equivalenceFailures += (cmp - same) + (cmp - sameS) + (cmp - sameR);
  log(`                                    ${String(n).padStart(2)} ${String(K).padStart(2)} ${String(wf * 100).padStart(4)}   ${String(nb).padStart(8)} ${mb.toFixed(0).padStart(5)} ${(nb / mb).toFixed(0).padStart(5)}   | ${String(np).padStart(8)} ${mp.toFixed(0).padStart(5)}   | ${String(nq).padStart(8)} ${mq.toFixed(0).padStart(5)}  ${(100 * (nq / nb - 1)).toFixed(1).padStart(6)}%  ${same}/${cmp} | ${String(ns).padStart(8)} ${ms_.toFixed(0).padStart(5)}  ${(100 * (ns / nb - 1)).toFixed(1).padStart(6)}%  ${sameS}/${cmp} | ${String(nr).padStart(8)} ${mr.toFixed(0).padStart(5)}  ${(100 * (nr / nb - 1)).toFixed(1).padStart(6)}%  ${sameR}/${cmp}`);
}
const pad = (value, width) => String(value).padStart(width);
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const wallTotal = p => {
  let walls = 0;
  for (const v of p.walls) walls += (v & 1) + ((v >> 1) & 1);
  return walls;
};

// generate() with timing; returns { ms, walls, K }.
function timedGenerate(n, seed, options) {
  let K = 0;
  const [puzzle, ms] = time(() => runSync(generate(n, seed, options), e => { if (e.K) K = e.K; }));
  return { ms, walls: wallTotal(puzzle), K };
}

// The v1-style search (prop off) is too slow on big grids, so it only runs up to this size.
const V1_MAX_N = 11;
const SEEDS = { 5: [1, 2, 3], 7: [1, 2, 3], 8: [1, 2], 9: [1, 2], 10: [1], 11: [1], 12: [1], 16: [1] };

log('\nGENERATOR (seeded)   n  seed |  prop off: ms walls K |  default (ALGO_VERSION 4): ms walls K | speedup  walls');
for (const n of PLAY_SIZES) {
  for (const seed of SEEDS[n] || [1]) {
    const off = n <= V1_MAX_N ? timedGenerate(n, seed, { prop: false }) : null;
    const on = timedGenerate(n, seed);
    const offColumns = off ? `${pad(off.ms.toFixed(0), 16)} ${pad(off.walls, 5)} ${pad(off.K, 2)}` : `${pad('-', 16)} ${pad('-', 5)} ${pad('-', 2)}`;
    const compare = off ? `${pad((off.ms / on.ms).toFixed(2), 6)}x ${pad(on.walls - off.walls, 6)}` : `${pad('-', 7)} ${pad('-', 6)}`;
    log(`                    ${pad(n, 2)} ${pad(seed, 5)} |  ${offColumns} |  ${pad(on.ms.toFixed(0), 12)} ${pad(on.walls, 5)} ${pad(on.K, 2)} | ${compare}`);
  }
}

// Quality/time trade of the per-size candidate count: 1 candidate vs the CANDIDATES default.
const QUALITY_SEEDS = { 5: 6, 7: 6, 8: 6, 9: 4, 10: 4, 11: 4, 12: 2, 16: 1 };
log('\nCANDIDATES (mean over seeds)   n seeds |  1 candidate: ms walls |  default: k ms walls | time   walls');
for (const n of PLAY_SIZES) {
  const seeds = Array.from({ length: QUALITY_SEEDS[n] || 1 }, (_, i) => i + 1);
  const one = seeds.map(seed => timedGenerate(n, seed, { candidates: 1 }));
  const many = seeds.map(seed => timedGenerate(n, seed));
  const oneMs = mean(one.map(r => r.ms));
  const manyMs = mean(many.map(r => r.ms));
  const oneWalls = mean(one.map(r => r.walls));
  const manyWalls = mean(many.map(r => r.walls));
  log(`                              ${pad(n, 2)} ${pad(seeds.length, 5)} |  ${pad(oneMs.toFixed(0), 12)} ${pad(oneWalls.toFixed(1), 5)} |  ${pad(CANDIDATES[n], 8)} ${pad(manyMs.toFixed(0), 5)} ${pad(manyWalls.toFixed(1), 5)} | ${pad((manyMs / oneMs).toFixed(1), 4)}x ${pad(((100 * (manyWalls - oneWalls)) / oneWalls).toFixed(0), 4)}%`);
}
if (equivalenceFailures > 0) log(`\nFAILED: ${equivalenceFailures} solver comparison(s) differ between plain and prop search`);
const text = lines.join('\n');
if (typeof document !== 'undefined') document.getElementById('out').textContent = text; else console.log(text);
if (equivalenceFailures > 0 && typeof process !== 'undefined') process.exitCode = 1;
