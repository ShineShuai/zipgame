// Measures the Pentagon generator (core/gen/pentagon.js) per board size: time, walls kept and
// numbers (K) of generatePentagon() over a number of seeds, and checks every puzzle has exactly
// one solution.
//   node tools/pentagon-bench.mjs [--n 4,6,8,10] [--seeds 8] [--candidates 4] [--K 40]
//     --n           board sizes (default 4,6,8,10)
//     --seeds       seeds per size (default 8)
//     --candidates  candidates built per puzzle (default: PENTAGON_CANDIDATES)
//     --K           number of checkpoints (default: PENTAGON_SHARE of the cells)
// Prints one line per size: median and worst of the time in ms and of the walls kept.
import { generatePentagon, PENTAGON_SIZES } from '../src/core/gen/pentagon.js';
import { runSync } from '../src/core/run.js';
import { solveSurface } from '../src/core/surface/solve.js';
import { maxNumber, wallCount } from '../src/core/surface/puzzle.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const sizes = option('n', PENTAGON_SIZES.join(',')).split(',').map(Number);
const seeds = Number(option('seeds', '8'));
const candidates = option('candidates', null);
const K = option('K', null);

const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];

for (const n of sizes) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const o = { ...(candidates ? { candidates: +candidates } : {}), ...(K ? { K: +K } : {}) };
    const t0 = performance.now();
    const p = runSync(generatePentagon(n, seed * 101 + n, o));
    const ms = performance.now() - t0;
    const check = solveSurface(p, { limit: 2, nodeCap: 0 });
    if (check.count !== 1) console.log(`  ! n=${n} seed=${seed}: ${check.count} solutions`);
    rows.push({ ms, walls: wallCount(p), K: maxNumber(p) });
  }
  const ms = rows.map(r => r.ms);
  const walls = rows.map(r => r.walls);
  const time = `median ${median(ms).toFixed(0)}, worst ${Math.max(...ms).toFixed(0)}`;
  console.log(`n=${n}  time ms: ${time}`
    + ` | walls: median ${median(walls)}, worst ${Math.max(...walls)}`
    + ` | K median ${median(rows.map(r => r.K))}`);
}
