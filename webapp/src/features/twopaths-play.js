import { colourView, colourOfCell, splitPath } from '../core/twopaths.js';
import { step, canStep, isSolvedPaths } from '../core/rules.js';
import { legsUndo } from './share.js';
import { computeHint, solutionOf } from './hints.js';

// Playing a Two paths puzzle (puzzle.split, core/model.js): the rules of the two drawn paths, with
// no DOM, so that the play app (apps/play/main.js) only has to call them. Two paths, `paths` =
// [red, blue] (arrays of cells, mutated in place), and a colour: 0 = red, 1 = blue.
//
// One colour is played by step() (core/rules.js) on that colour's own view of the puzzle
// (core/twopaths.js colourView: only its numbers, counted from 1). On top of that, a path may not
// enter a cell of the other path nor a number of the other colour.

export const RED = 0;
export const BLUE = 1;

export const newPaths = () => [[], []];

// colourView() once per puzzle
const views = new WeakMap();
function viewOf(p, colour) {
  if (!views.has(p)) views.set(p, [colourView(p, RED), colourView(p, BLUE)]);
  return views.get(p)[colour];
}

// The colour a press on `cell` draws with. A cell of a path: that path (so that a press on a
// path's own cells goes on with it). A numbered cell: its colour, so that a press on a 1 starts
// that colour. Any other cell: the colour whose head can step there (`current` first); else
// `current`.
export function pickColour(p, paths, cell, current = RED) {
  const on = paths.findIndex(path => path.includes(cell));
  if (on >= 0) return on;
  const owner = colourOfCell(p, cell);
  if (owner >= 0) return owner;
  for (const colour of [current, 1 - current]) {
    const path = paths[colour];
    if (path.length && canStep(p, path[path.length - 1], cell)) return colour;
  }
  return current;
}

// One move of `colour` onto `cell`: 'push' | 'pop' | null (step() in core/rules.js; the path is
// mutated). Refused: a cell of the other path, a number of the other colour.
export function walkColour(p, paths, colour, cell) {
  if (paths[1 - colour].includes(cell)) return null;
  const owner = colourOfCell(p, cell);
  if (owner >= 0 && owner !== colour) return null;
  return step(viewOf(p, colour), paths[colour], cell);
}

export const solvedPaths = (p, paths) => isSolvedPaths(p, paths[RED], paths[BLUE]);

// How many numbers each colour's path has reached: [red, blue].
export const reached = (p, paths) => paths.map(
  path => path.reduce((count, cell) => count + (colourOfCell(p, cell) >= 0 ? 1 : 0), 0),
);

// The colour strip (features/share.js legsUndo) of a move that took cells off `colour`'s path:
// prevPath = the path before the move, keep = how many cells stay. The legs of the blue path are
// counted after the red ones, the leg between the two paths (red end to blue start) has none.
export function legsUndoTwo(legs, p, colour, prevPath, keep) {
  const part = [];
  legsUndo(part, viewOf(p, colour), prevPath, keep);
  const offset = colour === RED ? 0 : p.split;
  part.forEach((count, i) => {
    if (count) legs[offset + i] = (legs[offset + i] || 0) + count;
  });
}

// A hint: -> { colour, correctCell, wrongCell }. The colour asked for first; when its path is as
// far as it goes (done, or nothing to say), the other colour's. correctCell = the next cell of the
// stored solution, wrongCell = the first cell where the path leaves it (features/hints.js
// computeHint); both null when there is nothing to hint.
export function hintTwo(p, paths, colour = RED) {
  const none = { colour, correctCell: null, wrongCell: null };
  const solution = solutionOf(p);
  const parts = solution && splitPath(p, solution);
  if (!parts) return none;
  for (const c of [colour, 1 - colour]) {
    const hint = computeHint(parts[c], paths[c]);
    if (hint.correctCell != null) return { colour: c, ...hint };
  }
  return none;
}
