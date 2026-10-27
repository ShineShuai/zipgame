import { parse, serialize } from '../core/format.js';
import { adjacent, isPortalPair } from '../core/geom.js';
import { cellCount, endCell, maxNumber, startCell } from '../core/model.js';
import { canStep, isSolved } from '../core/rules.js';
import { solveSurface } from '../core/surface/solve.js';
import { splitPath } from '../core/twopaths.js';
import { edgeBetween } from '../core/surface/topology.js';
import { solutionOf } from '../features/hints.js';
import {
  canStep as surfaceCanStep, endCell as surfaceEnd, isSolved as surfaceSolved, isSurfacePuzzle,
  looksLikeSurface, parseSurface, serializeSurface, startCell as surfaceStart, topologyOf,
} from '../core/surface/puzzle.js';

// What Patchwork asks of a board, whatever its geometry (pure). Two kinds of puzzle exist:
//   flat     the square grid of the play app, any variant (core/model.js, core/rules.js)
//   surface  a graph of cells: the flat Pentagon board, later the solids (core/surface/)
// modelOf(puzzle) -> {
//   total       cell numbers are 0 .. total - 1
//   cells       the cells of the board (a flat puzzle with holes has fewer than `total`)
//   start, end  the cells of the first and the last number
//   ends        the cells where a path must end, so that a line may leave them one way only
//   canStep(a, b)  may a path step from a to b (walls, holes, one-way arrows; portals)
//   linked(a, b)   do the cells touch (across a seam too), or are they the ends of a portal pair
//   solved(path)   is `path` a solution
// }
// The kinds of surface puzzle that Patchwork plays so far (core/surface/puzzle.js `kind`).
export const PLAYED_SURFACES = ['pentagon', 'tetra', 'cube', 'ball'];

const cache = new WeakMap();

// The cells at which a path begins or ends: cell 1 and the last number; in a Two paths puzzle both
// colours have their two (1, k, k + 1, K); a Loop puzzle is a ring and has none.
function endsOf(puzzle) {
  if (puzzle.loop) {
    return new Set();
  }
  if (puzzle.split) {
    const last = maxNumber(puzzle);
    return new Set(
      [1, puzzle.split, puzzle.split + 1, last].map(number => puzzle.cp.indexOf(number)),
    );
  }
  return new Set([startCell(puzzle), endCell(puzzle)]);
}

function flatModel(puzzle) {
  return {
    ends: endsOf(puzzle),
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
    ends: new Set([surfaceStart(puzzle), surfaceEnd(puzzle)]),
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

// The one solution of the puzzle, as a path of cells (the one the generator made, or solved here);
// null when it cannot be found. The hint is made from it.
export function solutionFor(puzzle) {
  if (puzzle.path || !isSurfacePuzzle(puzzle)) {
    return solutionOf(puzzle);
  }
  puzzle.path = solveSurface(puzzle, { limit: 1, nodeCap: 2000000 }).path;
  return puzzle.path;
}

// The edges of the solution, in path order, as pairs of cells: the steps of the path, plus the one
// that closes a Loop ring; a Two paths solution is the red path and the blue path, joined by a
// bridge that is no line.
export function solutionEdges(puzzle) {
  const path = solutionFor(puzzle);
  if (!path) {
    return null;
  }
  const steps = cells => cells.slice(1).map((cell, i) => [cells[i], cell]);
  if (puzzle.split) {
    return (splitPath(puzzle, path) ?? [path]).flatMap(steps);
  }
  return puzzle.loop ? [...steps(path), [path[path.length - 1], path[0]]] : steps(path);
}
