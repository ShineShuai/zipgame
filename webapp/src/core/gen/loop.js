import { generate, LOOP_CANDIDATES } from './generate.js';

// Generator of Loop puzzles (puzzle.loop, core/model.js): the path closes into a ring, so its
// last cell touches cell 1, and the numbers 1..K are met in cyclic order. It is generate() of
// gen/generate.js run with { loop: true }: a random Hamiltonian cycle (hampath.js ringPath), cut
// at a random cell that becomes cell 1, with the numbers spread over the first 60-90% of it
// (checkpoints.js loopCheckpoints), then walls until the puzzle has one solution, minimized as for
// a standard puzzle. The solver is solver/solve-loop.js, so every check also tries each cell the
// ring can close on: a Loop puzzle costs a few times what a standard one of its size does.
//
// Even sizes only (a grid has no Hamiltonian cycle on an odd number of cells).

// The grid sizes the play app offers for this variant. Measured: see test/loop-gen.js.
export const LOOP_MIN_OFFERED = 6;
export const LOOP_MAX_OFFERED = 12;
export const LOOP_SIZES = Object.keys(LOOP_CANDIDATES)
  .map(Number)
  .filter(n => n >= LOOP_MIN_OFFERED && n <= LOOP_MAX_OFFERED);

// Generator (function*, progress events { frac|null, walls, K } as generate()): (n, seed) -> puzzle.
// Same seed, same puzzle.
export function* generateLoop(n, seed, o = {}) {
  return yield* generate(n, seed, { ...o, loop: true });
}
