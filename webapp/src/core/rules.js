import { startCell, endCell, maxNumber } from './model.js';
import { hasWall } from './edges.js';

export const gridAdjacent = (n, a, b) => Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs(a % n - b % n) === 1;
export const canStep = (p, a, b) => gridAdjacent(p.n, a, b) && !hasWall(p, a, b);

// Full-board solved check: covers every cell, starts at 1, ends on the max checkpoint, checkpoints visited in ascending order.
export function isSolved(p, path) {
  if (path.length !== p.n * p.n) return false;
  if (path[0] !== startCell(p) || path[path.length - 1] !== endCell(p)) return false;
  let prev = 0, seen = 0;
  for (const c of path) { const v = p.cp[c]; if (v) { if (v < prev) return false; prev = v; seen++; } }
  return seen === p.cp.reduce((k, v) => k + (v ? 1 : 0), 0);
}

// Apply one move to `path` (mutated in place). Returns 'push' | 'pop' | 'trunc' | 'reset' | null.
// opts.truncate: revisiting any earlier cell cuts the path back to it (else only the previous cell = one-step undo).
// opts.strictOrder: refuse checkpoints out of order, and refuse moving on after the final checkpoint.
export function step(p, path, cell, opts = {}) {
  const len = path.length, start = startCell(p);
  if (len === 0) { if (cell !== start) return null; path.push(cell); return 'push'; }
  if (len > 1 && cell === path[len - 2]) { path.pop(); return 'pop'; }
  const at = path.indexOf(cell);
  if (at >= 0) { if (opts.truncate && at < len - 1) { path.length = at + 1; return 'trunc'; } return null; }
  const last = path[len - 1];
  if (!canStep(p, last, cell)) { if (cell === start && !opts.strictOrder) { path.length = 0; path.push(cell); return 'reset'; } return null; }
  if (opts.strictOrder) {
    const K = maxNumber(p);
    if (K > 1 && p.cp[last] === K) return null;
    const m = p.cp[cell];
    if (m > 0) { let hi = 0; for (const c of path) if (p.cp[c] > hi) hi = p.cp[c]; if (m !== hi + 1) return null; }
  }
  path.push(cell); return 'push';
}
