import { makePuzzle } from '../model.js';
import { makeRng } from '../rng.js';
import { warnsdorff, backbite } from './hampath.js';
import { gapCheckpoints, randomCheckpoints } from './checkpoints.js';
import { makeUnique, minimizeWalls } from './walls.js';
import { solve } from '../solver/solve.js';

export const ATTEMPTS = { 5: 200, 7: 60, 9: 30, 11: 15, 16: 8 };   // attempts per grid size (cheap grids get more tries)
export const PROP_CAP_X = 0.3;                                          // v2: with solver propagation each node is far more effective, so the seeded node caps shrink (faster, same/better walls)
export const HARD_FRACTION = 0.15, SEED_FRACTION = 0.4;             // if 1st result needs >=15% of free edges, pre-wall 40% in later attempts

// K ~ Normal(mean = Kmin + 0.3*(Kmax-Kmin), sd = range/6), Box-Muller, clamped to [Kmin, Kmax]. Favors small K. Always 2 rnd() calls.
export function pickK(Kmin, Kmax, rnd) {
  const R = Kmax - Kmin, u = 1 - rnd(), v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(Kmax, Math.max(Kmin, Math.round(Kmin + 0.3 * R + (R / 6) * z)));
}

// One attempt: path -> checkpoints -> walls until unique. Returns puzzle (with .path and .order) or null.
// o.path: 'warnsdorff' | 'backbite'; o.cps: 'gap' | 'random'
export function* tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, o = {}) { // o.prop: opt-in solver propagation
  const path = (o.path === 'backbite' ? backbite : warnsdorff)(n, rnd);
  if (!path) return null;
  const pos = o.cps === 'random' ? randomCheckpoints(path.length, K, rnd) : gapCheckpoints(n, path, K);
  if (!pos) return null;
  const p = makePuzzle(n); pos.forEach((q, i) => { p.cp[path[q]] = i + 1; });
  const order = yield* makeUnique(p, path, rnd, { nodeCap, wallBudget, seedFraction, K, prop: o.prop });
  if (!order) return null;
  p.path = path; p.order = order;
  return p;
}

const numberEveryCell = (n, path, seed) => { const p = makePuzzle(n); path.forEach((c, i) => { p.cp[c] = i + 1; }); p.path = path; p.seed = seed; return p; };

// Deterministic puzzle for (n, seed): same seed => same puzzle (ALGO_VERSION 2 = solver propagation on). o.prop === false reproduces the ALGO_VERSION 1 puzzles exactly.
// Events: { frac|null, walls, K }.
export function* generate(n, seed, o = {}) {
  const depth = o.retryDepth || 0, cells = n * n, prop = o.prop !== false;
  const budget = o.attemptBudget || ATTEMPTS[n] || Math.max(20, Math.round(6000 / cells));
  const rnd = makeRng(seed);
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * (prop ? PROP_CAP_X : 1)), fbCap = Math.min(2000000, Math.max(300000, 20 * nodeCap));
  const Kmin = Math.max(4, n), Kmax = Math.max(Kmin + 1, Math.round(cells / 4));
  const K = pickK(Kmin, Kmax, rnd);
  const poolLen = (n * (n - 1) * 2) - (cells - 1);
  let best = null, seedFrac = 0, decided = false;

  for (let a = 0; a < budget; a++) {
    const r = yield* tryGenerate(n, K, rnd, nodeCap, cells, seedFrac, { prop });
    if (r) {
      if (!decided) { decided = true; if (r.order.length >= poolLen * HARD_FRACTION) seedFrac = SEED_FRACTION; }
      if (!best || r.order.length < best.order.length) { best = r; if (best.order.length === 0) break; }
    }
    yield { frac: Math.min(1, (a + 1) / budget), walls: best ? best.order.length : null, K };
  }
  for (let fb = 0; fb < 4 && !best; fb++) {
    best = yield* tryGenerate(n, K, rnd, fbCap, cells, SEED_FRACTION, { prop });
    yield { frac: 1, walls: best ? best.order.length : null, K };
  }
  if (!best) {
    if (depth < 5) return yield* generate(n, seed + 1, { ...o, attemptBudget: budget, retryDepth: depth + 1 });
    // last resorts, bounded (no unbounded recursion): densest K, then "number every cell"
    const dense = yield* tryGenerate(n, Kmax, rnd, Math.max(300000, 20 * nodeCap), cells, 0, { prop });
    if (dense) {
      if (dense.order.length) yield* minimizeWalls(dense, dense.order, rnd, nodeCap, Kmax, prop);
      delete dense.order; dense.seed = seed; return dense;
    }
    for (let x = 0; x < 11; x++) { const path = warnsdorff(n, rnd); if (path) return numberEveryCell(n, path, seed); }
    throw new Error('Puzzle generation failed: could not construct a Hamiltonian path for N=' + n);
  }
  let kept = best.order.length;
  yield { frac: 1, walls: kept, K };
  if (kept > 0) {
    kept = (yield* minimizeWalls(best, best.order, rnd, Math.max(1000, Math.floor(nodeCap / 2)), K, prop)).kept;
    yield { frac: 1, walls: kept, K };
  }
  delete best.order; best.seed = seed;
  return best;
}

// ---- Designer helpers (random, unseeded by design: caller supplies rnd) ----

// Random Hamiltonian path + K random checkpoints along it, no walls.
export function randomPathPuzzle(n, K, rnd) {
  K = Math.max(2, Math.min(K, n * n));
  const path = backbite(n, rnd), p = makePuzzle(n);
  randomCheckpoints(path.length, K, rnd).forEach((q, i) => { p.cp[path[q]] = i + 1; });
  p.path = path;
  return p;
}

// Like randomPathPuzzle but adds walls until unique, then minimises. Falls back to the wall-free puzzle (unique:false).
// K = checkpoint count (the most allowed; more checkpoints need fewer walls). o.maxWalls = hard cap on the final wall count
// (null/undefined = unbounded, legacy behaviour).
// Search: o.tries independent attempts; each draws a NEW random path and a NEW checkpoint placement, aborts wall insertion past
// ceil(2.5*maxWalls) (internal slack only: minimising removes ~1/3), and counts only if its minimised walls <= maxWalls.
// o.hardest: don't stop at the first candidate; use every try to collect candidates and return the one whose uniqueness proof needs the most
// solver nodes (same solver and count as the designer's Solve). Ties keep the earliest.
// The search is heuristic, not exhaustive: unique:false means "no attempt got there", not "none exists".
// o.prop (default true): solver propagation (same solutions, far fewer nodes). Unseeded by design, so this does not touch generate().
// Events: { frac, walls, K, attempt, of, found }. Returns { puzzle, unique, walls, removed, attempts, found, nodes? }; on failure walls = 0.
export const CAPPED_TRIES = 40;
const tag = function* (gen, x) { for (let r = gen.next(); ; r = gen.next()) { if (r.done) return r.value; yield r.value && { ...r.value, ...x }; } };
export function* generateUnique(n, K, rnd, o = {}) {
  K = Math.max(2, Math.min(K, n * n));
  const W = o.maxWalls == null ? null : Math.max(0, Math.floor(o.maxWalls)), unb = W == null, nodeCap = o.nodeCap || 50000, prop = o.prop ?? true;
  const tries = o.tries || (unb ? 3 : CAPPED_TRIES);
  let best = null, found = 0;
  for (let a = 0; a < tries; a++) {
    const x = { attempt: a + 1, of: tries };
    const p = yield* tag(tryGenerate(n, K, rnd, nodeCap, unb ? null : Math.ceil(W * 2.5), unb && a ? SEED_FRACTION : 0, { path: 'backbite', cps: 'gap', prop }), x);
    if (p) {
      const before = p.order.length, { removed } = before ? yield* tag(minimizeWalls(p, p.order, rnd, nodeCap * 2, K, prop), x) : { removed: 0 };
      if (unb || before - removed <= W) {
        delete p.order; found++;
        const c = { puzzle: p, unique: true, walls: before - removed, removed, attempts: a + 1 };
        if (!o.hardest) return { ...c, found };
        c.nodes = solve(p, { limit: 2, nodeCap: nodeCap * 2, prop }).nodes;
        if (!best || c.nodes > best.nodes) best = c;
      }
    }
    yield { frac: (a + 1) / tries, walls: best ? best.walls : null, K, found, ...x };
  }
  return best ? { ...best, found } : { puzzle: randomPathPuzzle(n, K, rnd), unique: false, walls: 0, removed: 0, attempts: tries, found: 0 };
}
