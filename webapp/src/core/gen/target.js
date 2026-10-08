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
// of a puzzle that is later minimized into a different grade.
// Two counts bound the search, no clock does: a TRY is one fresh start puzzle plus its hill-climb (cut short after `patience` changes
// without progress and after at most `depth` changes), `retries` is how many tries a run may make (o.retries; Infinity = until the target
// is met), and o.effort scales how deep each try may go. Both are counts, so the same arguments give the same puzzle on every machine.
// Speed (both leave the result unchanged, o.prefilter / o.cache = false switch them off for tests): scoring a puzzle has a cheap part (one
// solver run per wrong turn) and an expensive one (the ladder's what-if count lTr); the ladder only runs far enough to tell whether the
// score can fall inside the window in which the change would be kept, and every score is remembered by puzzle.
// Everything adapts to a refit of the grade (tools/fit-trap.mjs --write): the target band is read from TRAP_MODEL.cuts
// and SIZE_GRADE_CAP at call time and the score is trapMetrics().predicted, so nothing here has to change when
// tools/ratings.json does. `node tools/target-eval.mjs` shows whether every grade is still reachable after a refit.
//
// Deterministic: same (n, grade, seed, effort) and the same TRAP_MODEL give the same puzzle on every device, because
// the budgets are counts of proposals and solver nodes, never clocks.
import { clonePuzzle, maxNumber } from '../model.js';
import { canStep, isSolved } from '../rules.js';
import { makeRng } from '../rng.js';
import { allEdges, edgeCells, hasWallId, setWallId, wallIds, pathEdgeIds } from '../edges.js';
import { solve } from '../solver/solve.js';
import { REF_FLAGS } from '../difficulty.js';
import { trapProfile, trapMetricsFromProfile, ladderTrials, TRAP_MODEL, TRAP_CFG, SIZE_GRADE_CAP } from '../trap.js';
import { generateUnique } from './generate.js';

export const TARGET_CFG = {
  // Stay this share of a cut spacing away from the cuts that bound the target grade, so the grade is not decided by a
  // rounding error and survives a small refit. Capped at 30% of the band when a fitted band is narrow.
  margin: 0.15,
  // Depth of a try = effort * (proposalsPerCell * cells + proposalsBase) proposals (tried changes) at most.
  proposalsPerCell: 12,
  proposalsBase: 200,
  // A try ends after this share of its depth without an improvement.
  patience: 0.25,
  // Tries (fresh start puzzles) per run, unless o.retries says otherwise.
  retries: 4,
  // Search space limits = the range the grade was fitted on (generate()'s K range; the most walls per cell among the
  // rated puzzles). Outside it the grade is an extrapolation.
  maxWallsPerCell: 0.25,
  // Uniqueness checks use this node cap (>= generate()'s own caps), a check that hits it rejects the proposal.
  uniqueCapFloor: 30000,
  uniqueCapPerCell: 200,
  // Fresh start puzzles: generateUnique() tries per start, and how many starts in a row may fail outright before the run gives up.
  startTries: 4,
  maxFailedStarts: 8,
  // Scores remembered per run (the memory is dropped when it is full).
  cacheMax: 50000,
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

// Most proposals (tried changes) of one try; a run makes at most `retries` tries.
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
// removable(q, w) = true when q stays unique without wall w (it takes the wall out then, and leaves it in otherwise).
function dropWalls(q, removable, rnd) {
  const ws = wallIds(q);
  for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]]; }
  for (const w of ws) removable(q, w);
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
    const w = pick(walls, rnd);
    setWallId(q.walls, w, false);
    // Guided: the new wall goes onto an off-path edge of a second solution the old wall was holding off, so the puzzle has a good chance
    // to stay unique (a wall anywhere else breaks uniqueness about 9 times in 10 when every wall is needed).
    const second = ctx.guided && ctx.witness(q, w);
    if (second) {
      const at = pathEdgeIds(ctx.n, second).filter(e => ctx.freeSet.has(e) && !hasWallId(q.walls, e));
      if (at.length) { setWallId(q.walls, pick(at, rnd), true); return { q, check: true }; }
    }
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

// ---- scoring ----

// A score that was not computed exactly because it lies outside the window in which the change would be kept anyway.
const OUT = Object.freeze({ out: true });
const EPS = 1e-9;
// The puzzle as a string: the walls and the checkpoints are all a score depends on (the solution path is fixed by them).
const keyOf = q => String.fromCharCode(...q.cp) + '|' + String.fromCharCode(...q.walls);

// ---- the run ----

// generateTargeted(n, grade, seed, o) -> generator (like generate() / generateUnique(): drive it with runSync / runAsync).
//   o.retries        tries (fresh start puzzle + hill-climb) the run may make (default TARGET_CFG.retries; Infinity = until the target is met)
//   o.effort         multiplier of how deep one try may go, in changes (default 1)
//   o.maxWalls       most walls the puzzle may have (default: the fitted range, see TARGET_CFG.maxWallsPerCell, for the added walls)
//   o.maxCheckpoints most numbered cells it may have, o.minCheckpoints fewest (defaults: the fitted range, from the board size n up to a quarter of the
//                    cells; both equal = exactly that many). The search varies the count inside the range, fewer for harder targets.
//   o.guided         true = a wall that moves goes onto an edge of the second solution it was holding off, not onto a random free edge (more of
//                    the moves keep the puzzle unique, but the search was not faster in measurements: off by default)
//   o.minimize       false = do not strip walls (the first version of this generator)
//   o.margin         see TARGET_CFG.margin
//   o.prefilter, o.cache  false = switch the speed-ups off (same result, slower; the tests compare both)
// Events: { frac, proposals, restarts, tries, retries, pred, grade, target, phase: 'start' | 'search' }.
// Returns { puzzle, unique: true, grade, pred, target, requested, hit, inside, lo, hi, proposals, restarts, tries, retries, K, walls, stats }:
//   target = the grade aimed at (`requested` clamped to what this size can show), grade / pred = what the best puzzle
//   found has under the CURRENT trap model, hit = grade === target, inside = also clear of the band's edges,
//   stats = how often the speed-ups worked ({ scored, cacheHits, filtered, ladderRuns, ladderAborts, uniqueRuns, uniqueHits, dropRuns, witnessSkips }).
//   puzzle carries .path (the solution) and .seed. puzzle = null when no start puzzle could be built.
export function* generateTargeted(n, grade, seed, o = {}) {
  const band = targetBand(grade, n, TRAP_MODEL, o.margin ?? TARGET_CFG.margin);
  const rnd = makeRng(seed);
  const T = n * n;
  let Kmin = Math.max(4, n), Kmax = Math.max(Kmin + 1, Math.round(T / 4));
  if (o.minCheckpoints > 0) { Kmin = Math.max(2, Math.floor(o.minCheckpoints)); Kmax = Math.max(Kmax, Kmin); }
  if (o.maxCheckpoints > 0) { Kmax = Math.max(2, Math.floor(o.maxCheckpoints)); Kmin = Math.min(Kmin, Kmax); }
  const cap = Math.max(TARGET_CFG.uniqueCapFloor, TARGET_CFG.uniqueCapPerCell * T);
  const minimal = o.minimize !== false, t0 = performance.now();
  const retries = Math.max(1, o.retries ?? TARGET_CFG.retries);
  const depth = proposalBudget(n, o.effort ?? 1), patience = Math.max(30, Math.round(depth * TARGET_CFG.patience));
  const hardWalls = o.maxWalls >= 0 ? Math.floor(o.maxWalls) : Infinity;
  const maxWalls = o.maxWalls >= 0 ? hardWalls : Math.max(2, Math.floor(TARGET_CFG.maxWallsPerCell * T));
  const K0 = Math.max(Kmin, Math.min(Kmax, Math.round(Kmax - ((Kmax - Kmin) * band.grade) / 5))); // fewer checkpoints for harder targets
  const stats = { scored: 0, cacheHits: 0, filtered: 0, ladderRuns: 0, ladderAborts: 0, uniqueRuns: 0, uniqueHits: 0, dropRuns: 0, witnessSkips: 0 };
  const solveOnce = q => { const r = solve(q, { limit: 2, nodeCap: cap, ...REF_FLAGS }); return r.count === 1 && !r.exceeded; };
  const uniq = o.cache === false ? null : new Map(); // puzzle -> its uniqueness verdict (the same puzzle is proposed again and again)
  const isUnique = q => {
    if (!uniq) return solveOnce(q);
    const key = keyOf(q);
    let v = uniq.get(key);
    if (v === undefined) { v = solveOnce(q); if (uniq.size >= TARGET_CFG.cacheMax) uniq.clear(); uniq.set(key, v); stats.uniqueRuns++; } else stats.uniqueHits++;
    return v;
  };
  // Walls a puzzle does not need are stripped (dropWalls). The puzzle is unique when this runs, so without wall w it stays unique iff no
  // solution walks the freed edge: a smaller search than a two-solution search (tryRemoveWall in walls.js does the same). A wall that
  // has to stay comes with a WITNESS, the second solution that appears without it; the next candidate, one change away, then only
  // needs the witness checked (a path walk) instead of a search. Witnesses are kept per wall in `wit` (wall id -> path).
  // o.freedEdge = false: the plain uniqueness check, no witnesses (same result unless a node cap is hit).
  const validPath = (q, path) => { for (let i = 1; i < path.length; i++) if (!canStep(q, path[i - 1], path[i])) return false; return isSolved(q, path); };
  const freedSearch = (q, w) => { const [a, b] = edgeCells(n, w); return solve(q, { limit: 1, nodeCap: cap, mustUse: [a, b], capture: true, ...REF_FLAGS }); };
  const strip = (q, parentWit) => {
    const wit = new Map();
    dropWalls(q, o.freedEdge === false
      ? (q_, w) => { setWallId(q_.walls, w, false); if (isUnique(q_)) return true; setWallId(q_.walls, w, true); return false; }
      : (q_, w) => {
        setWallId(q_.walls, w, false);
        const old = parentWit && parentWit.get(w);
        if (old && validPath(q_, old)) { stats.witnessSkips++; setWallId(q_.walls, w, true); wit.set(w, old); return false; }
        stats.dropRuns++;
        const r = freedSearch(q_, w);
        if (!r.exceeded && r.count === 0) return true;
        setWallId(q_.walls, w, true);
        if (r.count === 1) wit.set(w, r.paths[0]);
        return false;
      }, rnd);
    return wit;
  };

  // Score of a puzzle: { pred, grade }, null when it is not valid (second solution, too many walls). pred = b + sum of terms, and the
  // ladder's term c * lTr (c > 0) is the only expensive one, with lTr = log(1 + ladder trials) >= 0. `win` = [lo, hi] is the window of
  // scores in which the change would be kept; a score outside it only has to be recognised as outside (OUT), so the cheap terms give
  // the lowest possible score (no trials) and the ladder runs with a trial cap that makes the score exceed hi.
  const lTrOn = TRAP_MODEL.features.includes('lTr'), lCoef = lTrOn ? TRAP_MODEL.w.lTr / TRAP_MODEL.sd.lTr : 0;
  const staged = o.prefilter !== false && lCoef > 0;
  const lTrMax = Math.log1p(TRAP_CFG.ladderWorkCap + 1); // every trial assigns an edge: at most workCap + 1 trials
  const cache = o.cache === false ? null : new Map();
  const score = (q, path, win) => {
    if (wallIds(q).length > hardWalls) return null;
    stats.scored++;
    const key = cache ? keyOf(q) : null, known = cache ? cache.get(key) : undefined;
    if (known) {
      if ('exact' in known) { stats.cacheHits++; return known.exact; }
      if (win && (known.lb > win.hi + EPS || known.ub < win.lo - EPS)) { stats.cacheHits++; return OUT; } // known to be above / below the window
    }
    const keep = v => { if (cache) { if (cache.size >= TARGET_CFG.cacheMax) cache.clear(); cache.set(key, v); } return v; };
    const profile = trapProfile(q, path, TRAP_CFG);
    if (profile.nonUnique) return keep({ exact: null }).exact;
    if (!(staged && win)) {
      const m = trapMetricsFromProfile(q, path, profile, TRAP_CFG, lTrOn ? undefined : 0);
      return keep({ exact: { pred: m.predicted, grade: m.grade } }).exact;
    }
    const low = trapMetricsFromProfile(q, path, profile, TRAP_CFG, 0).predicted; // lTr = 0: the lowest score the puzzle can have
    if (low > win.hi + EPS) { stats.filtered++; keep({ lb: low }); return OUT; }
    const high = low + lCoef * lTrMax;
    if (high < win.lo - EPS) { stats.filtered++; keep({ ub: high }); return OUT; }
    const trialCap = Number.isFinite(win.hi) ? Math.ceil(Math.expm1(Math.max(0, (win.hi - low) / lCoef))) + 1 : Infinity;
    stats.ladderRuns++;
    const trials = ladderTrials(q, TRAP_CFG, trialCap);
    if (trials > trialCap) { stats.ladderAborts++; keep({ lb: low + lCoef * Math.log1p(trials) }); return OUT; } // more trials than the window allows
    const m = trapMetricsFromProfile(q, path, profile, TRAP_CFG, trials);
    return keep({ exact: { pred: m.predicted, grade: m.grade } }).exact;
  };

  let best = null, proposals = 0, restarts = 0, tries = 0, failedStarts = 0, tryProps = 0;
  const event = (phase, cur) => {
    const b = best || cur;
    return { frac: Math.min(1, Number.isFinite(retries) ? (tries - 1 + Math.min(1, tryProps / depth)) / retries : 0), elapsedMs: performance.now() - t0, proposals, restarts, tries, retries, pred: b ? b.pred : null, grade: b ? b.grade : null, walls: b ? wallIds(b.puzzle).length : null, K: b ? maxNumber(b.puzzle) : null, target: band.grade, phase };
  };
  const consider = cur => { if (!best || cur.d < best.d) best = cur; };

  while (tries < retries && !(best && best.d === 0) && failedStarts < TARGET_CFG.maxFailedStarts) {
    tries++;
    tryProps = 1;
    // 1. A fresh unique puzzle with its solution path.
    const inner = generateUnique(n, K0, rnd, { tries: TARGET_CFG.startTries, nodeCap: cap });
    let start;
    for (let s = inner.next(); ; s = inner.next()) { if (s.done) { start = s.value; break; } yield event('start', null); }
    proposals++;
    const path = start.unique && start.puzzle.path;
    let startWit = new Map();
    if (path && minimal) { start.puzzle.path = path; startWit = strip(start.puzzle, null); }
    const first = path && score(start.puzzle, path, null);
    if (!first) { failedStarts++; continue; }
    failedStarts = 0;
    const ctx = { n, path, pos: Int32Array.from({ length: T }), free: null, freeSet: null, Kmin, Kmax, maxWalls, minimal, guided: o.guided === true, wit: null, witness: null };
    path.forEach((c, i) => { ctx.pos[c] = i; });
    const onPath = new Set(pathEdgeIds(n, path));
    ctx.free = allEdges(n).filter(e => !onPath.has(e));
    ctx.freeSet = new Set(ctx.free);
    ctx.witness = (q, w) => { // a second solution of q, which has wall w taken out (null = none found); remembered in ctx.wit
      let v = ctx.wit.get(w);
      if (v === undefined) { const r = freedSearch(q, w); v = !r.exceeded && r.count === 1 ? r.paths[0] : null; ctx.wit.set(w, v); }
      return v;
    };
    let cur = { puzzle: start.puzzle, ...first, d: missOf(first.pred, band), wit: startWit };
    consider(cur);
    yield event('search', cur);

    // 2. Hill-climb with plateau moves: keep every change that is not farther from the target.
    let stale = 0;
    while (tryProps < depth && cur.d > 0 && stale < patience) {
      proposals++; tryProps++;
      ctx.wit = cur.wit;
      const m = propose(cur.puzzle, ctx, rnd, cur.pred < band.a);
      if (!m || (m.check && !isUnique(m.q))) { stale++; continue; }
      const win = { lo: band.a - cur.d, hi: band.b + cur.d };
      let q = m.q, s = score(q, path, win);
      if (s === OUT) { stale++; yield event('search', cur); continue; }
      if (!s) { stale++; continue; }
      // A candidate that is not worse is stripped of the walls it does not need before it is kept, and judged as that stripped puzzle.
      let wit = new Map();
      if (minimal && missOf(s.pred, band) <= cur.d) {
        wit = strip(q, cur.wit); s = score(q, path, win);
        if (s === OUT) { stale++; yield event('search', cur); continue; }
        if (!s) { stale++; continue; }
      }
      const d = missOf(s.pred, band);
      if (d <= cur.d) {
        stale = d < cur.d ? 0 : stale + 1;
        cur = { puzzle: q, ...s, d, wit };
        consider(cur);
      } else stale++;
      yield event('search', cur);
    }
    restarts++;
  }

  if (!best) return { puzzle: null, unique: false, grade: null, pred: null, target: band.grade, requested: grade, hit: false, inside: false, lo: band.lo, hi: band.hi, proposals, restarts, tries, retries, K: 0, walls: 0, stats, elapsedMs: performance.now() - t0 };
  const puzzle = best.puzzle;
  puzzle.seed = seed;
  yield { ...event('search', best), frac: 1 };
  return {
    puzzle, unique: true, grade: best.grade, pred: best.pred, target: band.grade, requested: grade,
    hit: best.grade === band.grade, inside: best.d === 0, lo: band.lo, hi: band.hi,
    proposals, restarts, tries, retries, K: maxNumber(puzzle), walls: wallIds(puzzle).length, minimal, stats, elapsedMs: performance.now() - t0,
  };
}
