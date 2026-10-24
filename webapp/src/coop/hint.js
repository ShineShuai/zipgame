import { solutionFor } from './model.js';

// A hint, asked for with the button (never automatic). Uses the puzzle's one solution:
//   wrong  an edge that has been drawn but is not part of the solution (the first one drawn)
//   next   otherwise, the first edge of the solution, in path order, that is not drawn yet
//   none   nothing to say (solved, or the solution is unknown)
// -> { kind, edge: [a, b] | null }
export function coopHint(puzzle, drawing) {
  const solution = solutionFor(puzzle);
  if (!solution) {
    return { kind: 'none', edge: null };
  }
  const wanted = new Set();
  for (let i = 1; i < solution.length; i++) {
    wanted.add(drawing.key(solution[i - 1], solution[i]));
  }
  const wrong = drawing.edges().find(([a, b]) => !wanted.has(drawing.key(a, b)));
  if (wrong) {
    return { kind: 'wrong', edge: wrong };
  }
  for (let i = 1; i < solution.length; i++) {
    if (!drawing.has(solution[i - 1], solution[i])) {
      return { kind: 'next', edge: [solution[i - 1], solution[i]] };
    }
  }
  return { kind: 'none', edge: null };
}
