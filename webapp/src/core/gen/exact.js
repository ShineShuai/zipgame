import { makePuzzle, labelCount } from '../model.js';
import { makeRng, shuffle } from '../rng.js';
import { backbite, warnsdorff } from './hampath.js';
import { solve } from '../solver/solve.js';

// Generator of "Exact" (Hidato-style) puzzles: the number of a cell is its step on the path, no
// walls, as few numbers as possible, and exactly one solution. Generators (function*) so callers
// can drive them synchronously or time-sliced; progress events are { frac, labels }.
//
// How: a random Hamiltonian path, every cell numbered by its step (trivially unique), then the
// numbers are tried for removal in random order, once each; a number stays when the puzzle
// without it has a second solution (or the check hit its node cap). Removing numbers only adds
// solutions, so a number that has to stay never becomes removable later: one pass leaves a set
// no number can be taken from. Numbers 1 and the cell count (the start and the end) always stay.
// Of several such candidates the one with the fewest numbers wins and gets a deeper look at the
// numbers it kept only because a check hit its cap.

// Solver options of the removal checks (see solve.js).
export const EXACT_SOLVE = { prop: true, parity: true };
// Candidates per grid size: the quality/time knob (the numbers left vary a lot between paths).
export const EXACT_CANDIDATES = { 5: 24, 6: 24, 7: 16, 8: 12, 9: 8, 10: 6, 11: 4, 12: 4 };
const candidatesFor = n => EXACT_CANDIDATES[n] || 2;
// The grid sizes the play app offers for this variant.
export const EXACT_MAX_OFFERED = 12;
export const EXACT_SIZES = Object.keys(EXACT_CANDIDATES)
  .map(Number)
  .filter(n => n <= EXACT_MAX_OFFERED);
// Solver-node cap of one removal check, per cell of the board (never below the minimum).
export const EXACT_CHECK_CAP_PER_CELL = 400;
export const EXACT_MIN_CHECK_CAP = 4000;
// The second look at the numbers a check could not decide: total node budget per cell, and the
// per-check caps of its passes as multiples of the first cap.
export const EXACT_REFINE_NODES_PER_CELL = 16000;
export const EXACT_REFINE_CAP_X = [4, 16];
// Share of the progress bar of the second look.
const REFINE_SHARE = 0.15;

// A puzzle that numbers every cell of `path` by its step: unique, and the start of the removal.
export function fullExactPuzzle(n, path) {
  const p = makePuzzle(n);
  p.exact = true;
  path.forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  p.path = path;
  return p;
}

// Take the number off `cell`, check with at most `cap` solver nodes that the puzzle still has
// exactly one solution, and put the number back unless it is removable. Returns { removable,
// capped, nodes }. A number that is neither removable nor capped is needed for good; a capped
// one is undecided.
export function tryRemoveLabel(p, cell, cap, solveOpts = EXACT_SOLVE) {
  const step = p.cp[cell];
  p.cp[cell] = 0;
  const check = solve(p, { limit: 2, nodeCap: cap, ...solveOpts });
  const removable = !check.exceeded && check.count === 1;
  if (!removable) p.cp[cell] = step;
  return { removable, capped: !!check.exceeded, nodes: check.nodes };
}

// Try to remove the number of every cell in `order` (random order, once each). Mutates p.cp.
// Needs p unique. opts: { floor (default 2: stop once that many numbers are left), bound (stop
// early with { aborted: true, kept: Infinity } once the numbers that had to stay reach it: the
// caller has no use for such a candidate), solveOpts }. Events: { frac: null, labels } (the
// count left so far). Returns { removed, kept, uncertain } (kept = numbers left, uncertain =
// cells whose number stayed only because its check hit checkCap).
export function* minimizeLabels(p, order, rnd, checkCap, opts = {}) {
  const { floor = 2, bound = Infinity, solveOpts = EXACT_SOLVE } = opts;
  const list = shuffle([...order], rnd);
  const start = labelCount(p);
  let kept = start;
  let retained = 2;
  const uncertain = [];
  for (const cell of list) {
    if (kept <= floor) break;
    const r = tryRemoveLabel(p, cell, checkCap, solveOpts);
    if (r.removable) {
      kept--;
    } else {
      if (r.capped) uncertain.push(cell);
      if (++retained >= bound) return { removed: 0, kept: Infinity, aborted: true };
    }
    yield { frac: null, labels: kept };
  }
  return { removed: start - kept, kept, uncertain };
}

// A deeper look at the numbers minimizeLabels() kept only because a check hit its node cap: one
// pass per entry of opts.caps (ascending absolute per-check caps), at most opts.budget solver
// nodes in total (a node count, never a clock, so a seeded run stays reproducible). Needs p
// unique. opts: { caps, budget, labels (the count now), floor, solveOpts }. Events: { frac: null,
// labels, nodes, budget }. Returns { removed, kept, left, nodes }.
export function* refineLabels(p, uncertain, rnd, opts) {
  const { caps, budget, floor = 2, solveOpts = EXACT_SOLVE } = opts;
  let current = opts.labels;
  let todo = shuffle([...uncertain], rnd);
  let nodes = 0;
  let removed = 0;
  for (const cap of caps) {
    const undecided = [];
    for (let i = 0; i < todo.length; i++) {
      const room = budget - nodes;
      if (room <= 0 || current <= floor) {
        undecided.push(...todo.slice(i));
        break;
      }
      const r = tryRemoveLabel(p, todo[i], Math.min(cap, room), solveOpts);
      nodes += r.nodes;
      if (r.removable) {
        removed++;
        current--;
      } else if (r.capped) {
        undecided.push(todo[i]);
      }
      yield { frac: null, labels: current, nodes, budget };
    }
    todo = undecided;
    if (!todo.length || nodes >= budget || current <= floor) break;
  }
  return { removed, kept: current, left: todo, nodes };
}

const pathFor = (n, rnd, kind) => {
  const walk = kind === 'warnsdorff' ? warnsdorff(n, rnd) : null;
  return walk || backbite(n, rnd);
};

// Puzzle with the fewest numbers found for (n, seed): the same seed gives the same puzzle (no
// clock is involved, only node budgets). Events: { frac, labels }; `labels` never increases.
// o.candidates overrides EXACT_CANDIDATES[n]; o.floor: never fewer numbers than that (default 2:
// the start and the end), the difficulty knob (more numbers = easier); o.path: 'backbite'
// (default) | 'warnsdorff' (the standard generator's walk, backbite when it dead-ends);
// o.checkCapX scales the removal-check cap; o.refineNodes: node budget of the second look
// (default EXACT_REFINE_NODES_PER_CELL * n^2, 0 = off); o.solveOpts: solver options of the checks.
// The puzzle carries .path (its solution) and .seed. Tuned for 5 <= n <= 12.
export function* generateExact(n, seed, o = {}) {
  const cells = n * n;
  const rnd = makeRng(seed);
  const wanted = o.candidates || candidatesFor(n);
  const floor = Math.max(2, o.floor ?? 2);
  const solveOpts = o.solveOpts || EXACT_SOLVE;
  const checkCap = Math.max(
    EXACT_MIN_CHECK_CAP,
    Math.round(EXACT_CHECK_CAP_PER_CELL * cells * (o.checkCapX ?? 1)),
  );
  const refineNodes = o.refineNodes ?? EXACT_REFINE_NODES_PER_CELL * cells;
  const refining = refineNodes > 0;
  const minimizeShare = refining ? 1 - REFINE_SHARE : 1;

  let best = null;
  let bestKept = Infinity;
  let bestUncertain = [];
  for (let c = 0; c < wanted; c++) {
    const path = pathFor(n, rnd, o.path);
    const p = fullExactPuzzle(n, path);
    const events = minimizeLabels(p, path.slice(1, -1), rnd, checkCap, {
      floor, bound: bestKept, solveOpts,
    });
    let step = events.next();
    for (; !step.done; step = events.next()) {
      const inside = (c + (cells - step.value.labels) / cells) / wanted;
      yield { frac: minimizeShare * inside, labels: Math.min(bestKept, step.value.labels) };
    }
    const found = step.value;
    if (!found.aborted && found.kept < bestKept) {
      best = p;
      bestKept = found.kept;
      bestUncertain = found.uncertain;
    }
    yield { frac: (minimizeShare * (c + 1)) / wanted, labels: bestKept };
  }

  if (refining && bestUncertain.length && bestKept > floor) {
    const events = refineLabels(best, bestUncertain, rnd, {
      caps: EXACT_REFINE_CAP_X.map(x => x * checkCap),
      budget: refineNodes,
      labels: bestKept,
      floor,
      solveOpts,
    });
    let step = events.next();
    for (; !step.done; step = events.next()) {
      const frac = minimizeShare + (REFINE_SHARE * step.value.nodes) / refineNodes;
      yield { frac, labels: step.value.labels };
    }
    bestKept = step.value.kept;
  }
  yield { frac: 1, labels: bestKept };
  best.seed = seed;
  return best;
}
