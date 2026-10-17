import { bridgeCells } from '../twopaths.js';
import { edgeId, setWallId } from '../edges.js';
import { gridDist } from '../geom.js';

// Solver of a Two paths puzzle (puzzle.split = k, core/model.js and core/twopaths.js): the red path
// (numbers 1..k) and the blue path (numbers k+1..K) cover every cell, share none, and each visits
// its own numbers in order, the red from 1 to k, the blue from k+1 to K.
//
// One search of the standard solver does it. Join the last red cell (number k) to the first blue
// cell (number k+1) by a bridge: a portal pair (core/geom.js) that the path must use (a mustUse
// edge, solve.js). Then two paths that cover the board are exactly one Hamiltonian path of the
// board plus the bridge, that goes 1..K in order and crosses the bridge once: its red part is the
// first path, its blue part the second. Nothing else is needed, so every option of solve() (prune,
// propagation, forced prefix, ...) reaches the search unchanged.
//
// A grid edge between the two bridge cells would join red to blue, which no path may do: it is
// walled for the search (the bridge replaces it).
//
// search(puzzle, opts): the standard search (solve.js searchPaths).
// opts.mustUse [a, b] or a list of edges: also required, next to the bridge (the wall check of
// gen/walls.js: the freed edge). A grid edge between the two bridge cells is never walked.
// Returns solve()'s result; a path in it is the merged path: red cells, then blue cells (cut it
// with splitPath() of core/twopaths.js). The numbers of such a puzzle cannot sit on a portal in
// the editor's eyes (model.js), but the search does not mind.
export function solveTwo(p, opts, search) {
  if (p.holes || p.arrows || p.exact || p.wrap || p.loop || p.portals) {
    throw new Error('solve: a Two paths puzzle cannot have holes, arrows, Exact numbers, '
      + 'wrap-around, a loop or portals (yet)');
  }
  const [a, b] = bridgeCells(p);
  if (a === undefined || b === undefined || a < 0 || b < 0) {
    return { count: 0, exceeded: false, nodes: 0, paths: opts.capture ? [] : undefined };
  }
  let walls = p.walls;
  if (gridDist(p.n, false, a, b) === 1) {
    walls = p.walls.slice();
    setWallId(walls, edgeId(p.n, a, b), true);
  }
  const q = { n: p.n, cp: p.cp, walls, portals: [[a, b]] };
  const extra = !opts.mustUse ? [] : Array.isArray(opts.mustUse[0]) ? opts.mustUse : [opts.mustUse];
  // the grid edge between the bridge cells (walled above) is one no path walks: nothing to find
  if (extra.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
    return { count: 0, exceeded: false, nodes: 0, paths: opts.capture ? [] : undefined };
  }
  return search(q, { ...opts, mustUse: [[a, b], ...extra] });
}
