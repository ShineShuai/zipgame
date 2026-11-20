// The reference the solver tests compare with: every solution of a puzzle by plain depth-first
// search, with none of the solver's pruning. One search for all variants; a variant states only
// what is its own, as small pieces:
//   moves(cell, out)  pushes the cells a step from `cell` may go to (walls, portals, wrapping)
//   total             how many cells a path covers (the cells that are left, when there are holes)
//   numbers           'order': numbered cells in the order 1..K, ending on K (the default)
//                     'step':  a number is the step it is taken on, no other step is a number
//   endOnLast         the path ends on the last number (not for a ring, which closes instead)
//   accept(path)      a last test of a whole path (a ring: its last cell steps to its first)
// -> { count, paths }; paths are cell lists, kept unless `keep` is false (count only).
import { cellCount } from '../src/core/model.js';
import { canStep } from '../src/core/rules.js';
import { neighbourCell, portalPartner } from '../src/core/geom.js';

export function oracle(
  p,
  { moves, total = cellCount(p), numbers = 'order', endOnLast = true, accept = null, keep = true },
) {
  const K = Math.max(...p.cp);
  const start = p.cp.indexOf(1);
  const claimed = new Set(p.cp.filter(Boolean));
  const visited = new Uint8Array(p.cp.length);
  const path = [];
  const paths = [];
  const scratch = []; // one list of moves per depth
  let count = 0;

  const found = () => {
    count++;
    if (keep) {
      paths.push(path.slice());
    }
  };
  const walk = (cell, length, need) => {
    const number = p.cp[cell];
    let next = need;
    if (numbers === 'step') {
      if (number ? number !== length : claimed.has(length)) {
        return;
      }
    } else if (number) {
      if (number !== need) {
        return;
      }
      next++;
    }
    visited[cell] = 1;
    path.push(cell);
    if (length === total) {
      const numbersDone = numbers === 'step' || (next === K + 1 && (!endOnLast || number === K));
      if (numbersDone && (!accept || accept(path))) {
        found();
      }
    } else {
      const options = (scratch[length] ??= []);
      options.length = 0;
      moves(cell, options);
      for (const to of options) {
        if (!visited[to]) {
          walk(to, length + 1, next);
        }
      }
    }
    path.pop();
    visited[cell] = 0;
  };
  if (start >= 0) {
    walk(start, 1, 1);
  }
  return { count, paths };
}

// The solutions as sorted "a,b,c" strings, for comparing with the solver's.
export const keysOf = ({ paths }) => paths.map(path => path.join(',')).sort();

// The rules of the grid written out here, independent of core/rules.js: four neighbours, a wall
// bit between two cells (1 on the right of the lower cell, 2 below it), a portal as a fifth move.
export const gridMoves = p => (cell, out) => {
  const { n } = p;
  const row = (cell / n) | 0;
  const col = cell % n;
  const open = to => !(p.walls[Math.min(cell, to)] & (Math.abs(cell - to) === 1 ? 1 : 2));
  const steps = [
    [col < n - 1, cell + 1],
    [col > 0, cell - 1],
    [row < n - 1, cell + n],
    [row > 0, cell - n],
  ];
  for (const [inside, to] of steps) {
    if (inside && open(to)) {
      out.push(to);
    }
  }
  const partner = p.portals ? portalPartner(p.portals, cell) : -1;
  if (partner >= 0) {
    out.push(partner);
  }
};

// The rules as core/rules.js states them, for the variants whose moves are canStep (arrows,
// wrapping, holes): the neighbours of the cell (round the edge when the board wraps) and its
// portal partner that a step may reach, in the order of their numbers.
export const ruleMoves = p => (cell, out) => {
  for (let dir = 0; dir < 4; dir++) {
    const to = neighbourCell(p.n, Boolean(p.wrap), cell, dir);
    if (to >= 0 && canStep(p, cell, to)) {
      out.push(to);
    }
  }
  const partner = p.portals ? portalPartner(p.portals, cell) : -1;
  if (partner >= 0 && canStep(p, cell, partner)) {
    out.push(partner);
  }
  out.sort((a, b) => a - b);
};

// The moves of a surface (the solids, the Pentagon): the neighbours of the topology that no wall
// closes.
export const topologyMoves = (p, top, slots) => (cell, out) => {
  for (let slot = 0; slot < top.deg[cell]; slot++) {
    const to = top.nb[cell * slots + slot];
    if (to >= 0 && !p.walls[top.edgeAt[cell * slots + slot]]) {
      out.push(to);
    }
  }
};

// A ring: the path closes when its last cell may step to its first.
export const closes = p => path => canStep(p, path[path.length - 1], path[0]);

// Every solution under the rules of core/rules.js, as sorted "a,b,c" strings.
export const solutionKeys = p => keysOf(oracle(p, { moves: ruleMoves(p) }));
