import { makeRng } from '../rng.js';
import { pickK, kRange } from './pick-k.js';
import { generateSurfaceSteps } from '../surface/gen.js';
import { surfaceTopology } from '../surface/topology.js';
import { PENTAGON_KIND, PENTAGON_SIZES, PENTAGON_BOARD_SIZES } from '../pentagon.js';

// Generator of Pentagon puzzles: a puzzle on the flat Cairo board of core/pentagon.js
// (puzzle.surface === 'pentagon'; the model, rules and text format are those of core/surface). It
// runs the recipe of surface/gen.js several times and keeps the candidate with the fewest walls:
//   1. a random Hamiltonian path of the board is the intended solution
//   2. K numbers along it (1 on the first cell, K on the last, the rest spread at random)
//   3. every side the path does not use gets a wall, then walls are taken away again, in random
//      order, while the solution stays the only one.
//
// The number of checkpoints follows the rule of the square boards (pickK in gen/generate.js): K ~
// Normal(mean = Kmin + 0.3 (Kmax - Kmin), sd = (Kmax - Kmin) / 6), cut to [Kmin, Kmax], with Kmin
// the square root of the cells and Kmax a quarter of them (kRange in gen/pick-k.js). A cell has 5
// neighbours, one more than on a square board, so with so few numbers the walls have to do more:
// see the measurements below.
//
// Measured with tools/pentagon-bench.mjs (the candidates below): median time, walls, checkpoints:
//   16 cells 9 ms, 2 walls, K 4 | 24: 6 ms, 1, 5 | 36: 22 ms, 6, 7 | 48: 90 ms, 6, 9 |
//   64: 0.5 s, 15, 10 | 80: 1.2 s, 15, 12 | 96: 2.2 s, 29, 14 | 100: 2.9 s, 29, 13
// (worst time 1.0 s at 64 cells, 3.2 s at 96, 4.3 s at 100). With the number of checkpoints of the
// square boards the big boards need about twice the walls of a board with 35-45% of the cells
// numbered (96 cells: 11 walls, 100 cells: 13), and more time per candidate, so fewer are made.

export { PENTAGON_SIZES };
// How many candidates are made per size (the one with the fewest walls is kept).
export const PENTAGON_CANDIDATES = { 4: 6, 5: 8, 6: 8, 7: 8, 8: 6, 9: 3, 10: 3, 11: 4 };

// The number of checkpoints of a puzzle on board n: pickK of the square boards, on the range of
// the board. rnd() is used twice.
export function pentagonK(n, rnd) {
  const [min, max] = kRange(surfaceTopology(PENTAGON_KIND, n).T);
  return pickK(min, max, rnd);
}

// The mean of pentagonK: the starting value of the number of checkpoints in the design app.
export function pentagonDefaultK(n) {
  const [min, max] = kRange(surfaceTopology(PENTAGON_KIND, n).T);
  return Math.round(min + 0.3 * (max - min));
}

// Generator (function*, progress events { frac|null, walls, K } as gen/generate.js): (n, seed) ->
// puzzle { surface: 'pentagon', n, cp, walls, path, seed }; path is the solution. Same seed, same
// puzzle. o.K: the number of checkpoints, o.candidates: how many puzzles to make. Any board of
// core/pentagon.js (the play app offers PENTAGON_SIZES).
export function* generatePentagon(n, seed, o = {}) {
  if (!PENTAGON_BOARD_SIZES.includes(n)) {
    throw new Error(`A Pentagon puzzle needs n to be one of ${PENTAGON_BOARD_SIZES.join(', ')}`);
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
