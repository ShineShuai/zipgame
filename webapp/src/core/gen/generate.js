import { makePuzzle } from '../model.js';
import { makeRng } from '../rng.js';
import { warnsdorff, backbite } from './hampath.js';
import { gapCheckpoints, randomCheckpoints } from './checkpoints.js';
import { makeUnique, minimizeWalls } from './walls.js';
import { solve } from '../solver/solve.js';

// Candidate puzzles built per play grid size. A candidate is a fresh random path with fresh
// checkpoints, walled until unique. Every candidate is then minimized and the one left with the
// fewest walls wins. Minimizing is the expensive part, so this count is the quality/time knob:
// time grows roughly with the count, the wall count shrinks. More attempts alone would not help,
// because the wall count before minimizing predicts the final count only weakly.
// The keys are the grid sizes the play app offers.
export const CANDIDATES = { 5: 32, 7: 20, 8: 16, 9: 16, 10: 8, 11: 6, 12: 4, 16: 3 };
export const PLAY_SIZES = Object.keys(CANDIDATES).map(Number);
const candidatesFor = n => CANDIDATES[n] || 2;
// Most attempts spent per candidate. Failed attempts (Warnsdorff dead ends) are cheap and 30-60% of
// attempts succeed, so this only guards against an unlucky seed.
const ATTEMPTS_PER_CANDIDATE = 12;
// Share of the progress bar for building candidates; the rest is minimizing them.
const BUILD_SHARE = 0.1;
// With solver propagation each node is far more effective, so the seeded node caps shrink.
export const PROP_CAP_X = 0.3;
// Every attempt starts by pre-walling this share of the free edges at random. That makes uniqueness
// cheap to reach; minimizeWalls() later strips the walls that turn out to be unnecessary.
export const SEED_FRACTION = 0.4;

// K ~ Normal(mean = Kmin + 0.3 * (Kmax - Kmin), sd = range / 6), sampled with Box-Muller and clamped
// to [Kmin, Kmax]. Favors small K. Always consumes exactly 2 rnd() values.
export function pickK(Kmin, Kmax, rnd) {
  const range = Kmax - Kmin;
  const u = 1 - rnd();
  const v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const k = Math.round(Kmin + 0.3 * range + (range / 6) * z);
  return Math.min(Kmax, Math.max(Kmin, k));
}

// One attempt: path -> checkpoints -> walls until unique. Returns the puzzle (with .path and .order) or null.
// o.path: 'warnsdorff' | 'backbite';  o.cps: 'gap' | 'random';  o.prop: solver propagation.
// o.legCollide: leg-collision pruning (see solve.js); o.counts: optional call-count accumulator,
// passed straight through to makeUnique.
export function* tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, o = {}) {
  const findPath = o.path === 'backbite' ? backbite : warnsdorff;
  const path = findPath(n, rnd);
  if (!path) return null;

  const positions = o.cps === 'random' ? randomCheckpoints(path.length, K, rnd) : gapCheckpoints(n, path, K);
  if (!positions) return null;

  const p = makePuzzle(n);
  positions.forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });

  const order = yield* makeUnique(p, path, rnd, { nodeCap, wallBudget, seedFraction, K, prop: o.prop, legCollide: o.legCollide, counts: o.counts });
  if (!order) return null;
  p.path = path;
  p.order = order;
  return p;
}

// Last resort: every cell numbered along a Hamiltonian path.
function numberEveryCell(n, path, seed) {
  const p = makePuzzle(n);
  path.forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  p.path = path;
  p.seed = seed;
  return p;
}

const fewestWalls = candidates => (
  candidates.length ? Math.min(...candidates.map(c => c.order.length)) : null
);

// Deterministic puzzle for (n, seed): same seed => same puzzle (ALGO_VERSION 4: solver propagation on,
// candidates seeded with SEED_FRACTION random walls, best of several minimized candidates).
// o.prop === false reproduces the shape of the ALGO_VERSION 1 search (solver propagation off).
// o.candidates overrides CANDIDATES[n].
// Events: { frac|null, walls, K }. `walls` never increases: it is the fewest walls found so far.
export function* generate(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const cells = n * n;
  const prop = o.prop !== false;
  const wanted = o.candidates || candidatesFor(n);
  const rnd = makeRng(seed);
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * (prop ? PROP_CAP_X : 1));
  const fallbackCap = Math.min(2000000, Math.max(300000, 20 * nodeCap));
  const checkCap = Math.max(1000, Math.floor(nodeCap / 2));
  const Kmin = Math.max(4, n);
  const Kmax = Math.max(Kmin + 1, Math.round(cells / 4));
  const K = pickK(Kmin, Kmax, rnd);

  // 1. Build candidates.
  const candidates = [];
  const maxAttempts = wanted * ATTEMPTS_PER_CANDIDATE;
  for (let attempt = 0; attempt < maxAttempts && candidates.length < wanted; attempt++) {
    // The attempt's own wall counts jump around, so report the fewest found so far instead.
    const attemptEvents = tryGenerate(n, K, rnd, nodeCap, cells, SEED_FRACTION, { prop });
    const found = yield* tag(attemptEvents, { walls: fewestWalls(candidates) });
    if (found) candidates.push(found);
    yield { frac: (BUILD_SHARE * candidates.length) / wanted, walls: fewestWalls(candidates), K };
  }
  for (let fallback = 0; fallback < 4 && candidates.length === 0; fallback++) {
    const attemptEvents = tryGenerate(n, K, rnd, fallbackCap, cells, SEED_FRACTION, { prop });
    const found = yield* tag(attemptEvents, { walls: fewestWalls(candidates) });
    if (found) candidates.push(found);
    yield { frac: BUILD_SHARE, walls: fewestWalls(candidates), K };
  }

  if (candidates.length === 0) {
    if (depth < 5) {
      return yield* generate(n, seed + 1, { ...o, retryDepth: depth + 1 });
    }
    // Last resorts, bounded (no unbounded recursion): densest K, then "number every cell".
    const denseCap = Math.max(300000, 20 * nodeCap);
    const dense = yield* tryGenerate(n, Kmax, rnd, denseCap, cells, 0, { prop });
    if (dense) {
      if (dense.order.length) yield* minimizeWalls(dense, dense.order, rnd, nodeCap, Kmax, prop);
      delete dense.order;
      dense.seed = seed;
      return dense;
    }
    for (let x = 0; x < 11; x++) {
      const path = warnsdorff(n, rnd);
      if (path) return numberEveryCell(n, path, seed);
    }
    throw new Error('Puzzle generation failed: could not construct a Hamiltonian path for N=' + n);
  }

  // 2. Minimize every candidate; keep the one with the fewest walls (the earliest on a tie).
  let shown = fewestWalls(candidates); // the wall count reported to the UI; it only goes down

  function* minimizeCandidate(candidate, index) {
    const total = candidate.order.length;
    const events = minimizeWalls(candidate, candidate.order, rnd, checkCap, K, prop);
    let tested = 0;
    for (let step = events.next(); ; step = events.next()) {
      if (step.done) return step.value;
      tested++;
      shown = Math.min(shown, step.value.walls);
      const progress = (index + tested / total) / candidates.length;
      yield { frac: BUILD_SHARE + (1 - BUILD_SHARE) * progress, walls: shown, K };
    }
  }

  let winner = null;
  let winnerWalls = Infinity;
  for (let i = 0; i < candidates.length && winnerWalls > 0; i++) {
    const candidate = candidates[i];
    let kept = candidate.order.length;
    if (kept > 0) kept = (yield* minimizeCandidate(candidate, i)).kept;
    if (kept < winnerWalls) {
      winner = candidate;
      winnerWalls = kept;
    }
  }
  yield { frac: 1, walls: winnerWalls, K };
  delete winner.order;
  winner.seed = seed;
  return winner;
}

// ---- Designer helpers (random, unseeded by design: caller supplies rnd) ----

// Random Hamiltonian path + K random checkpoints along it, no walls.
export function randomPathPuzzle(n, K, rnd) {
  K = Math.max(2, Math.min(K, n * n));
  const path = backbite(n, rnd);
  const p = makePuzzle(n);
  randomCheckpoints(path.length, K, rnd).forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });
  p.path = path;
  return p;
}

export const CAPPED_TRIES = 40;

// Share of the free edges a designer attempt pre-walls at random: SEED_FRACTION without a wall cap,
// otherwise only as many walls as the cap allows, so the seeds never outgrow what the puzzle may keep.
function designSeedFraction(n, maxWalls) {
  if (maxWalls == null) return SEED_FRACTION;
  const freeEdges = n * (n - 1) * 2 - (n * n - 1);
  return Math.min(SEED_FRACTION, maxWalls / freeEdges);
}

// Re-emit a generator's progress events with extra fields (e.g. the attempt number) merged in.
function* tag(gen, extra) {
  for (let step = gen.next(); ; step = gen.next()) {
    if (step.done) return step.value;
    yield step.value && { ...step.value, ...extra };
  }
}

// Like randomPathPuzzle but adds walls until unique, then minimises.
// Falls back to the wall-free puzzle (unique: false).
// Every attempt is seeded with random walls from the start (see designSeedFraction).
//
// K = checkpoint count (the most allowed; more checkpoints need fewer walls).
// o.maxWalls = hard cap on the final wall count (null/undefined = unbounded, legacy behaviour).
// o.tries independent attempts; each draws a NEW random path and a NEW checkpoint placement, aborts
//   wall insertion past ceil(2.5 * maxWalls) (internal slack only: minimising removes ~1/3), and
//   counts only if its minimised walls <= maxWalls.
// o.hardest: don't stop at the first candidate; use every try to collect candidates and return the one
//   whose uniqueness proof needs the most solver nodes (same solver and count as the designer's
//   Solve). Ties keep the earliest.
// The search is heuristic, not exhaustive: unique: false means "no attempt got there", not "none exists".
// o.prop (default true): solver propagation (same solutions, far fewer nodes).
// o.legCollide (default false): leg-collision pruning (see legsCollide() in solver/prune.js) —
//   applied to every internal solve() call this makes (the makeUnique probe/search loop,
//   minimizeWalls' per-wall checks, and the hardest-candidate node count), not just the final
//   check, so the counts breakdown below reflects its real cost across a full generation run.
// Random by design (caller supplies rnd), so none of this touches generate().
// Events: { frac, walls, K, attempt, of, found }.
// Returns { puzzle, unique, walls, removed, attempts, found, nodes?, counts }; on failure walls = 0.
// counts = { makeUnique, minimizeWalls, other, total } — solve() call counts by phase, for
// comparing legCollide on vs off at the same rnd seed (see design app's Solver panel).
export function* generateUnique(n, K, rnd, o = {}) {
  K = Math.max(2, Math.min(K, n * n));
  const maxWalls = o.maxWalls == null ? null : Math.max(0, Math.floor(o.maxWalls));
  const unbounded = maxWalls == null;
  const nodeCap = o.nodeCap || 50000;
  const prop = o.prop ?? true;
  const legCollide = o.legCollide ?? false;
  const tries = o.tries || (unbounded ? 3 : CAPPED_TRIES);
  const wallBudget = unbounded ? null : Math.ceil(maxWalls * 2.5);
  const seedFraction = designSeedFraction(n, maxWalls);
  const counts = { makeUnique: 0, minimizeWalls: 0, other: 0 };
  const withTotal = () => ({ ...counts, total: counts.makeUnique + counts.minimizeWalls + counts.other });

  let best = null;
  let found = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    const extra = { attempt: attempt + 1, of: tries };
    const gen = tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, { path: 'backbite', cps: 'gap', prop, legCollide, counts });
    const p = yield* tag(gen, extra);
    if (p) {
      const before = p.order.length;
      let removed = 0;
      if (before) {
        const minimized = yield* tag(minimizeWalls(p, p.order, rnd, nodeCap * 2, K, prop, legCollide, counts), extra);
        removed = minimized.removed;
      }
      if (unbounded || before - removed <= maxWalls) {
        delete p.order;
        found++;
        const candidate = { puzzle: p, unique: true, walls: before - removed, removed, attempts: attempt + 1 };
        if (!o.hardest) return { ...candidate, found, counts: withTotal() };
        // Difficulty metric: solver nodes for the uniqueness proof.
        counts.other++;
        candidate.nodes = solve(p, { limit: 2, nodeCap: nodeCap * 2, prop, legCollide }).nodes;
        if (!best || candidate.nodes > best.nodes) best = candidate;
      }
    }
    yield { frac: (attempt + 1) / tries, walls: best ? best.walls : null, K, found, ...extra };
  }
  if (best) return { ...best, found, counts: withTotal() };
  return { puzzle: randomPathPuzzle(n, K, rnd), unique: false, walls: 0, removed: 0, attempts: tries, found: 0, counts: withTotal() };
}
