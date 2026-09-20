import { solve } from '../core/solver/solve.js';

export const maxHints = p => Math.min(p.n, p.cp.reduce((k, v) => k + (v ? 1 : 0), 0));

// The unique solution: stored on generated puzzles; solved lazily (and cached) for imported / Game-of-Day ones.
export function solutionOf(p) {
  if (!p.path) { const r = solve(p, { limit: 1, nodeCap: 2000000, capture: true, prop: true }); p.path = r.paths && r.paths[0] || null; }
  return p.path;
}

// -> { correctCell, wrongCell }: on track = next move; diverged = what should have been played + the wrong cell; done/unknown = nulls.
export function computeHint(solution, path) {
  if (!solution) return { correctCell: null, wrongCell: null };
  let i = 0; while (i < path.length && i < solution.length && path[i] === solution[i]) i++;
  if (i < path.length) return { correctCell: solution[i], wrongCell: path[i] };
  return { correctCell: i < solution.length ? solution[i] : null, wrongCell: null };
}
