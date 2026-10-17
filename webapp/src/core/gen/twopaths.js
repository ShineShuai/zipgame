import { generate, TWOPATHS_CANDIDATES } from './generate.js';

// Generator of Two paths puzzles (puzzle.split, core/model.js, core/twopaths.js): a red and a blue
// path cover the board, each visits its own numbers in order. It is generate() of gen/generate.js
// run with { twopaths: true }:
//   1. a random Hamiltonian path of the board (backbite), cut at a random cell, near the middle;
//   2. each of the two pieces is turned at random, so that the cells the bridge joins (the end of
//      the red piece and the start of the blue one) are not neighbours, which would give the cut
//      away: of the four turns, the ones that leave the two ends apart;
//   3. numbers along each piece, the first and last cell of a piece among them: the red piece
//      gets 1..split (start 1, end split), the blue piece the numbers after it;
//   4. walls until the puzzle has one solution, minimized as for a standard puzzle. The solver
//      (solver/solve-two.js) searches the red path, a bridge and the blue path as one path, so the
//      walls are the same kind of work as for a standard puzzle, and no wall ever stands on the
//      bridge.
// The path of a generated puzzle (`.path`) is the red path followed by the blue one.
//
// Gameplay: a different kind of thinking from the standard puzzle, planning the split of the board
// as well as a route.

// The grid sizes the play app offers for this variant: the small boards, where planning the split
// is the game (generating takes about twice the time of a standard puzzle of the size, up to 10 x 10:
// measured with tools/twopaths-bench.mjs).
export const TWOPATHS_MIN_OFFERED = 5;
export const TWOPATHS_MAX_OFFERED = 8;
export const TWOPATHS_SIZES = Object.keys(TWOPATHS_CANDIDATES)
  .map(Number)
  .filter(n => n >= TWOPATHS_MIN_OFFERED && n <= TWOPATHS_MAX_OFFERED);

// Generator (function*, progress events { frac|null, walls, K } as generate()): (n, seed) ->
// puzzle. Same seed, same puzzle.
export function* generateTwoPaths(n, seed, o = {}) {
  return yield* generate(n, seed, { ...o, twopaths: true });
}
