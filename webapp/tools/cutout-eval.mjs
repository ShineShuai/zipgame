// How well the Cutout generator reaches its target grade (core/gen/cutout.js): per size, the share of
// puzzles that got there, the time, the layout of the winners (crossings of the middle line, legs that change quadrant, share of the solution off
// shortest routes, legs that overlap or cross: see core/gen/layout.js, none of them is part of the grade) and which boards (outline, interior holes) can reach it at all.
// Used to set CUTOUT_GRADE, COST, CUTOUT_BOARDS and CUTOUT_MAX_MS.
//   node tools/cutout-eval.mjs [sizes=6,8,10] [puzzles per size=6] [maxMs, 0 = no clock]
import { generateCutout, CUTOUT_GRADE } from '../src/core/gen/cutout.js';
import { layoutFor, pathCrossings } from '../src/core/gen/layout.js';
import { adjacency } from '../src/core/gen/shapes.js';
import { runSync } from '../src/core/run.js';

const sizes = (process.argv[2] || '6,8,10').split(',').map(Number);
const puzzles = +process.argv[3] || 6;
const maxMs = +process.argv[4] || undefined;
const mean = list => list.reduce((sum, x) => sum + x, 0) / Math.max(1, list.length);
const fmt = x => x.toFixed(2);

function describe(name, rows, keyOf, keys) {
  const parts = keys.map(key => {
    const group = rows.filter(r => keyOf(r) === key);
    if (!group.length) {
      return `${key}: -`;
    }
    const hits = group.filter(r => r.hit).length;
    return `${key}: ${hits}/${group.length} D=${fmt(mean(group.map(r => r.difficulty)))}`;
  });
  console.log(`  ${name} ${parts.join(' | ')}`);
}

for (const n of sizes) {
  const boards = [];
  const results = [];
  for (let i = 0; i < puzzles; i++) {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const t0 = Date.now();
    const onCandidate = c => boards.push(c);
    const p = runSync(generateCutout(n, seed, { maxMs, onCandidate }));
    const layout = layoutFor(n, adjacency(n, p.holes), p.path), shape = layout.stats(layout.positionsOf(p.cp));
    results.push({ ...p.score, ms: Date.now() - t0, shape: p.shape, ...shape, cut: pathCrossings(n, p.path), cross_: shape.cross });
  }
  const hits = results.filter(r => r.hit).length;
  console.log(`\nn=${n}: ${hits}/${results.length} puzzles reached grade ${CUTOUT_GRADE}, ${Math.round(mean(results.map(r => r.ms)))} ms each (max ${Math.max(...results.map(r => r.ms))}), ${boards.length} boards climbed`);
  console.log(`  winners: grades ${results.map(r => r.grade).join('')}, walls ${fmt(mean(results.map(r => r.walls)))}, interior holes ${fmt(mean(results.map(r => r.interior)))}`);
  console.log(`  layout of the winners: middle-line crossings ${fmt(mean(results.map(r => r.cut)))}, legs that change quadrant ${fmt(mean(results.map(r => r.switches)))}, detour ${fmt(mean(results.map(r => r.detour)))}, overlap of legs ${fmt(mean(results.map(r => r.overlap)))}, crossing ${fmt(mean(results.map(r => r.cross_)))}`);
  describe('boards that got there / tried (mean predicted rating), by interior holes', boards, r => r.interior, [0, 1, 2, 3, 4]);
  describe('by outline                                                              ', boards, r => r.label, [...new Set(boards.map(r => r.label))]);
}
