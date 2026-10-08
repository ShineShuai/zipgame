// Candidate statistics of the Cutout generator: what the score sees, by number of interior holes
// and by outline, the cost of a candidate, and how much the best of N candidates gains. Used to
// set SCORE and CUTOUT_CANDIDATES (core/gen/cutout.js).
//   node tools/cutout-eval.mjs [sizes=6,8,10] [puzzles per size=6] [candidates per puzzle=30]
import { generateCutout } from '../src/core/gen/cutout.js';
import { runSync } from '../src/core/run.js';

const sizes = (process.argv[2] || '6,8,10').split(',').map(Number);
const puzzles = +process.argv[3] || 6;
const perPuzzle = +process.argv[4] || 30;
const mean = list => list.reduce((sum, x) => sum + x, 0) / Math.max(1, list.length);
const fmt = x => x.toFixed(2);

function describe(name, rows, keyOf, keys) {
  const parts = keys.map(key => {
    const group = rows.filter(r => keyOf(r) === key);
    if (!group.length) {
      return `${key}: -`;
    }
    return `${key}: ${group.length} D=${fmt(mean(group.map(r => r.difficulty)))}`;
  });
  console.log(`  ${name} ${parts.join(' | ')}`);
}

for (const n of sizes) {
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < puzzles; i++) {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const onCandidate = c => rows.push(c);
    runSync(generateCutout(n, seed, { candidates: perPuzzle, refineNodes: 0, onCandidate }));
  }
  const ms = ((Date.now() - t0) / rows.length).toFixed(1);
  const meanD = fmt(mean(rows.map(r => r.difficulty)));
  console.log(`\nn=${n}: ${rows.length} candidates, ${ms} ms each, mean difficulty ${meanD}`);
  describe('interior holes', rows, r => r.interior, [0, 1, 2, 3, 4]);
  describe('outline        ', rows, r => r.label, [...new Set(rows.map(r => r.label))]);
  const bestOf = count => {
    const winners = [];
    for (let i = 0; i < rows.length; i += perPuzzle) {
      const group = rows.slice(i, i + perPuzzle).slice(0, count);
      winners.push(Math.max(...group.map(r => r.total)));
    }
    return fmt(mean(winners));
  };
  const gains = [1, 5, perPuzzle].map(bestOf).join(' / ');
  console.log(`  mean score of the best of 1 / 5 / ${perPuzzle} candidates: ${gains}`);
}
