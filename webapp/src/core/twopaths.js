import { checkpointCells, maxNumber } from './model.js';

// Helpers of a Two paths puzzle (puzzle.split = k, core/model.js): two paths, red and blue, cover
// the board without sharing a cell. The numbers are one list 1..K: the red path starts on 1 and
// ends on k, in order; the blue path starts on k + 1 and ends on K, in order. The board shows the
// blue numbers as 1..K-k (colourNumber). Pure: no DOM, no storage.
//
// The one list is what the solver sees (solver/solve-two.js): the red path, then a bridge from its
// last cell (number k) to the first cell of the blue path (number k + 1), then the blue path. That
// merged path is also what a generated puzzle's `.path` holds (red cells, then blue cells).

// The two cells the bridge joins: the last red checkpoint and the first blue one.
export function bridgeCells(p) {
  const cells = checkpointCells(p);
  return [cells[p.split - 1], cells[p.split]];
}

// 0 = red, 1 = blue, -1 = the cell has no number.
export const colourOfCell = (p, cell) => {
  const v = p.cp[cell];
  return v ? (v <= p.split ? 0 : 1) : -1;
};

// The number the board shows for the number v: blue counts again from 1.
export const colourNumber = (p, v) => (v <= p.split ? v : v - p.split);

// How many numbers each colour has: [red, blue].
export const colourCounts = p => [p.split, maxNumber(p) - p.split];

// The merged path cut at the bridge: [red path, blue path], or null when it does not contain the
// last red checkpoint.
export function splitPath(p, path) {
  const at = path.indexOf(bridgeCells(p)[0]);
  return at < 0 ? null : [path.slice(0, at + 1), path.slice(at + 1)];
}

// What one colour sees of the puzzle: a standard puzzle with only that colour's numbers, counted
// from 1, and no cell of the other colour numbered. rules.js step() plays one colour of it.
export function colourView(p, colour) {
  const cp = new Uint16Array(p.cp.length);
  for (let i = 0; i < cp.length; i++) {
    if (colourOfCell(p, i) === colour) cp[i] = colourNumber(p, p.cp[i]);
  }
  return { n: p.n, cp, walls: p.walls };
}
