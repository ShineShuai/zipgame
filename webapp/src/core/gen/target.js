// Targeted generation: a unique puzzle whose TRAP GRADE (core/trap.js, the Play app's badge) is a requested grade.
//
// Why a search and not a construction: checkpoint geometry, wall density and wall placement each explain little of the
// human ratings (|rho| <= ~0.2 once the trap score is known), and the plain generator (gen/generate.js) only produces
// trap scores in a narrow middle band (8x8: 1.1-2.5 on a 0-5 scale, never grade 4-5). Difficulty is what the solver finds
// when it meets the walls, so the target is reached by trial: start from a unique puzzle and keep every change that moves
// its trap score toward the target band. All the changes keep the generator's solution path as THE solution:
//   add a wall off the path     never loses the solution, can only remove other solutions  -> still unique, no check
//   add a checkpoint on the path  same argument (the old numbering is a subsequence of the new one) -> no check
//   remove a wall / remove a checkpoint / move a wall / shift a checkpoint one cell along the path
//                               may admit a second solution -> one solver check against uniqueness
// Wall-minimal by construction (o.minimize, default on): the Play app's own generator keeps the candidate with the FEWEST walls, which is
// part of what makes its puzzles hard. So here every puzzle the search keeps is first stripped of each wall it can lose without
// getting a second solution, and the grade is read on that stripped puzzle: the target is the grade of a wall-minimal puzzle, not
// of a puzzle that is later minimized into a different grade. Time cap (o.maxMs): the search runs until the target is met or the time
// is up, then returns the closest puzzle found (a clock makes the result depend on the machine: use the try cap for reproducible runs).
// Everything adapts to a refit of the grade (tools/fit-trap.mjs --write): the target band is read from TRAP_MODEL.cuts
// and SIZE_GRADE_CAP at call time and the score is trapMetrics().predicted, so nothing here has to change when
// tools/ratings.json does. `node tools/target-eval.mjs` shows whether every grade is still reachable after a refit.
//
// Deterministic: same (n, grade, seed, effort) and the same TRAP_MODEL give the same puzzle on every device, because
// the budgets are counts of proposals and solver nodes, never clocks.
import { clonePuzzle, maxNumber } from '../model.js';
import { makeRng } from '../rng.js';
import { allEdges, hasWallId, setWallId, wallIds, pathEdgeIds } from '../edges.js';
import { solve } from '../solver/solve.js';
import { REF_FLAGS } from '../difficulty.js';
import { trapMetrics, TRAP_MODEL, TRAP_CFG, SIZE_GRADE_CAP } from '../trap.js';
import { generateUnique } from './generate.js';

export const TARGET_CFG = {
  // Stay this share of a cut spacing away from the cuts that bound the target grade, so the grade is not decided by a
  // rounding error and survives a small refit. Capped at 30% of the band when a fitted band is narrow.
  margin: 0.15,
  // Proposals (tried changes) per run = effort * (PROPOSALS_PER_CELL * cells + PROPOSALS_BASE).
  proposalsPerCell: 12,
  proposalsBase: 200,
  // Restart from a fresh puzzle after this share of the run's proposals without an improvement.
  patience: 0.25,
  // Search space limits = the range the grade was fitted on (generate()'s K range; the most walls per cell among the
  // rated puzzles). Outside it the grade is an extrapolation.
  maxWallsPerCell: 0.25,
  // Uniqueness checks use this node cap (>= generate()'s own caps), a check that hits it rejects the proposal.
  uniqueCapFloor: 30000,
  uniqueCapPerCell: 200,
  // Fresh start puzzles: retries per start, and how many starts may fail outright before the run gives up.
  startTries: 4,
  maxFailedStarts: 8,
};

const cutsOf = model => model.cuts || [0.5, 1.5, 2.5, 3.5, 4.5]; // no cuts = the old round() rule (see trapGradeOf)

// Highest grade a puzzle of this size can show: the size cap, and the number of grades the cuts define.
export const maxTargetGrade = (n, model = TRAP_MODEL) => Math.min(cutsOf(model).length, SIZE_GRADE_CAP[n] ?? 5);

// The trap-score band of a grade at size n, from the model's cuts: grade g = score in [lo, hi). The top grade (and the
// size cap, which makes a lower grade the top one) is open above, grade 0 is open below. [a, b] = the band with the
// safety margin: the target interval the search tries to reach. `grade` is clamped to what the size allows.
export function targetBand(grade, n, model = TRAP_MODEL, margin = TARGET_CFG.margin) {
  const cuts = cutsOf(model), top = maxTargetGrade(n, model);
  const g = Math.max(0, Math.min(top, Math.round(grade)));
  const spacing = cuts.length > 1 ? (cuts[cuts.length - 1] - cuts[0]) / (cuts.length - 1) : 1;
  const lo = g > 0 ? cuts[g - 1] : -Infinity, hi = g >= top ? Infinity : cuts[g];
  const inset = Math.min(margin * spacing, 0.3 * (hi - lo)); // an open side makes hi - lo infinite: only a narrow finite band shrinks the margin
  return { grade: g, top, lo, hi, a: lo + inset, b: hi - inset, spacing };
}

// How far a score is from the safe interval (0 inside).
export const missOf = (pred, band) => (pred < band.a ? band.a - pred : pred > band.b ? pred - band.b : 0);

// Total proposals of a run.
export const proposalBudget = (n, effort = 1) => Math.max(10, Math.round(effort * (TARGET_CFG.proposalsPerCell * n * n + TARGET_CFG.proposalsBase)));

// ---- the changes ----

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

// Weighted choice; `up` = the puzzle has to get harder.
const MOVES_UP = [['move', 0.34], ['remove', 0.2], ['shift', 0.2], ['rmcp', 0.16], ['add', 0.05], ['addcp', 0.05]];
const MOVES_DOWN = [['add', 0.22], ['addcp', 0.28], ['move', 0.14], ['shift', 0.14], ['remove', 0.11], ['rmcp', 0.11]];
// In wall-minimal mode adding a wall or removing one is pointless (an extra wall is stripped again, a needed one cannot go):
// only swapping a wall for another, and the checkpoint changes (an added checkpoint can make walls unnecessary).
const MOVES_UP_MIN = [['move', 0.45], ['shift', 0.25], ['rmcp', 0.2], ['addcp', 0.1]];
const MOVES_DOWN_MIN = [['addcp', 0.4], ['shift', 0.2], ['move', 0.2], ['rmcp', 0.2]];
function pickMove(up, rnd, minimal) {
  let r = rnd();
  for (const [name, w] of minimal ? (up ? MOVES_UP_MIN : MOVES_DOWN_MIN) : (up ? MOVES_UP : MOVES_DOWN)) { if ((r -= w) < 0) return name; }
  return 'move';
}

// Strips every wall that can go without a second solution appearing (each tried once, random order). The solution path stays valid.
function dropWalls(q, isUnique, rnd) {
  const ws = wallIds(q);
  for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]]; }
  for (const w of ws) { setWallId(q.walls, w, false); if (!isUnique(q)) setWallId(q.walls, w, true); }
  return q;
}

// Checkpoint cells by number (index k-1) of a puzzle.
function cpCells(p) {
  const out = [];
  for (let c = 0; c < p.cp.length; c++) if (p.cp[c]) out[p.cp[c] - 1] = c;
  return out;
}

// One random change to a copy of p. Returns { q, check } (check = needs a uniqueness check) or null when the chosen
// change does not exist (a proposal is still spent, which keeps the run deterministic).
function propose(p, ctx, rnd, up) {
  const { path, pos, free, Kmin, Kmax, maxWalls } = ctx;
  const q = clonePuzzle(p);
  q.path = path;
  const walls = wallIds(q), move = pickMove(up, rnd, ctx.minimal);
  const addOne = () => { // a random wall on an edge off the solution path that is not walled yet
    for (let t = 0; t < 12; t++) { const e = pick(free, rnd); if (!hasWallId(q.walls, e)) { setWallId(q.walls, e, true); return true; } }
    return false;
  };
  if (move === 'add') return walls.length < maxWalls && addOne() ? { q, check: false } : null;
  if (move === 'remove') {
    if (!walls.length) return null;
    setWallId(q.walls, pick(walls, rnd), false);
    return { q, check: true };
  }
  if (move === 'move') {
    if (!walls.length) return null;
    setWallId(q.walls, pick(walls, rnd), false);
    return addOne() ? { q, check: true } : null;
  }
  const cells = cpCells(q), K = cells.length;
  if (move === 'shift') {
    if (K < 3) return null;
    const k = 1 + Math.floor(rnd() * (K - 2)), i = pos[cells[k]], j = i + (rnd() < 0.5 ? -1 : 1); // k = 0-based index of an inner checkpoint
    if (j <= pos[cells[k - 1]] || j >= pos[cells[k + 1]]) return null;
    q.cp[path[j]] = k + 1;
    q.cp[path[i]] = 0;
    return { q, check: true };
  }
  if (move === 'rmcp') {
    if (K <= Kmin) return null;
    const k = 1 + Math.floor(rnd() * (K - 2)); // inner checkpoint: its number is k + 1
    q.cp[cells[k]] = 0;
    for (let c = 0; c < q.cp.length; c++) if (q.cp[c] > k + 1) q.cp[c]--;
    return { q, check: true };
  }
  // 'addcp': a new checkpoint on a path cell that has none, numbered right after the last checkpoint before it
  if (K >= Kmax) return null;
  const j = 1 + Math.floor(rnd() * (path.length - 2));
  if (q.cp[path[j]]) return null;
  let k = 0;
  for (let t = 0; t <= j; t++) if (q.cp[path[t]]) k = q.cp[path[t]];
  for (let c = 0; c < q.cp.length; c++) if (q.cp[c] > k) q.cp[c]++;
  q.cp[path[j]] = k + 1;
  return { q, check: false };
}

// ---- the run ----

// generateTargeted(n, grade, seed, o) -> generator (like generate() / generateUnique(): drive it with runSync / runAsync).
//   o.effort   multiplier of the default proposal budget (default 1); ignored when o.maxMs is given
//   o.maxMs    time cap in ms: keep searching until the target is met or this much time has passed (the closest puzzle is returned)
//   o.minimize false = do not strip walls (the first version of this generator)
//   o.margin   see TARGET_CFG.margin
// Events: { frac, proposals, restarts, pred, grade, target, phase: 'start' | 'search' }.
// Returns { puzzle, unique: true, grade, pred, target, requested, hit, inside, lo, hi, proposals, restarts, K, walls }:
//   target = the grade aimed at (`requested` clamped to what this size can show), grade / pred = what the best puzzle
//   found has under the CURRENT trap model, hit = grade === target, inside = also clear of the band's edges.
//   puzzle carries .path (the solution) and .seed. puzzle = null when no start puzzle could be built.
export function* generateTargeted(n, grade, seed, o = {}) {
  const band = targetBand(grade, n, TRAP_MODEL, o.margin ?? TARGET_CFG.margin);
  const rnd = makeRng(seed);
  const T = n * n, Kmin = Math.max(4, n), Kmax = Math.max(Kmin + 1, Math.round(T / 4));
  const cap = Math.max(TARGET_CFG.uniqueCapFloor, TARGET_CFG.uniqueCapPerCell * T);
  const minimal = o.minimize !== false, capMs = o.maxMs > 0 ? o.maxMs : 0, t0 = performance.now();
  const timeUp = () => capMs > 0 && performance.now() - t0 >= capMs;
  const base = proposalBudget(n, o.effort ?? 1), budget = capMs ? Infinity : base, patience = Math.max(30, Math.round(base * TARGET_CFG.patience));
  const maxWalls = Math.max(2, Math.floor(TARGET_CFG.maxWallsPerCell * T));
  const K0 = Math.max(Kmin, Math.min(Kmax, Math.round(Kmax - ((Kmax - Kmin) * band.grade) / 5))); // fewer checkpoints for harder targets
  const isUnique = q => { const r = solve(q, { limit: 2, nodeCap: cap, ...REF_FLAGS }); return r.count === 1 && !r.exceeded; };
  const score = (q, path) => { const m = trapMetrics(q, TRAP_CFG, path); return m.ok && !m.nonUnique ? { pred: m.predicted, grade: m.grade } : null; };

  let best = null, proposals = 0, restarts = 0, failedStarts = 0;
  const event = (phase, cur) => {
    const b = best || cur;
    return { frac: Math.min(1, capMs ? (performance.now() - t0) / capMs : proposals / budget), elapsedMs: performance.now() - t0, proposals, restarts, pred: b ? b.pred : null, grade: b ? b.grade : null, walls: b ? wallIds(b.puzzle).length : null, K: b ? maxNumber(b.puzzle) : null, target: band.grade, phase };
  };
  const consider = cur => { if (!best || cur.d < best.d) best = cur; };

  while (proposals < budget && !timeUp() && !(best && best.d === 0) && failedStarts < TARGET_CFG.maxFailedStarts) {
    // 1. A fresh unique puzzle with its solution path.
    const inner = generateUnique(n, K0, rnd, { tries: TARGET_CFG.startTries, nodeCap: cap });
    let start;
    for (let s = inner.next(); ; s = inner.next()) { if (s.done) { start = s.value; break; } yield event('start', null); }
    proposals++;
    const path = start.unique && start.puzzle.path;
    if (path && minimal) { start.puzzle.path = path; dropWalls(start.puzzle, isUnique, rnd); }
    const first = path && score(start.puzzle, path);
    if (!first) { failedStarts++; continue; }
    const ctx = { path, pos: Int32Array.from({ length: T }), free: null, Kmin, Kmax, maxWalls, minimal };
    path.forEach((c, i) => { ctx.pos[c] = i; });
    const onPath = new Set(pathEdgeIds(n, path));
    ctx.free = allEdges(n).filter(e => !onPath.has(e));
    let cur = { puzzle: start.puzzle, ...first, d: missOf(first.pred, band) };
    consider(cur);
    yield event('search', cur);

    // 2. Hill-climb with plateau moves: keep every change that is not farther from the target.
    let stale = 0;
    while (proposals < budget && !timeUp() && cur.d > 0 && stale < patience) {
      proposals++;
      const m = propose(cur.puzzle, ctx, rnd, cur.pred < band.a);
      if (!m || (m.check && !isUnique(m.q))) { stale++; continue; }
      let q = m.q, s = score(q, path);
      if (!s) { stale++; continue; }
      // A candidate that is not worse is stripped of the walls it does not need before it is kept, and judged as that stripped puzzle.
      if (minimal && missOf(s.pred, band) <= cur.d) { q = dropWalls(q, isUnique, rnd); s = score(q, path); if (!s) { stale++; continue; } }
      const d = missOf(s.pred, band);
      if (d <= cur.d) {
        stale = d < cur.d ? 0 : stale + 1;
        cur = { puzzle: q, ...s, d };
        consider(cur);
      } else stale++;
      yield event('search', cur);
    }
    restarts++;
  }

  if (!best) return { puzzle: null, unique: false, grade: null, pred: null, target: band.grade, requested: grade, hit: false, inside: false, lo: band.lo, hi: band.hi, proposals, restarts, K: 0, walls: 0 };
  const puzzle = best.puzzle;
  puzzle.seed = seed;
  yield { ...event('search', best), frac: 1 };
  return {
    puzzle, unique: true, grade: best.grade, pred: best.pred, target: band.grade, requested: grade,
    hit: best.grade === band.grade, inside: best.d === 0, lo: band.lo, hi: band.hi,
    proposals, restarts, K: maxNumber(puzzle), walls: wallIds(puzzle).length, minimal, timedOut: capMs > 0 && best.d > 0 && timeUp(), elapsedMs: performance.now() - t0,
  };
}
