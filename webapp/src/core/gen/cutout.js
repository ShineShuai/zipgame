import { makePuzzle, cellCount } from '../model.js';
import { makeRng } from '../rng.js';
import { gapCheckpoints } from './checkpoints.js';
import { makeUnique } from './walls.js';
import { PROP_CAP_X, SEED_FRACTION } from './generate.js';
import { proposeBoard } from './shapes.js';
import { generateTargeted, maxTargetGrade, targetBand, missOf, TARGET_CFG } from './target.js';
import { TRAP_MODEL, withoutAltFrac } from '../trap.js';

// Cutout: Zip on a board with holes. A hole is not drawn and not counted; the path covers every
// other cell, and checkpoints, walls and uniqueness work as in the standard game (the solver skips
// holes, see puzzle.holes in model.js).
//
// A hole works like a wall: it constrains the path, so it is a tool, and how many holes there are
// and where they go is chosen for the puzzle, not for the shape. Measured on random boards, one
// interior hole stands in for about half a wall (walls left after minimizing, 0 -> 3 holes: 4.6 ->
// 3.4 at 8x8, 6.3 -> 4.3 at 9x9) and neither changes the difficulty at a fixed number of
// checkpoints, so both are costs here, a wall dearer than a hole (COST): of two puzzles that are
// hard enough, the one with fewer walls and holes wins, and a hole is the cheaper way to get a
// puzzle unique.
//
// Difficulty is a target, reached by the search of gen/target.js (the Play app's own targeted
// generator) on the board's puzzle, instead of the best of many random candidates: at 8x8 about
// 1 candidate in a thousand is at grade 3, which is out of reach for a lottery. generateCutout
// proposes boards (outline x interior holes, see shapes.js), climbs each toward the target grade
// (walls and checkpoints move, the board stays), and keeps the cheapest board that got there. What
// the search needs from target.js: o.model, o.atLeast, o.cells, o.start, o.stop.
//
// The grade is the trap model (core/trap.js: trapMax, trapTop3 and the ladder's lTr) WITHOUT its
// altFrac term (CUTOUT_MODEL). altFrac = the share of solution steps that have a wrong turn: holes
// take neighbours away, so it is low on every board with holes, and the model, fitted on standard
// boards, reads low as hard (+0.3..+0.5 predicted rating against -0.5..-0.6 on standard boards of
// the same size). Without it a Cutout is about as hard as a standard puzzle of its size, which is
// what the tests of play say. The weights and cuts are not refitted on Cutout puzzles: the grade
// ranks, nothing more is claimed. Rate some Cutout puzzles in the design app before trusting it.
//
// Reach (measured, grade >= 3, boards from proposeBoard, one climb each): 8x8 only boards with a
// square outline and 1-2 interior holes get there (3 of 6), the other outlines never do; 7x7 and
// smaller: none, the puzzle returned is the hardest found; 9x9 about 1 board in 8; 10x10 about 5
// in 8, slowly (seconds per board, up to a minute at 99 cells, the ladder runs on every change).
// So o.maxMs (a clock, set by the app) bounds the run and the best puzzle found so far is returned,
// hit or not: puzzle.score.hit says which.
//
// Seeded like generate() (same seed => same puzzle) as long as o.maxMs is not set: the app seeds
// it at random, because a Cutout game has no daily sequence and is never rebuilt from a seed. A
// shared game carries the puzzle itself (core/share-code.js).

export { SILHOUETTES, LABELS, colourCounts, isBalanced, shapeIsViable } from './shapes.js';

// The grade model: the trap model without altFrac (see above).
export const CUTOUT_MODEL = withoutAltFrac(TRAP_MODEL);
// The grade asked for: "this grade or harder" (a size that cannot show it, 5x5, gets its top grade).
export const CUTOUT_GRADE = 3;
// The price of a puzzle that is hard enough: a wall costs more than a hole, so a hole that makes a
// wall unnecessary pays for itself (measured: about half a wall per hole).
export const COST = { wall: 1, hole: 0.3 };
export const costOf = (walls, interior) => COST.wall * walls + COST.hole * interior;
// Boards tried per puzzle, by size (the search for the first and second hit ends the run earlier).
export const CUTOUT_BOARDS = { 5: 6, 6: 6, 7: 6, 8: 6, 9: 5, 10: 4, 11: 3, 12: 3, 16: 2 };
// The Play app's time cap for one puzzle, ms (generateCutout's o.maxMs).
export const CUTOUT_MAX_MS = 8000;

const HITS_WANTED = 2; // boards that reach the target before the cheapest is taken ...
const SLOW_FROM = 8; // ... up to this size; above it a climb takes seconds (the ladder runs on every change), so the first hit is taken
const BOARD_ATTEMPTS = 3; // proposals per board wanted (a proposal can come back empty)
const REACH = 0.3; // second look only at boards whose best puzzle is this close to the target band
const DEEP = { boards: 2, retries: 3, effort: 2 };
const FIRST_SHARE = 0.7; // share of the progress bar for the first pass over the boards

// One start puzzle on a board: checkpoints along the board's path, then walls until unique. A
// generator function (rnd, K, cap) -> { unique, puzzle } for generateTargeted's o.start.
const startOn = (n, board, cells) => function* start(rnd, K) {
  const positions = gapCheckpoints(n, board.path, Math.min(K, cells));
  if (!positions) {
    return { unique: false };
  }
  const p = makePuzzle(n);
  p.holes = board.holes.slice();
  positions.forEach((q, i) => {
    p.cp[board.path[q]] = i + 1;
  });
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * PROP_CAP_X);
  const options = { nodeCap, wallBudget: cells, seedFraction: SEED_FRACTION, K, prop: true };
  const order = yield* makeUnique(p, board.path, rnd, options);
  if (!order) {
    return { unique: false };
  }
  p.path = board.path;
  return { unique: true, puzzle: p };
};

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

// a before b? Boards that reached the target first, then the cheaper; short of it, the closer.
const better = (a, b) => {
  if (a.hit !== b.hit) {
    return a.hit;
  }
  if (a.hit) {
    return a.cost < b.cost;
  }
  return a.miss < b.miss || (a.miss === b.miss && a.cost < b.cost);
};

// Deterministic Cutout puzzle for (n, seed). Events: { frac|null, walls, K } as generate() (`walls`
// = those of the best puzzle so far). The puzzle has .holes (Uint8Array, 1 = hole), .shape (a name
// of LABELS), .path (the solution), .seed and .score = { difficulty, grade, target, hit, walls,
// interior, cost, miss } of the board that won (difficulty = its predicted rating under CUTOUT_MODEL,
// miss = how far that is below the target band, 0 when it is there).
// o.silhouettes / o.interior pick the boards (see proposeBoard); o.grade the target (default
// CUTOUT_GRADE), o.boards how many boards to try, o.hits how many must reach it before the cheapest
// is taken, o.retries / o.effort the climb of one board (target.js); o.maxMs a clock for the whole
// run; o.onCandidate(info) is called with the result of every board (tuning).
export function* generateCutout(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const rnd = makeRng(seed);
  const t0 = performance.now();
  const stop = () => o.maxMs != null && performance.now() - t0 > o.maxMs;
  const target = Math.min(o.grade ?? CUTOUT_GRADE, maxTargetGrade(n, CUTOUT_MODEL));
  const band = targetBand(target, n, CUTOUT_MODEL, TARGET_CFG.margin, true);
  const wanted = o.boards ?? CUTOUT_BOARDS[n] ?? 3;
  const hitsWanted = o.hits ?? (n <= SLOW_FROM ? HITS_WANTED : 1);
  const results = [];
  let shown = null;
  let K = null;
  let hits = 0;

  // One climb of a board toward the target: a result, or null when no puzzle could be built on it.
  function* climb(board, entry, how, share, from) {
    const cells = cellCount({ n, holes: board.holes });
    const subSeed = Math.floor(rnd() * 2 ** 32);
    const search = generateTargeted(n, target, subSeed, {
      model: CUTOUT_MODEL, atLeast: true, cells, start: startOn(n, board, cells), stop,
      retries: how.retries, effort: how.effort,
    });
    let step;
    while (!(step = search.next()).done) {
      const { walls, K: k } = step.value;
      K = k ?? K;
      yield { frac: from + share * (step.value.frac ?? 0), walls: shown, K };
    }
    const r = step.value;
    if (!r.puzzle) {
      return null;
    }
    const interior = board.interior;
    const walls = r.walls;
    const record = {
      board, cells, puzzle: r.puzzle, pred: r.pred, grade: r.grade, hit: r.hit, walls, interior,
      cost: costOf(walls, interior), miss: missOf(r.pred, band), K: r.K, entry,
    };
    if (o.onCandidate) {
      const { silhouette, label } = board;
      o.onCandidate({
        silhouette, label, K: r.K, cells, difficulty: r.pred, grade: r.grade, hit: r.hit,
        walls, interior, cost: record.cost, miss: record.miss,
      });
    }
    return record;
  }

  // 1. A climb on each of several boards, until enough of them reach the target.
  const first = { retries: o.retries ?? 1, effort: o.effort ?? 1 };
  let tried = 0;
  for (let attempt = 0; attempt < wanted * BOARD_ATTEMPTS && tried < wanted && hits < hitsWanted; attempt++) {
    if (results.length && stop()) {
      break;
    }
    const board = proposeBoard(n, rnd, o);
    if (!board) {
      continue;
    }
    const from = (FIRST_SHARE * tried) / wanted;
    const record = yield* climb(board, results.length, first, FIRST_SHARE / wanted, from);
    tried++;
    if (record) {
      results.push(record);
      hits += record.hit ? 1 : 0;
      shown = results.reduce((w, r) => Math.min(w, r.walls), Infinity);
    }
  }
  if (!results.length) {
    if (depth < 5) {
      return yield* generateCutout(n, seed + 1, { ...o, retryDepth: depth + 1 });
    }
    return lastResort(n, rnd, o, seed);
  }

  // 2. No board got there, but the closest is near: a longer climb of the closest boards.
  const closest = [...results].sort((a, b) => a.miss - b.miss).slice(0, DEEP.boards);
  if (!hits && closest[0].miss <= REACH && !stop() && o.deep !== false) {
    const deep = { retries: DEEP.retries, effort: DEEP.effort * (o.effort ?? 1) };
    for (let i = 0; i < closest.length && !stop(); i++) {
      const from = FIRST_SHARE + ((1 - FIRST_SHARE) * i) / closest.length;
      const record = yield* climb(closest[i].board, closest[i].entry, deep, (1 - FIRST_SHARE) / closest.length, from);
      if (record) {
        results.push(record);
      }
    }
  }

  const winner = results.reduce((best, r) => (better(r, best) ? r : best));
  yield { frac: 1, walls: winner.walls, K: winner.K };
  const puzzle = winner.puzzle;
  puzzle.seed = seed;
  puzzle.shape = winner.board.label;
  puzzle.score = {
    difficulty: winner.pred, grade: winner.grade, target, hit: winner.hit, walls: winner.walls,
    interior: winner.interior, cost: winner.cost, miss: winner.miss,
  };
  return puzzle;
}

// No board in all retries: a board with every cell numbered, or an error when not even a board
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
