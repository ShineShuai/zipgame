// Measures the Two paths generator (core/gen/twopaths.js) per board size: time and walls of
// generate() over a number of seeds, and the same for a standard puzzle of that size, to compare.
//   node tools/twopaths-bench.mjs [--n 5,6,7,8] [--seeds 12] [--candidates 8] [--standard]
//     --n           board sizes (default 5,6,7,8)
//     --seeds       seeds per size (default 12)
//     --candidates  candidates built per puzzle (default: the table in gen/generate.js)
//     --standard    also measure standard puzzles of the same sizes
// Prints one line per size: median and worst of the time in ms and of the walls kept.
import { generate } from '../src/core/gen/generate.js';
import { runSync } from '../src/core/run.js';
import { wallCount } from '../src/core/edges.js';
import { solve } from '../src/core/solver/solve.js';
import { maxNumber } from '../src/core/model.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const sizes = option('n', '5,6,7,8').split(',').map(Number);
const seeds = Number(option('seeds', '12'));
const candidates = option('candidates', null);
const standard = args.includes('--standard');

const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
const line = (label, rows) => {
  const ms = rows.map(r => r.ms);
  const walls = rows.map(r => r.walls);
  const K = rows.map(r => r.K);
  console.log(`${label}  time ms: median ${median(ms).toFixed(0)}, worst ${Math.max(...ms).toFixed(0)}`
    + ` | walls: median ${median(walls)}, worst ${Math.max(...walls)} | K median ${median(K)}`);
};

for (const n of sizes) {
  for (const kind of standard ? ['two paths', 'standard'] : ['two paths']) {
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const o = { ...(kind === 'two paths' ? { twopaths: true } : {}), ...(candidates ? { candidates: +candidates } : {}) };
      const t0 = performance.now();
      const p = runSync(generate(n, seed * 101 + n, o));
      const ms = performance.now() - t0;
      const check = solve(p, { limit: 2, nodeCap: 5e6, prop: true });
      if (check.count !== 1) console.log(`  ! n=${n} seed=${seed}: ${check.count} solutions`);
      rows.push({ ms, walls: wallCount(p), K: maxNumber(p) });
    }
    line(`n=${n} ${kind.padEnd(9)}`, rows);
  }
}
