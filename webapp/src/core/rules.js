import { startCell, endCell, maxNumber, cellCount, checkpointCells } from './model.js';
import { splitPath } from './twopaths.js';
import { hasWall, arrowAllows } from './edges.js';
import { adjacent, isPortalPair } from './geom.js';

export const gridAdjacent = (n, a, b) => Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs(a % n - b % n) === 1;
// One-way arrows (p.arrows) allow a step in their own direction only. Undoing a step (see step()
// below) is not a step, so it stays free.
// A portal pair (Teleport puzzle, core/geom.js) is an edge like any other, except that no wall
// stands on it.
export const canStep = (p, a, b) => isPortalPair(p.portals, a, b) || (adjacent(p.n, p.wrap, a, b)
  && !hasWall(p, a, b)
  && !(p.holes && (p.holes[a] || p.holes[b]))
  && !(p.arrows && !arrowAllows(p.arrows, p.n, a, b)));

// Two paths puzzle (p.split, core/twopaths.js): both paths together cover every cell, share none, take
// every step over an open edge, and each visits its own numbers in order, the red from 1 to
// split, the blue from split + 1 to the last number, ending on its last one.
export function isSolvedPaths(p, red, blue) {
  const k = p.split;
  const K = maxNumber(p);
  const cells = checkpointCells(p);
  if (red.length + blue.length !== cellCount(p)) return false;
  if (red[0] !== cells[0] || red[red.length - 1] !== cells[k - 1]) return false;
  if (blue[0] !== cells[k] || blue[blue.length - 1] !== cells[K - 1]) return false;
  const seen = new Set();
  const walk = (path, first, last) => {
    let next = first;
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      if (seen.has(cell) || (i > 0 && !canStep(p, path[i - 1], cell))) return false;
      seen.add(cell);
      const number = p.cp[cell];
      if (number && number !== next++) return false;
    }
    return next === last + 1;
  };
  return walk(red, 1, k) && walk(blue, k + 1, K) && seen.size === cellCount(p);
}

// Full-board solved check: covers every cell, starts at 1, ends on the max checkpoint, checkpoints visited in ascending order.
// Two paths puzzle: `path` is the red path followed by the blue one (a solution path), see isSolvedPaths.
// Loop puzzle: no fixed end; the last cell has to touch cell 1 through an open edge (the ring closes).
// Exact puzzle: every number sits at its own step (the cell numbered k is path[k - 1]), which also
// makes the order right.
export function isSolved(p, path) {
  if (p.split) {
    const parts = splitPath(p, path);
    return parts !== null && isSolvedPaths(p, parts[0], parts[1]);
  }
  if (path.length !== cellCount(p)) return false;
  if (path[0] !== startCell(p)) return false;
  if (p.loop ? !canStep(p, path[path.length - 1], path[0]) : path[path.length - 1] !== endCell(p)) return false;
  if (p.exact) {
    for (let cell = 0; cell < p.cp.length; cell++) {
      if (p.cp[cell] && path[p.cp[cell] - 1] !== cell) return false;
    }
    return true;
  }
  let prev = 0, seen = 0;
  for (const c of path) { const v = p.cp[c]; if (v) { if (v < prev) return false; prev = v; seen++; } }
  return seen === p.cp.reduce((k, v) => k + (v ? 1 : 0), 0);
}

// Apply one move to `path` (mutated in place). Returns 'push' | 'pop' | 'trunc' | 'reset' | null.
// opts.truncate: revisiting any earlier cell cuts the path back to it (else only the previous cell = one-step undo).
// opts.strictOrder: refuse checkpoints out of order, and refuse moving on after the final
// checkpoint (not in a Loop puzzle: the ring goes on past K, back to cell 1). Exact puzzle: refuse a numbered cell on any step but its number, and any other cell
// on a step that has a number.
export function step(p, path, cell, opts = {}) {
  const len = path.length, start = startCell(p);
  if (len === 0) { if (cell !== start) return null; path.push(cell); return 'push'; }
  if (len > 1 && cell === path[len - 2]) { path.pop(); return 'pop'; }
  const at = path.indexOf(cell);
  if (at >= 0) { if (opts.truncate && at < len - 1) { path.length = at + 1; return 'trunc'; } return null; }
  const last = path[len - 1];
  if (!canStep(p, last, cell)) { if (cell === start && !opts.strictOrder) { path.length = 0; path.push(cell); return 'reset'; } return null; }
  if (opts.strictOrder && p.exact) {
    const number = p.cp[cell];
    const stepNow = len + 1;
    if (number ? number !== stepNow : p.cp.indexOf(stepNow) >= 0) return null;
  } else if (opts.strictOrder) {
    const K = maxNumber(p);
    if (K > 1 && !p.loop && p.cp[last] === K) return null;
    const m = p.cp[cell];
    if (m > 0) { let hi = 0; for (const c of path) if (p.cp[c] > hi) hi = p.cp[c]; if (m !== hi + 1) return null; }
  }
  path.push(cell); return 'push';
}
