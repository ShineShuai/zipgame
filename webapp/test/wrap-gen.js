// Tests of the wrap-around (torus) generator: paths (gen/hampath.js), checkpoint gaps
// (gen/checkpoints.js), wall placement and minimizing (gen/walls.js) and generate() /
// generateUnique() (gen/generate.js). The puzzles are checked against the plain brute-force
// search of test/wrap.js, not against the solver that helped to build them.
// Registered by tests.js: wrapGenTests(t, ok, eq).
import { makePuzzle, validate } from '../src/core/model.js';
import { allEdges, hasWallId, setWallId, wallIds, pathEdgeIds } from '../src/core/edges.js';
import { isSolved } from '../src/core/rules.js';
import { gridDist } from '../src/core/geom.js';
import { serialize, parse } from '../src/core/format.js';
import { makeRng } from '../src/core/rng.js';
import { solve } from '../src/core/solver/solve.js';
import { backbite, warnsdorff } from '../src/core/gen/hampath.js';
import { gapCheckpoints } from '../src/core/gen/checkpoints.js';
import { makeUnique } from '../src/core/gen/walls.js';
import {
  generate, generateUnique, randomPathPuzzle, WRAP_CANDIDATES,
} from '../src/core/gen/generate.js';
import { bruteKeys } from './wrap.js';

const run = g => {
  let step;
  while (!(step = g.next()).done);
  return step.value;
};
const walls = p => allEdges(p.n, null, true).filter(e => hasWallId(p.walls, e));
const threw = f => {
  try { f(); return false; } catch { return true; }
};
// An edge across the seam: the right edge of the last column or the down edge of the last row.
const seamEdge = (n, e) => (
  (e & 1) === 0 ? (e >> 1) % n === n - 1 : (e >> 1) >= n * (n - 1)
);
// A path of the wrap-around board: every cell once, every step one move (seams included).
const isTorusPath = (n, path) => path.length === n * n && new Set(path).size === n * n &&
  path.every((c, i) => i === 0 || gridDist(n, true, path[i - 1], c) === 1);
const onGrid = (n, path) => (
  path.every((c, i) => i === 0 || gridDist(n, false, path[i - 1], c) === 1)
);

export function wrapGenTests(t, ok, eq) {
  t('wrap-gen: backbite and warnsdorff cover the torus, use the seams; grid unchanged', () => {
    let seam = 0;
    for (const n of [3, 4, 5, 6]) {
      for (let s = 1; s <= 25; s++) {
        const path = backbite(n, makeRng(s), true);
        ok(isTorusPath(n, path), `backbite n=${n} seed ${s}`);
        seam += path.filter((c, i) => i > 0 && gridDist(n, false, path[i - 1], c) !== 1).length;
        const w = warnsdorff(n, makeRng(s), true);
        ok(w === null || isTorusPath(n, w), `warnsdorff n=${n} seed ${s}`);
      }
    }
    ok(seam > 100, `backbite steps across the seams (${seam})`);
    for (const n of [4, 5, 7]) {
      const g = backbite(n, makeRng(3));
      ok(onGrid(n, g), `grid backbite n=${n} stays on the grid`);
      eq(backbite(n, makeRng(3), false), g, `an explicit wrap = false changes nothing (n=${n})`);
      eq(warnsdorff(n, makeRng(3), false), warnsdorff(n, makeRng(3)), `warnsdorff (n=${n})`);
    }
  });

  t('wrap-gen: gapCheckpoints on a torus: valid, and it uses the wrap distances', () => {
    let differs = 0;
    for (const n of [4, 5, 6]) {
      for (let s = 1; s <= 10; s++) {
        const path = backbite(n, makeRng(s), true), K = n + 1;
        const pos = gapCheckpoints(n, path, K, true);
        const tag = `n=${n} seed ${s}`;
        ok(pos && pos.length === K && pos[0] === 0 && pos[K - 1] === n * n - 1, `${tag}: ends`);
        for (let i = 1; i < K; i++) {
          const gap = gridDist(n, true, path[pos[i - 1]], path[pos[i]]);
          ok(pos[i] > pos[i - 1] && gap <= pos[i] - pos[i - 1], `${tag}: ascending, reachable`);
        }
        const grid = gapCheckpoints(n, path, K, false);
        if (!grid || grid.join() !== pos.join()) differs++;
      }
    }
    ok(differs > 0, `the wrap distances change some placements (${differs} of 30)`);
  });

  t('wrap-gen: generate(wrap): unique torus puzzles (brute force n 3, 4; plain search 5)', () => {
    for (const [n, count] of [[3, 12], [4, 12], [5, 6]]) {
      for (let s = 1; s <= count; s++) {
        const p = run(generate(n, s, { wrap: true }));
        const tag = `n=${n} seed ${s}`;
        ok(p.wrap === true, `${tag}: wrap flag`);
        ok(validate(p).ok, `${tag}: valid`);
        ok(isSolved(p, p.path), `${tag}: the planted path solves it`);
        const planted = new Set(pathEdgeIds(n, p.path, true));
        ok(walls(p).every(e => !planted.has(e)), `${tag}: no wall on the planted path`);
        const plain = solve(p, { limit: 2, nodeCap: 1e9, capture: true });
        eq(plain.count, 1, `${tag}: one solution (plain search)`);
        eq(plain.paths[0].join(','), p.path.join(','), `${tag}: it is the planted path`);
        if (n <= 4) {
          eq(bruteKeys(p), [p.path.join(',')], `${tag}: brute force finds only the planted path`);
        }
      }
    }
  });

  t('wrap-gen: every wall of a generated torus puzzle is needed (removing it adds one)', () => {
    for (const n of [4, 5]) {
      for (let s = 1; s <= 8; s++) {
        const p = run(generate(n, 40 + s, { wrap: true }));
        for (const e of walls(p)) {
          setWallId(p.walls, e, false);
          const count = solve(p, { limit: 2, nodeCap: 1e9 }).count;
          ok(count >= 2, `n=${n} seed ${40 + s}: wall ${e} is removable`);
          setWallId(p.walls, e, true);
        }
      }
    }
  });

  t('wrap-gen: makeUnique may wall every seam edge off the path (seeded with all)', () => {
    for (const n of [4, 5]) {
      const path = backbite(n, makeRng(n), true);
      const p = { ...makePuzzle(n), wrap: true };
      [0, 1, 2, path.length - 1].forEach((q, i) => { p.cp[path[q]] = i + 1; });
      const cfg = { nodeCap: 1e6, wallBudget: null, seedFraction: 1, K: 4, prop: true };
      const order = run(makeUnique(p, path, makeRng(1), cfg));
      ok(order !== null, `n=${n}: unique`);
      const planted = new Set(pathEdgeIds(n, path, true));
      const free = allEdges(n, null, true).filter(e => !planted.has(e));
      eq(walls(p).length, free.length, `n=${n}: every edge off the path is walled`);
      ok(free.some(e => seamEdge(n, e)), `n=${n}: ... and some of them are seam edges`);
    }
  });

  t('wrap-gen: seam walls and steps occur; torus puzzles need more walls than grid ones', () => {
    let seamWalls = 0, seamSteps = 0, torusWalls = 0, gridWalls = 0;
    const N = 20, n = 5;
    for (let s = 1; s <= N; s++) {
      const p = run(generate(n, s, { wrap: true }));
      seamWalls += walls(p).filter(e => seamEdge(n, e)).length;
      seamSteps += pathEdgeIds(n, p.path, true).filter(e => seamEdge(n, e)).length;
      torusWalls += walls(p).length;
      const g = run(generate(n, s));
      gridWalls += allEdges(n).filter(e => hasWallId(g.walls, e)).length;
    }
    ok(seamWalls > 0, `a wall on a seam edge (${seamWalls} in ${N} puzzles)`);
    ok(seamSteps > N, `the planted paths cross the seams (${seamSteps})`);
    ok(torusWalls > 2 * gridWalls, `walls: torus ${torusWalls}, grid ${gridWalls} (${N} puzzles)`);
  });

  t('wrap-gen: same seed, same puzzle; the text format round-trips a generated puzzle', () => {
    for (const n of [4, 6]) {
      const a = run(generate(n, 9, { wrap: true })), b = run(generate(n, 9, { wrap: true }));
      eq(Array.from(a.cp).join(), Array.from(b.cp).join(), `n=${n}: cp`);
      eq(wallIds(a).join(), wallIds(b).join(), `n=${n}: walls`);
      const q = parse(serialize(a));
      ok(q.wrap === true, `n=${n}: wrap survives the text format`);
      eq(wallIds(q).join(), wallIds(a).join(), `n=${n}: walls survive`);
      eq(solve(q, { limit: 2, nodeCap: 1e9 }).count, 1, `n=${n}: the parsed puzzle is unique`);
    }
    ok(!run(generate(5, 9)).wrap, 'a grid puzzle has no wrap flag');
  });

  t('wrap-gen: generateUnique and randomPathPuzzle take wrap; n < 3 is refused', () => {
    const r = run(generateUnique(5, 5, makeRng(4), { wrap: true, nodeCap: 20000 }));
    ok(r.unique && r.puzzle.wrap === true, 'a unique wrap-around puzzle');
    eq(solve(r.puzzle, { limit: 2, nodeCap: 1e9 }).count, 1, 'it has one solution');
    const free = randomPathPuzzle(4, 4, makeRng(2), true);
    ok(free.wrap === true && isTorusPath(4, free.path), 'randomPathPuzzle: a torus path');
    ok(!randomPathPuzzle(4, 4, makeRng(2)).wrap, 'randomPathPuzzle: the grid default');
    ok(threw(() => run(generate(2, 1, { wrap: true }))), 'generate: 2 x 2 is refused');
    ok(threw(() => run(generateUnique(2, 2, makeRng(1), { wrap: true }))), 'generateUnique: 2 x 2');
    ok(Object.keys(WRAP_CANDIDATES).every(k => +k >= 3), 'candidate counts only for n >= 3');
  });
}
