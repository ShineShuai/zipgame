import { makePuzzle, clonePuzzle, labelCount } from '../model.js';
import { makeRng, shuffle } from '../rng.js';
import { backbite, warnsdorff } from './hampath.js';
import { randomCheckpoints } from './checkpoints.js';
import { solve } from '../solver/solve.js';
import { trapMetrics, trapGradeOf, EXACT_MODEL } from '../trap.js';
import { targetBand, maxTargetGrade, missOf, TARGET_CFG } from './target.js';

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
//
// With a target grade (o.grade, generateExact below) the same start is a hill-climb instead: the
// grade is the trap grade of core/trap.js under EXACT_MODEL, and the numbers of the fewest-numbers
// puzzle are moved along the solution path (a number keeps its count, not its place) while the
// score does not fall and the puzzle stays unique; a try that cannot reach the grade is followed
// by a fresh path. Counts of tries, proposals and solver nodes bound it, never a clock.

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

// Designer helper (random, unseeded by design: the caller supplies rnd): a random Hamiltonian path
// with K of its cells numbered by their steps (the start, the end and K - 2 random ones in
// between), no walls. Unique only by luck: the designer solves it and adds numbers or walls.
export function randomExactPuzzle(n, K, rnd) {
  const path = backbite(n, rnd);
  const p = makePuzzle(n);
  p.exact = true;
  const count = Math.max(2, Math.min(K, path.length));
  randomCheckpoints(path.length, count, rnd).forEach(at => {
    p.cp[path[at]] = at + 1;
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

// ---------- target grade ----------
// Fresh paths (tries) per run and shift proposals per climb, by grid size: the play app's budget.
export const EXACT_TARGET_TRIES = { 5: 6, 6: 8, 7: 8, 8: 8, 9: 6, 10: 6, 11: 4, 12: 4 };
export const EXACT_CLIMB_PROPOSALS = { 5: 40, 6: 40, 7: 60, 8: 60, 9: 40, 10: 40, 11: 30, 12: 30 };
const triesFor = n => EXACT_TARGET_TRIES[n] || 3;
const proposalsFor = n => EXACT_CLIMB_PROPOSALS[n] || 20;
// A shift moves a number this many steps at most.
const MAX_SHIFT = 3;

// The trap score of an Exact puzzle (the model that fits it): -Infinity when it has no solution
// path.
export function exactScore(p) {
  const m = trapMetrics(p, undefined, p.path, EXACT_MODEL);
  return m.ok ? m.predicted : -Infinity;
}

// One proposed change: the number of a random interior numbered cell moves 1..MAX_SHIFT steps
// along the solution path (to the cell the path has there; the number is now that step), when that
// cell is free. -> a new puzzle (same path), or null when the draw lands nowhere. Not checked for
// uniqueness: the caller does that.
export function shiftNumber(p, rnd) {
  const total = p.n * p.n;
  const cells = [];
  for (let cell = 0; cell < p.cp.length; cell++) {
    if (p.cp[cell] > 1 && p.cp[cell] < total) cells.push(cell);
  }
  if (!cells.length) return null;
  const cell = cells[Math.floor(rnd() * cells.length)];
  const move = (1 + Math.floor(rnd() * MAX_SHIFT)) * (rnd() < 0.5 ? -1 : 1);
  const step = p.cp[cell] + move;
  if (step < 2 || step > total - 1) return null;
  const target = p.path[step - 1];
  if (p.cp[target]) return null;
  const moved = clonePuzzle(p);
  moved.path = p.path;
  moved.cp[cell] = 0;
  moved.cp[target] = step;
  return moved;
}

// Hill-climb toward the band: shift proposals, each kept when the puzzle is still unique (a check
// that hits checkCap counts as not) and its score has not fallen. Stops at the band, or after
// `proposals` tries. Events: { frac: null, labels, score }. Returns { puzzle, score }.
export function* climbNumbers(p, score, band, rnd, opts) {
  const { proposals, checkCap, solveOpts = EXACT_SOLVE } = opts;
  let puzzle = p;
  let current = score;
  for (let i = 0; i < proposals && missOf(current, band) > 0; i++) {
    const moved = shiftNumber(puzzle, rnd);
    if (moved) {
      const check = solve(moved, { limit: 2, nodeCap: checkCap, ...solveOpts });
      if (!check.exceeded && check.count === 1) {
        const next = exactScore(moved);
        if (next >= current) {
          puzzle = moved;
          current = next;
        }
      }
    }
    const progress = (i + 1) / proposals;
    yield { frac: null, labels: labelCount(puzzle), score: current, progress };
  }
  return { puzzle, score: current };
}

// Easier: numbers of the solution path are added back, a puzzle with more numbers is still unique
// and, as a rule, easier. Stops inside the band, or when an addition would overshoot it (then
// other places are tried, `attempts` in all). Returns { puzzle, score }.
export function easeNumbers(p, score, band, rnd, attempts) {
  const total = p.n * p.n;
  let puzzle = p;
  let current = score;
  for (let i = 0; i < attempts && current > band.b; i++) {
    const free = [];
    for (let step = 2; step < total; step++) {
      if (!puzzle.cp[puzzle.path[step - 1]]) free.push(step);
    }
    if (!free.length) break;
    const step = free[Math.floor(rnd() * free.length)];
    const added = clonePuzzle(puzzle);
    added.path = puzzle.path;
    added.cp[puzzle.path[step - 1]] = step;
    const next = exactScore(added);
    if (next >= band.a) {
      puzzle = added;
      current = next;
    }
  }
  return { puzzle, score: current };
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
// o.grade: a target trap grade (see generateTargetedExact; then o.candidates, o.refineNodes and
// o.path do not apply). The puzzle carries .path (its solution) and .seed. Tuned for 5 <= n <= 12.
export function* generateExact(n, seed, o = {}) {
  if (o.grade != null) return yield* generateTargetedExact(n, seed, o);
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

// A puzzle of a target trap grade (the fewest-numbers puzzle of a fresh path, climbed toward the
// grade). o.grade: the target, clamped to what the size allows (maxTargetGrade); o.atLeast
// (default true): "this grade or harder", false = that grade only (numbers are added back when the
// minimal puzzle is harder); o.tries / o.proposals override the budgets above; o.checkCapX scales
// the uniqueness checks; o.floor, o.solveOpts as in generateExact. Events { frac, labels } as
// there. The puzzle carries .path, .seed and .score = { predicted, grade, target, atLeast, hit,
// miss, labels, tries } (predicted = its trap score, miss = how far that is outside the target
// band, 0 inside; hit = miss is 0). Without a hit the closest puzzle of all the tries is returned.
export function* generateTargetedExact(n, seed, o = {}) {
  const cells = n * n;
  const rnd = makeRng(seed);
  const target = Math.min(Math.max(0, Math.round(o.grade)), maxTargetGrade(n, EXACT_MODEL));
  const atLeast = o.atLeast ?? true;
  const band = targetBand(target, n, EXACT_MODEL, TARGET_CFG.margin, atLeast);
  const tries = o.tries ?? triesFor(n);
  const proposals = o.proposals ?? proposalsFor(n);
  const floor = Math.max(2, o.floor ?? 2);
  const solveOpts = o.solveOpts || EXACT_SOLVE;
  const checkCap = Math.max(
    EXACT_MIN_CHECK_CAP,
    Math.round(EXACT_CHECK_CAP_PER_CELL * cells * (o.checkCapX ?? 1)),
  );

  let best = null;
  let bestMiss = Infinity;
  let used = 0;
  for (let attempt = 0; attempt < tries && bestMiss > 0; attempt++) {
    used++;
    const path = pathFor(n, rnd, o.path);
    let p = fullExactPuzzle(n, path);
    const events = minimizeLabels(p, path.slice(1, -1), rnd, checkCap, { floor, solveOpts });
    let step = events.next();
    for (; !step.done; step = events.next()) {
      const inside = 0.5 * ((cells - step.value.labels) / cells);
      yield { frac: (attempt + inside) / tries, labels: step.value.labels };
    }
    let score = exactScore(p);
    if (score < band.a) {
      const climb = climbNumbers(p, score, band, rnd, { proposals, checkCap, solveOpts });
      let move = climb.next();
      for (; !move.done; move = climb.next()) {
        const inside = 0.5 + 0.5 * move.value.progress;
        yield { frac: (attempt + inside) / tries, labels: move.value.labels };
      }
      ({ puzzle: p, score } = move.value);
    } else if (score > band.b) {
      ({ puzzle: p, score } = easeNumbers(p, score, band, rnd, cells));
    }
    const miss = missOf(score, band);
    if (miss < bestMiss) {
      best = { puzzle: p, score };
      bestMiss = miss;
    }
    yield { frac: (attempt + 1) / tries, labels: labelCount(best.puzzle) };
  }
  const { puzzle, score } = best;
  puzzle.seed = seed;
  puzzle.score = {
    predicted: score,
    grade: trapGradeOf(score, EXACT_MODEL),
    target,
    atLeast,
    hit: bestMiss === 0,
    miss: bestMiss,
    labels: labelCount(puzzle),
    tries: used,
  };
  yield { frac: 1, labels: puzzle.score.labels };
  return puzzle;
}
