// node bench/seg-bench.js
// Head-to-head: prop-only vs seg-only (next-segment and all-remaining-segments variants) vs
// combinations, across N=7..12. Reports node counts (deterministic) and ms (machine-dependent).
// Also re-verifies solution-set equivalence (never trust a speed number without this).
import { makePuzzle } from '../src/core/model.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { allEdges, edgeId, setWallId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { solve } from '../src/core/solver/solve.js';

function instance(seed, n, K, wallFrac) {
  const rnd = makeRng(seed), T = n * n, path = backbite(n, rnd), mid = [];
  for (let i = 1; i < T - 1; i++) mid.push(i);
  const pos = [0, ...shuffle(mid, rnd).slice(0, K - 2).sort((a, b) => a - b), T - 1], p = makePuzzle(n);
  pos.forEach((q, i) => { p.cp[path[q]] = i + 1; });
  const anchor = new Set();
  for (let i = 1; i < T; i++) anchor.add(edgeId(n, path[i - 1], path[i]));
  shuffle(allEdges(n).filter(e => !anchor.has(e)), rnd)
    .slice(0, Math.floor(wallFrac * (2 * n * (n - 1) - T + 1)))
    .forEach(e => setWallId(p.walls, e, true));
  return p;
}
const time = f => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };

const CONFIGS = [
  ['base', {}],
  ['prop', { prop: true }],
  ['parity', { parity: true }],
  ['prop+parity', { prop: true, parity: true }],
  ['seg', { seg: true }],
  ['segAll', { seg: 'all' }],
  ['prop+seg', { prop: true, seg: true }],
  ['prop+segAll', { prop: true, seg: 'all' }],
];

const CAP = 400000;
const SEEDS = 6;
const GRID = [
  [7, 6, .3], [7, 6, .6],
  [8, 6, .3], [8, 8, .5],
  [9, 6, .3], [9, 8, .5],
  [10, 8, .4], [10, 10, .5],
  [11, 8, .5], [11, 10, .5],
  [12, 10, .5], [12, 12, .5],
];

let fail = 0;
const header = 'n  K wall% | ' + CONFIGS.map(([name]) => name.padStart(11)).join(' | ');
console.log(header);
for (const [n, K, wf] of GRID) {
  const totals = Object.fromEntries(CONFIGS.map(([name]) => [name, { nodes: 0, ms: 0 }]));
  let cmp = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const p = instance(s * 131 + n * 7, n, K, wf);
    solve(p, { nodeCap: 20000 }); // warm/skip trivial-cap outliers, matches existing bench.js pattern
    const ref = solve(p, { nodeCap: CAP, capture: true });
    if (ref.exceeded) continue;
    cmp++;
    for (const [name, opts] of CONFIGS) {
      const [r, ms] = time(() => solve(p, { ...opts, nodeCap: CAP, capture: true }));
      totals[name].nodes += r.nodes;
      totals[name].ms += ms;
      if (name !== 'base') {
        const ok = r.count === ref.count && JSON.stringify(r.paths) === JSON.stringify(ref.paths) && r.nodes <= totals.base.nodes /* not exact per-seed but catches gross breakage */;
        if (r.count !== ref.count || JSON.stringify(r.paths) !== JSON.stringify(ref.paths)) { fail++; console.log(`MISMATCH ${name} n=${n} K=${K} seed=${s}`); }
      }
    }
  }
  const baseNodes = totals.base.nodes || 1;
  const row = `${String(n).padStart(2)} ${String(K).padStart(2)} ${String(Math.round(wf * 100)).padStart(4)} | ` +
    CONFIGS.map(([name]) => {
      const t = totals[name];
      const pct = name === 'base' ? '  base' : (100 * (t.nodes / baseNodes - 1)).toFixed(1).padStart(6) + '%';
      return `${String(t.nodes).padStart(8)}/${t.ms.toFixed(0).padStart(5)}ms ${pct}`.padStart(11);
    }).join(' | ') + `   (n=${cmp})`;
  console.log(row);
}
if (fail > 0) { console.log(`\nFAILED: ${fail} mismatches — seg/prop changed solutions, DO NOT TRUST TIMING ABOVE`); process.exitCode = 1; }
else console.log('\nAll configs verified equivalent to baseline solution set.');
