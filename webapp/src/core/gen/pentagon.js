import { makeRng } from '../rng.js';
import { generateSurfaceSteps } from '../surface/gen.js';
import { surfaceTopology } from '../surface/topology.js';
import { PENTAGON_KIND, PENTAGON_SIZES } from '../surface/pentagon.js';

// Generator of Pentagon puzzles: a puzzle on the flat Cairo board of core/surface/pentagon.js
// (puzzle.surface === 'pentagon'; the model, rules and text format are those of core/surface). It
// runs the recipe of surface/gen.js several times and keeps the candidate with the fewest walls:
//   1. a random Hamiltonian path of the board is the intended solution
//   2. K numbers along it (1 on the first cell, K on the last, the rest spread at random)
//   3. every side the path does not use gets a wall, then walls are taken away again, in random
//      order, while the solution stays the only one.
//
// Why so many numbers: a cell has 5 neighbours, one more than on the square board, so a path has
// more ways to go and more has to be fixed. With a fifth of the cells numbered a 64-cell board
// keeps 16 walls on average, with 40% about 10 (the square 8 x 8 board needs 2 to 4). K is 35 to
// 45% of the cells.
// Measured with tools/pentagon-bench.mjs (the candidates below): median time and walls
//   16 cells 13 ms, 0 walls | 36 cells 20 ms, 2 | 64 cells 0.2 s, 6 | 100 cells 1.3 s, 13
// (worst time 27 ms, 80 ms, 0.4 s, 1.5 s). Before the solver of core/surface/solve.js was made
// incremental the 100-cell board took 3.1 s for 4 candidates (walls 14).

export { PENTAGON_SIZES };
// The sizes the play app offers for this variant: cells 16, 36, 64, 100.
export const PENTAGON_OFFERED = PENTAGON_SIZES;
// Share of the cells that carry a number: from the first to just short of the second.
export const PENTAGON_SHARE = [0.35, 0.45];
// How many candidates are made per size: a second per puzzle at most, on the 100-cell board.
export const PENTAGON_CANDIDATES = { 4: 6, 6: 8, 8: 10, 10: 8 };

// The number of checkpoints: PENTAGON_SHARE of the cells, at least 4.
export function pentagonK(n, rnd) {
  const cells = surfaceTopology(PENTAGON_KIND, n).T;
  const [low, high] = PENTAGON_SHARE;
  return Math.min(cells, Math.max(4, Math.round(cells * (low + (high - low) * rnd()))));
}

// Generator (function*, progress events { frac|null, walls, K } as gen/generate.js): (n, seed) ->
// puzzle { surface: 'pentagon', n, cp, walls, path, seed }; path is the solution. Same seed, same
// puzzle. o.K: the number of checkpoints, o.candidates: how many puzzles to make.
export function* generatePentagon(n, seed, o = {}) {
  if (!PENTAGON_SIZES.includes(n)) {
    throw new Error(`A Pentagon puzzle needs n to be one of ${PENTAGON_SIZES.join(', ')}`);
  }
  const rnd = makeRng(seed);
  const K = o.K ?? pentagonK(n, rnd);
  const wanted = o.candidates ?? PENTAGON_CANDIDATES[n];
  let best = null;
  for (let i = 0; i < wanted; i++) {
    const candidateSeed = Math.floor(rnd() * 4294967296);
    const events = generateSurfaceSteps(PENTAGON_KIND, n, candidateSeed, { K, attempt: i + 1 });
    let step;
    while (!(step = events.next()).done) {
      const { phase, done, total } = step.value;
      const share = phase === 'walls' && total ? done / total : 0;
      yield { frac: (i + share) / wanted, walls: best ? best.walls : null, K };
    }
    if (!best || step.value.walls < best.walls) {
      best = step.value;
    }
  }
  yield { frac: 1, walls: best.walls, K };
  best.puzzle.path = best.path;
  best.puzzle.seed = seed;
  return best.puzzle;
}
