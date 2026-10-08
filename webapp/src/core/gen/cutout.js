import { makePuzzle, cellCount } from '../model.js';
import { makeRng } from '../rng.js';
import { gapCheckpoints } from './checkpoints.js';
import { makeUnique, minimizeWalls, refineWalls, REFINE_CAP_X } from './walls.js';
import {
  REFINE_NODES_PER_CELL,
  PROP_CAP_X,
  CHECK_CAP_X,
  SEED_FRACTION,
  pickK,
} from './generate.js';
import { proposeBoard } from './shapes.js';
import { trapMetrics } from '../trap.js';

// Cutout: Zip on a board with holes. A hole is not drawn and not counted; the path covers every
// other cell, and
// checkpoints, walls and uniqueness work as in the standard game (the solver skips holes, see
// puzzle.holes in model.js).
//
// A hole works like a wall: it constrains the path, so it is a tool, and how many holes there are
// and where they go is
// chosen for the puzzle, not for the shape. generateCutout builds a puzzle on many different
// boards (outline x interior
// holes, see shapes.js) with their own checkpoints, walls minimized as in generate(), scores each
// one and keeps the best:
//
//   score = difficulty - SCORE.wall * walls - SCORE.hole * interior holes
//
// difficulty = the trap model's predicted human rating (core/trap.js, 0-5 scale), the one grade
// here that was fitted to
//   hand ratings (on standard boards of size 5-11: on boards with holes it only ranks candidates,
//   nothing more is claimed).
// the costs = elegance: of two puzzles equally hard, the one with fewer walls and fewer holes
// wins. There is no data for "fun"
//   beyond that; the weights are guesses, kept in SCORE so they can be changed in one place.
// Measured on candidates (6x6-12x12, tools/cutout-eval.mjs): the more interior holes, the higher
// the predicted difficulty
//   (about +0.1 per hole at 7x7-10x10), while outlines with cut corners are easier than a plain
//   board; a board with holes is
//   easier than a standard one on average (8x8: 1.1 against 1.5), and choosing the best of many
//   candidates makes up for it.
//
// Seeded like generate() (same seed => same puzzle, which keeps the tests pinnable), but the app
// seeds it at random: a Cutout
// game has no daily sequence and is never rebuilt from a seed. A shared game carries the puzzle
// itself (core/share-code.js).

export { SILHOUETTES, LABELS, colourCounts, isBalanced, shapeIsViable } from './shapes.js';

export const SCORE = { wall: 0.02, hole: 0.03 };
// Boards tried per puzzle, by size. A candidate costs about 2-6 ms up to 9x9, 13 ms at 10, 24 at
// 11, 45 at 12 and 300 at 16
// (measured), and the best of more candidates is clearly better (the mean score of the winner at
// 10x10: 0.9 for 1 candidate,
// 1.6 for 5, 1.9 for 30), so these keep a puzzle to about a second, 5 s at 16x16.
export const CUTOUT_CANDIDATES = {
  5: 60, 6: 60, 7: 60, 8: 60, 9: 60, 10: 60, 11: 48, 12: 32, 16: 16,
};

const ATTEMPTS_PER_CANDIDATE = 4;
const REFINE_SHARE = 0.2; // the progress bar's shares, as in generate()
const BUILD_SHARE = 0.05;

export const scoreOf = (difficulty, walls, interior) => (
  difficulty - SCORE.wall * walls - SCORE.hole * interior
);

function* tag(gen, extra) {
  for (let step = gen.next(); ; step = gen.next()) {
    if (step.done) {
      return step.value;
    }
    yield step.value && { ...step.value, ...extra };
  }
}

// One candidate on a board: checkpoints along the board's path, then walls until the puzzle is
// unique.
// Returns the puzzle (with .path and .order) or null.
function* buildOn(n, board, K, rnd, caps) {
  const positions = gapCheckpoints(n, board.path, K);
  if (!positions) {
    return null;
  }
  const p = makePuzzle(n);
  p.holes = board.holes.slice();
  positions.forEach((q, i) => {
    p.cp[board.path[q]] = i + 1;
  });
  const options = { ...caps, seedFraction: SEED_FRACTION, K, prop: true };
  const order = yield* makeUnique(p, board.path, rnd, options);
  if (!order) {
    return null;
  }
  p.path = board.path;
  p.order = order;
  return p;
}

// Last resort: every cell numbered along the path.
function numberEveryCell(n, board, seed) {
  const p = makePuzzle(n);
  p.holes = board.holes.slice();
  board.path.forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  p.path = board.path;
  p.seed = seed;
  p.shape = board.label;
  return p;
}

// Deterministic Cutout puzzle for (n, seed). Events: { frac|null, walls, K }, as generate()
// (`walls` = those of the best
// candidate so far). The puzzle has .holes (Uint8Array, 1 = hole), .shape (a name of LABELS),
// .path (the solution), .seed and
// .score ({ difficulty, walls, interior, total } of the candidate that won).
// o.silhouettes / o.interior pick the boards (see proposeBoard), o.candidates / o.refineNodes
// override the effort,
// o.onCandidate(info) is called with every scored candidate (tuning).
export function* generateCutout(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const rnd = makeRng(seed);
  const wanted = o.candidates || CUTOUT_CANDIDATES[n] || 3;
  const budget = o.refineNodes ?? REFINE_NODES_PER_CELL * n * n;
  const refining = budget > 0;
  const buildShare = BUILD_SHARE;
  const minShare = 1 - buildShare - (refining ? REFINE_SHARE : 0);
  const candidates = [];
  let K = null;
  let shown = null;

  // 1. Candidates: a board, checkpoints, walls until unique, walls minimized, scored.
  for (let attempt = 0; attempt < wanted * ATTEMPTS_PER_CANDIDATE && candidates.length < wanted; attempt++) {
    const board = proposeBoard(n, rnd, o);
    if (!board) {
      continue;
    }
    const cells = cellCount({ n, holes: board.holes });
    const nodeCap = Math.round(Math.max(30000, 200 * cells) * PROP_CAP_X);
    const checkCap = Math.max(1000, Math.floor(nodeCap * CHECK_CAP_X));
    K = pickK(Math.max(4, n), Math.max(n + 1, Math.round(cells / 4)), rnd);
    const caps = { nodeCap, wallBudget: cells };
    const p = yield* tag(buildOn(n, board, K, rnd, caps), { walls: shown });
    if (!p) {
      continue;
    }
    const progress = done => buildShare + (minShare * (candidates.length + done)) / wanted;
    const result = yield* minimizeCandidate(p, rnd, checkCap, K, progress);
    const grade = trapMetrics(p, undefined, p.path);
    const walls = result.kept;
    const difficulty = grade.ok ? grade.predicted : 0;
    const total = scoreOf(difficulty, walls, board.interior);
    const score = { difficulty, walls, interior: board.interior, total };
    candidates.push({ p, board, walls, uncertain: result.uncertain || [], checkCap, K, score });
    if (o.onCandidate) {
      const { silhouette, label } = board;
      o.onCandidate({ silhouette, label, K, cells, grade, ...score });
    }
    const best = bestOf(candidates);
    shown = best.walls;
    yield { frac: buildShare + (minShare * candidates.length) / wanted, walls: shown, K: best.K };
  }
  if (!candidates.length) {
    if (depth < 5) {
      return yield* generateCutout(n, seed + 1, { ...o, retryDepth: depth + 1 });
    }
    return lastResort(n, rnd, o, seed);
  }

  // 2. The winner gets a deeper look at the walls its minimizing kept only because a check hit its
  // node cap.
  const winner = bestOf(candidates);
  if (refining && winner.uncertain.length) {
    const caps = REFINE_CAP_X.map(x => x * winner.checkCap);
    const refineOptions = { prop: true, caps, budget, walls: winner.walls, K: winner.K };
    const events = refineWalls(winner.p, winner.uncertain, rnd, refineOptions);
    let step;
    while (!(step = events.next()).done) {
      const frac = buildShare + minShare + (REFINE_SHARE * step.value.nodes) / budget;
      yield { ...step.value, frac };
    }
    winner.walls = step.value.kept;
    winner.score.walls = winner.walls;
    winner.score.total = scoreOf(winner.score.difficulty, winner.walls, winner.score.interior);
  }
  yield { frac: 1, walls: winner.walls, K: winner.K };
  const puzzle = winner.p;
  delete puzzle.order;
  puzzle.seed = seed;
  puzzle.shape = winner.board.label;
  puzzle.score = winner.score;
  return puzzle;
}

const bestOf = candidates => candidates.reduce(
  (best, c) => (c.score.total > best.score.total ? c : best),
);

// Minimize the walls of candidate p, yielding progress (progress(share of the walls tested) ->
// frac of the whole run);
// returns minimizeWalls' result ({ kept, uncertain, ... }).
function* minimizeCandidate(p, rnd, checkCap, K, progress) {
  const events = minimizeWalls(p, p.order, rnd, checkCap, K, { prop: true, freedEdge: true });
  let tested = 0;
  const total = Math.max(1, p.order.length);
  for (let step = events.next(); ; step = events.next()) {
    if (step.done) {
      return step.value;
    }
    tested++;
    yield { frac: progress(tested / total), walls: step.value.walls, K };
  }
}

// No candidate in all retries: a board with every cell numbered, or an error when not even a board
// is found.
function lastResort(n, rnd, o, seed) {
  for (let x = 0; x < 64; x++) {
    const board = proposeBoard(n, rnd, { ...o, interior: o.interior ?? 1 });
    if (board) {
      return numberEveryCell(n, board, seed);
    }
  }
  throw new Error('Cutout generation failed: no usable board for N=' + n);
}
