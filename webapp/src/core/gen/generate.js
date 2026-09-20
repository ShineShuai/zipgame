import { makePuzzle } from '../model.js';
import { makeRng } from '../rng.js';
import { warnsdorff, backbite } from './hampath.js';
import { gapCheckpoints, randomCheckpoints } from './checkpoints.js';
import { makeUnique, minimizeWalls } from './walls.js';
import { solve } from '../solver/solve.js';

// Attempts per grid size. Every attempt is seeded with random walls and only the best one (fewest walls
// before minimizing) gets minimized, so extra attempts mostly add cost: cheap grids keep a generous
// budget, mid sizes get a few, and 16x16 keeps 8 (fewer measurably left more walls at the same time).
export const ATTEMPTS = { 5: 20, 7: 20, 9: 6, 11: 5, 16: 8 };
const attemptsFor = n => ATTEMPTS[n] || Math.max(5, Math.round(600 / (n * n)));
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

  const order = yield* makeUnique(p, path, rnd, { nodeCap, wallBudget, seedFraction, K, prop: o.prop });
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

// Deterministic puzzle for (n, seed): same seed => same puzzle (ALGO_VERSION 4: solver propagation on,
// every attempt seeded with SEED_FRACTION random walls).
// o.prop === false reproduces the shape of the ALGO_VERSION 1 search (solver propagation off).
// Events: { frac|null, walls, K }.
export function* generate(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const cells = n * n;
  const prop = o.prop !== false;
  const budget = o.attemptBudget || attemptsFor(n);
  const rnd = makeRng(seed);
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * (prop ? PROP_CAP_X : 1));
  const fallbackCap = Math.min(2000000, Math.max(300000, 20 * nodeCap));
  const Kmin = Math.max(4, n);
  const Kmax = Math.max(Kmin + 1, Math.round(cells / 4));
  const K = pickK(Kmin, Kmax, rnd);

  let best = null;
  for (let attempt = 0; attempt < budget; attempt++) {
    const found = yield* tryGenerate(n, K, rnd, nodeCap, cells, SEED_FRACTION, { prop });
    if (found) {
      if (!best || found.order.length < best.order.length) {
        best = found;
        if (best.order.length === 0) break;
      }
    }
    yield { frac: Math.min(1, (attempt + 1) / budget), walls: best ? best.order.length : null, K };
  }

  for (let fallback = 0; fallback < 4 && !best; fallback++) {
    best = yield* tryGenerate(n, K, rnd, fallbackCap, cells, SEED_FRACTION, { prop });
    yield { frac: 1, walls: best ? best.order.length : null, K };
  }

  if (!best) {
    if (depth < 5) {
      return yield* generate(n, seed + 1, { ...o, attemptBudget: budget, retryDepth: depth + 1 });
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

  let kept = best.order.length;
  yield { frac: 1, walls: kept, K };
  if (kept > 0) {
    const checkCap = Math.max(1000, Math.floor(nodeCap / 2));
    kept = (yield* minimizeWalls(best, best.order, rnd, checkCap, K, prop)).kept;
    yield { frac: 1, walls: kept, K };
  }
  delete best.order;
  best.seed = seed;
  return best;
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
// Random by design (caller supplies rnd), so none of this touches generate().
// Events: { frac, walls, K, attempt, of, found }.
// Returns { puzzle, unique, walls, removed, attempts, found, nodes? }; on failure walls = 0.
export function* generateUnique(n, K, rnd, o = {}) {
  K = Math.max(2, Math.min(K, n * n));
  const maxWalls = o.maxWalls == null ? null : Math.max(0, Math.floor(o.maxWalls));
  const unbounded = maxWalls == null;
  const nodeCap = o.nodeCap || 50000;
  const prop = o.prop ?? true;
  const tries = o.tries || (unbounded ? 3 : CAPPED_TRIES);
  const wallBudget = unbounded ? null : Math.ceil(maxWalls * 2.5);
  const seedFraction = designSeedFraction(n, maxWalls);

  let best = null;
  let found = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    const extra = { attempt: attempt + 1, of: tries };
    const gen = tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, { path: 'backbite', cps: 'gap', prop });
    const p = yield* tag(gen, extra);
    if (p) {
      const before = p.order.length;
      let removed = 0;
      if (before) {
        const minimized = yield* tag(minimizeWalls(p, p.order, rnd, nodeCap * 2, K, prop), extra);
        removed = minimized.removed;
      }
      if (unbounded || before - removed <= maxWalls) {
        delete p.order;
        found++;
        const candidate = { puzzle: p, unique: true, walls: before - removed, removed, attempts: attempt + 1 };
        if (!o.hardest) return { ...candidate, found };
        // Difficulty metric: solver nodes for the uniqueness proof.
        candidate.nodes = solve(p, { limit: 2, nodeCap: nodeCap * 2, prop }).nodes;
        if (!best || candidate.nodes > best.nodes) best = candidate;
      }
    }
    yield { frac: (attempt + 1) / tries, walls: best ? best.walls : null, K, found, ...extra };
  }
  if (best) return { ...best, found };
  return { puzzle: randomPathPuzzle(n, K, rnd), unique: false, walls: 0, removed: 0, attempts: tries, found: 0 };
}
