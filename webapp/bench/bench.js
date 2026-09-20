// Browser: open bench/index.html via a local server. Node: node bench/bench.js
// Gate regressions on `nodes` (deterministic); ms is machine-dependent and only informational.
import { makePuzzle } from '../src/core/model.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { allEdges, edgeId, setWallId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { solve } from '../src/core/solver/solve.js';
import { generate } from '../src/core/gen/generate.js';
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

log('SOLVER  (limit 2, nodeCap 300000)   n  K wall%   base: nodes ms n/ms   | prune2: nodes ms | prop: nodes ms  vs base%  same-solutions');
for (const [n, K, wf] of [[7, 6, .3], [7, 6, .6], [9, 6, .3], [9, 8, .5], [11, 8, .5]]) {
  let nb = 0, mb = 0, np = 0, mp = 0, nq = 0, mq = 0, same = 0, cmp = 0;
  for (let s = 1; s <= 5; s++) {
    const p = instance(s * 101 + n, n, K, wf); solve(p, { nodeCap: 20000 });
    const [a, ta] = time(() => solve(p, { nodeCap: 300000 })), [b, tb] = time(() => solve(p, { nodeCap: 300000, prune2: true })), [c, tc] = time(() => solve(p, { nodeCap: 300000, prop: true, capture: true }));
    nb += a.nodes; mb += ta; np += b.nodes; mp += tb; nq += c.nodes; mq += tc;
    if (!a.exceeded) { cmp++; const A = solve(p, { nodeCap: 300000, capture: true }); if (A.count === c.count && JSON.stringify(A.paths) === JSON.stringify(c.paths) && c.nodes <= a.nodes) same++; } // solution sets + order identical, nodes never higher
  }
  log(`                                    ${String(n).padStart(2)} ${String(K).padStart(2)} ${String(wf * 100).padStart(4)}   ${String(nb).padStart(8)} ${mb.toFixed(0).padStart(5)} ${(nb / mb).toFixed(0).padStart(5)}   | ${String(np).padStart(8)} ${mp.toFixed(0).padStart(5)}   | ${String(nq).padStart(8)} ${mq.toFixed(0).padStart(5)}  ${(100 * (nq / nb - 1)).toFixed(1).padStart(6)}%  ${same}/${cmp}`);
}
log('\nGENERATOR (seeded)   n  seed |  prop off: ms walls K |  default (ALGO_VERSION 4): ms walls K | speedup  walls');
const wc = p => { let w = 0; for (const v of p.walls) w += (v & 1) + ((v >> 1) & 1); return w; };
for (const [n, seeds] of [[5, [1, 2, 3]], [7, [1, 2, 3]], [9, [1, 2]], [11, [1]]]) for (const seed of seeds) {
  let K1 = 0, K2 = 0; const [a, t1] = time(() => runSync(generate(n, seed, { prop: false }), e => { if (e.K) K1 = e.K; })), [b, t2] = time(() => runSync(generate(n, seed), e => { if (e.K) K2 = e.K; }));
  log(`                    ${String(n).padStart(2)} ${String(seed).padStart(5)} |  ${t1.toFixed(0).padStart(16)} ${String(wc(a)).padStart(5)} ${String(K1).padStart(2)} |  ${t2.toFixed(0).padStart(12)} ${String(wc(b)).padStart(5)} ${String(K2).padStart(2)} | ${(t1 / t2).toFixed(2).padStart(6)}x ${String(wc(b) - wc(a)).padStart(6)}`);
}
const text = lines.join('\n');
if (typeof document !== 'undefined') document.getElementById('out').textContent = text; else console.log(text);
