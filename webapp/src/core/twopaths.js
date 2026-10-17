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

// ---------- editing (the design app) ----------

// The colour and the number a cell has on the board: { colour: 0 | 1, number } (the blue numbers
// count from 1), or null for a cell without a number.
export function colourNumberOf(p, cell) {
  const colour = colourOfCell(p, cell);
  return colour < 0 ? null : { colour, number: colourNumber(p, p.cp[cell]) };
}

// Give `cell` the number `value` of `colour` (0 red, 1 blue), 0 = no number; the number was
// anywhere else of that colour, it moves. The one list of numbers (puzzle.cp) is rebuilt around
// it: split becomes the highest red number, and the blue numbers follow it, so a red number
// added or taken away moves every blue one without the designer counting. A board without a red
// number has split 1 (a Two paths puzzle keeps a split; validate() says what is missing).
export function setColourNumber(p, cell, colour, value) {
  const red = new Map();
  const blue = new Map();
  p.cp.forEach((v, c) => {
    if (v) (v <= p.split ? red : blue).set(c, colourNumber(p, v));
  });
  red.delete(cell);
  blue.delete(cell);
  if (value > 0) {
    const mine = colour === 0 ? red : blue;
    for (const [c, v] of mine) if (v === value) mine.delete(c);
    mine.set(cell, value);
  }
  const split = Math.max(1, ...red.values());
  p.cp.fill(0);
  red.forEach((v, c) => {
    p.cp[c] = v;
  });
  blue.forEach((v, c) => {
    p.cp[c] = split + v;
  });
  p.split = split;
}

// What is wrong with the numbers of a Two paths puzzle, in the board's own words (red 1.., blue
// 1..), or null when each colour has 2 or more numbers, counted from 1 without gaps or repeats.
export function colourProblems(p) {
  const found = [new Map(), new Map()];
  for (let cell = 0; cell < p.cp.length; cell++) {
    const at = colourNumberOf(p, cell);
    if (!at) continue;
    const seen = found[at.colour].get(at.number) || [];
    seen.push(cell);
    found[at.colour].set(at.number, seen);
  }
  const names = ['red', 'blue'];
  for (const colour of [0, 1]) {
    const numbers = found[colour];
    const top = Math.max(0, ...numbers.keys());
    for (const [number, cells] of numbers) {
      if (cells.length > 1) {
        return `Invalid: ${names[colour]} ${number} is on ${cells.length} cells.`;
      }
    }
    for (let number = 1; number <= top; number++) {
      if (!numbers.has(number)) return `Invalid: ${names[colour]} ${number} is missing.`;
    }
    if (top < 2) return `Invalid: the ${names[colour]} path needs at least 2 numbers.`;
  }
  return null;
}

// A board that was another type becomes a Two paths board: its numbers stay, all of them red (the
// blue path has none yet).
export function markTwoPaths(p) {
  p.split = Math.max(1, Math.max(0, ...p.cp));
}
