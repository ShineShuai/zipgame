import { solutionEdges } from './model.js';

// A hint, asked for with the button (never automatic). Uses the puzzle's one solution:
//   wrong  an edge that has been drawn but is not part of the solution (the first one drawn)
//   next   otherwise, the first edge of the solution, in path order, that is not drawn yet
//   none   nothing to say (solved, or the solution is unknown)
// -> { kind, edge: [a, b] | null }
export function coopHint(puzzle, drawing) {
  const solution = solutionEdges(puzzle);
  if (!solution) {
    return { kind: 'none', edge: null };
  }
  const wanted = new Set(solution.map(([a, b]) => drawing.key(a, b)));
  const wrong = drawing.edges().find(([a, b]) => !wanted.has(drawing.key(a, b)));
  if (wrong) {
    return { kind: 'wrong', edge: wrong };
  }
  const next = solution.find(([a, b]) => !drawing.has(a, b));
  return next ? { kind: 'next', edge: next } : { kind: 'none', edge: null };
}
