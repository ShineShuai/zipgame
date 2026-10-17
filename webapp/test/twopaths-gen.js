// Tests of the Two paths generator (core/gen/twopaths.js, gen/twopaths-layout.js, and the
// `twopaths` option of gen/generate.js and gen/walls.js). Registered by tests.js:
// twoPathsGenTests(t, ok, eq).
import { validate, maxNumber, clonePuzzle } from '../src/core/model.js';
import { serialize } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { isSolved, canStep } from '../src/core/rules.js';
import { gridDist } from '../src/core/geom.js';
import { bridgeCells, splitPath } from '../src/core/twopaths.js';
import { hasWallId, setWallId, allEdges, wallCount } from '../src/core/edges.js';
import { generate, tryGenerate, TWOPATHS_CANDIDATES } from '../src/core/gen/generate.js';
import { generateTwoPaths, TWOPATHS_SIZES } from '../src/core/gen/twopaths.js';
import { twoPathsLayout, redNumbers, CUT_SHARE } from '../src/core/gen/twopaths-layout.js';

const game = (n, seed, o = {}) => runSync(generateTwoPaths(n, seed, o));
const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A path of the board: every cell once, every step to a neighbour.
const isGridPath = (n, path) => new Set(path).size === path.length
  && path.every((cell, i) => i === 0 || gridDist(n, false, path[i - 1], cell) === 1);

export function twoPathsGenTests(t, ok, eq) {
  t('twopaths-gen: redNumbers — its share of the numbers, 2 at least for each colour', () => {
    eq(redNumbers(10, 50, 100), 5);
    eq(redNumbers(10, 10, 100), 2);
    eq(redNumbers(10, 95, 100), 8);
    eq(redNumbers(4, 50, 100), 2);
    for (let K = 4; K <= 20; K++) {
      for (const share of [0.1, 0.35, 0.5, 0.65, 0.9]) {
        const k = redNumbers(K, Math.round(share * 100), 100);
        ok(k >= 2 && K - k >= 2, `K=${K} share=${share}: ${k}`);
      }
    }
  });

  t('twopaths-gen: layout — two grid paths that cover the board, ends apart, numbers ordered', () => {
    let made = 0;
    for (const n of [4, 5, 6, 7, 8, 10]) {
      for (const cps of ['gap', 'random']) {
        for (let seed = 1; seed <= 25; seed++) {
          const K = Math.max(4, n + (seed % 4));
          const layout = twoPathsLayout(n, K, makeRng(seed * 13 + n), cps);
          if (!layout) continue;
          made++;
          const { path, positions, split } = layout;
          const cells = n * n;
          eq(path.length, cells);
          eq(new Set(path).size, cells, 'every cell once');
          ok(split >= 2 && K - split >= 2, `split ${split} of ${K}`);
          eq(positions.length, K);
          // the one step that is not to a neighbour is the bridge (there has to be one)
          const redLength = path.findIndex((cell, i) => i > 0 && gridDist(n, false, path[i - 1], cell) !== 1);
          ok(redLength > 0, 'a bridge between the pieces');
          const red = path.slice(0, redLength);
          const blue = path.slice(redLength);
          ok(isGridPath(n, red) && isGridPath(n, blue), 'each piece is a grid path');
          ok(gridDist(n, false, red[red.length - 1], blue[0]) > 1, 'the bridge ends do not touch');
          eq(positions[0], 0, 'red starts at its first cell');
          eq(positions[split - 1], redLength - 1, 'red ends at its last cell');
          eq(positions[split], redLength, 'blue starts at its first cell');
          eq(positions[K - 1], cells - 1, 'blue ends at its last cell');
          for (let i = 1; i < K; i++) if (i !== split) ok(positions[i] > positions[i - 1], 'ascending');
          const share = redLength / cells;
          ok(share >= CUT_SHARE[0] - 0.05 && share <= CUT_SHARE[1] + 0.05, `cut at ${share}`);
        }
      }
    }
    ok(made > 250, `${made} layouts`);
    eq(twoPathsLayout(5, 3, makeRng(1)), null, 'fewer than 4 numbers cannot be two paths');
  });

  t('twopaths-gen: layout is repeatable, and varies with the seed', () => {
    const a = twoPathsLayout(6, 7, makeRng(5));
    const b = twoPathsLayout(6, 7, makeRng(5));
    eq(a, b);
    const seen = new Set();
    for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(twoPathsLayout(6, 7, makeRng(seed))));
    ok(seen.size > 15, `${seen.size} different layouts of 20`);
  });

  t('twopaths-gen: generate — valid, one solution, the stored path solves it, walls off its edges', () => {
    for (const n of [4, 5, 6, 7]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = game(n, seed);
        const tag = `n=${n} seed=${seed}`;
        ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
        ok(p.split >= 2 && maxNumber(p) - p.split >= 2, `${tag}: split ${p.split}`);
        eq(p.seed, seed);
        const r = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true });
        ok(!r.exceeded, `${tag}: no cap hit`);
        eq(r.count, 1, `${tag}: one solution`);
        eq(r.paths[0], p.path, `${tag}: it is the stored path`);
        ok(isSolved(p, p.path), `${tag}: isSolved`);
        const [red, blue] = splitPath(p, p.path);
        ok(isGridPath(n, red) && isGridPath(n, blue), `${tag}: two grid paths`);
        const [a, b] = bridgeCells(p);
        ok(gridDist(n, false, a, b) > 1, `${tag}: the bridge ends do not touch`);
        // no wall on an edge a path walks
        for (const path of [red, blue]) {
          for (let i = 1; i < path.length; i++) ok(canStep(p, path[i - 1], path[i]), `${tag}: wall on the path`);
        }
      }
    }
  });

  t('twopaths-gen: every wall left is needed (taking any one out makes a second solution)', () => {
    for (const n of [5, 6]) {
      for (let seed = 1; seed <= 6; seed++) {
        const p = game(n, seed);
        for (const e of allEdges(n)) {
          if (!hasWallId(p.walls, e)) continue;
          const q = clonePuzzle(p);
          setWallId(q.walls, e, false);
          const r = solve(q, { limit: 2, nodeCap: 5e6, prop: true });
          ok(!r.exceeded && r.count === 2, `n=${n} seed=${seed} wall ${e} could go`);
        }
      }
    }
  });

  t('twopaths-gen: same seed, same puzzle; other seeds, other puzzles', () => {
    eq(serialize(game(6, 9)), serialize(game(6, 9)));
    const seen = new Set();
    for (let seed = 1; seed <= 8; seed++) seen.add(serialize(game(6, seed)));
    ok(seen.size >= 7, `${seen.size} different puzzles of 8`);
  });

  t('twopaths-gen: sizes offered are measured ones; sizes below 4 and other variants are refused', () => {
    eq(TWOPATHS_SIZES, [5, 6, 7, 8]);
    for (const n of TWOPATHS_SIZES) ok(TWOPATHS_CANDIDATES[n] > 0, `candidates for ${n}`);
    ok(threw(() => game(3, 1)), 'n = 3');
    ok(threw(() => runSync(generate(6, 1, { twopaths: true, wrap: true }))), 'with wrap');
    ok(threw(() => runSync(generate(6, 1, { twopaths: true, loop: true }))), 'with loop');
    ok(threw(() => runSync(generate(6, 1, { twopaths: true, teleport: true }))), 'with teleport');
  });

  t('twopaths-gen: tryGenerate with twopaths gives a split puzzle, unique, with its paths', () => {
    let got = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = makeRng(seed);
      const p = runSync(tryGenerate(6, 7, rnd, 100000, 36, 0.4, { prop: true, twopaths: true }));
      if (!p) continue;
      got++;
      ok(p.split >= 2 && p.path.length === 36);
      eq(solve(p, { limit: 2, nodeCap: 1e6, prop: true }).count, 1);
      eq(wallCount(p), p.order.length);
    }
    ok(got >= 4, `${got} of 6`);
  });
}
