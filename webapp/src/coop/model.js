import { parse, serialize } from '../core/format.js';
import { adjacent, isPortalPair } from '../core/geom.js';
import { cellCount, endCell, startCell } from '../core/model.js';
import { canStep, isSolved } from '../core/rules.js';
import { edgeBetween } from '../core/surface/topology.js';
import {
  canStep as surfaceCanStep, endCell as surfaceEnd, isSolved as surfaceSolved, isSurfacePuzzle,
  looksLikeSurface, parseSurface, serializeSurface, startCell as surfaceStart, topologyOf,
} from '../core/surface/puzzle.js';

// What Free draw asks of a board, whatever its geometry (pure). Two kinds of puzzle exist:
//   flat     the square grid of the play app, any variant (core/model.js, core/rules.js)
//   surface  a graph of cells: the flat Pentagon board, later the solids (core/surface/)
// modelOf(puzzle) -> {
//   total       cell numbers are 0 .. total - 1
//   cells       the cells of the board (a flat puzzle with holes has fewer than `total`)
//   start, end  the cells of the first and the last number
//   canStep(a, b)  may a path step from a to b (walls, holes, one-way arrows; portals)
//   linked(a, b)   do the cells touch (across a seam too), or are they the ends of a portal pair
//   solved(path)   is `path` a solution
// }
// The kinds of surface puzzle that Free draw plays so far (core/surface/puzzle.js `kind`).
export const PLAYED_SURFACES = ['pentagon'];

const cache = new WeakMap();

function flatModel(puzzle) {
  return {
    total: puzzle.n * puzzle.n,
    cells: cellCount(puzzle),
    start: startCell(puzzle),
    end: endCell(puzzle),
    canStep: (a, b) => canStep(puzzle, a, b),
    linked: (a, b) => a !== b
      && (adjacent(puzzle.n, puzzle.wrap, a, b) || isPortalPair(puzzle.portals, a, b)),
    solved: path => isSolved(puzzle, path),
  };
}

function surfaceModel(puzzle) {
  const top = topologyOf(puzzle);
  return {
    total: top.T,
    cells: top.T,
    start: surfaceStart(puzzle),
    end: surfaceEnd(puzzle),
    canStep: (a, b) => surfaceCanStep(puzzle, a, b),
    linked: (a, b) => a !== b && edgeBetween(top, a, b) >= 0,
    solved: path => surfaceSolved(puzzle, path),
  };
}

export function modelOf(puzzle) {
  let model = cache.get(puzzle);
  if (!model) {
    model = isSurfacePuzzle(puzzle) ? surfaceModel(puzzle) : flatModel(puzzle);
    cache.set(puzzle, model);
  }
  return model;
}

// The puzzle as text, for the other device and for the export, and back. `path` is the solution.
export const serializePuzzle = (puzzle, opts) => (isSurfacePuzzle(puzzle)
  ? serializeSurface(puzzle, opts) : serialize(puzzle, opts));

export const parsePuzzle = text => (looksLikeSurface(text) ? parseSurface(text) : parse(text));
