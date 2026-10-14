import { startCell, endCell, maxNumber, cellCount } from './model.js';
import { hasWall, arrowAllows } from './edges.js';
import { adjacent } from './geom.js';

export const gridAdjacent = (n, a, b) => Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs(a % n - b % n) === 1;
// One-way arrows (p.arrows) allow a step in their own direction only. Undoing a step (see step()
// below) is not a step, so it stays free.
export const canStep = (p, a, b) => adjacent(p.n, p.wrap, a, b)
  && !hasWall(p, a, b)
  && !(p.holes && (p.holes[a] || p.holes[b]))
  && !(p.arrows && !arrowAllows(p.arrows, p.n, a, b));

// Full-board solved check: covers every cell, starts at 1, ends on the max checkpoint, checkpoints visited in ascending order.
// Loop puzzle: no fixed end; the last cell has to touch cell 1 through an open edge (the ring closes).
// Exact puzzle: every number sits at its own step (the cell numbered k is path[k - 1]), which also
// makes the order right.
export function isSolved(p, path) {
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
