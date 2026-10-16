import { makePuzzle } from '../model.js';
import { makeRng, shuffle } from '../rng.js';
import { warnsdorff, backbite, ringPath } from './hampath.js';
import {
  pairCount, pickPortals, teleportPath, teleportCheckpointRules, maxPortalPairs,
} from './portals.js';
import { gapCheckpoints, randomCheckpoints, loopCheckpoints, LOOP_TAIL } from './checkpoints.js';
import { makeUnique, minimizeWalls, refineWalls, minimizeFully, REFINE_CAP_X } from './walls.js';
import { solve } from '../solver/solve.js';

// Candidate puzzles built per play grid size. A candidate is a fresh random path with fresh
// checkpoints, walled until unique. Every candidate is then minimized and the one left with the
// fewest walls wins. Minimizing is the expensive part, so this count is the quality/time knob:
// time grows roughly with the count, the wall count shrinks. More attempts alone would not help,
// because the wall count before minimizing predicts the final count only weakly.
// The keys are the grid sizes the play app offers.
export const CANDIDATES = { 5: 64, 6: 64, 7: 64, 8: 64, 9: 64, 10: 32, 11: 32, 12: 16, 16: 8 };
export const PLAY_SIZES = Object.keys(CANDIDATES).map(Number);
const candidatesFor = n => CANDIDATES[n] || 2;
// The same for wrap-around puzzles (sizes 3 and up). Measured on 12 seeds: at n = 6 the average
// wall count goes 9.8 (2 candidates), 6.4 (32), 6.2 (64), 5.7 (128), at about 4, 60, 120 and
// 220 ms; beyond 64 the gain is small. A wrap-around puzzle needs 4 to 8 walls where the grid
// needs 0 or 1 (no free starts).
export const WRAP_CANDIDATES = { 3: 8, 4: 64, 5: 64, 6: 64, 7: 32, 8: 16 };
// The same for Loop puzzles (even sizes only: a ring needs an even number of cells). Set by
// measuring, see gen/loop.js.
export const LOOP_CANDIDATES = { 4: 64, 6: 32, 8: 16, 10: 8, 12: 4 };
// The same for Teleport puzzles (sizes 4 and up; gen/teleport.js offers 5 to 9). A portal edge
// cannot be walled,
// so a Teleport puzzle needs a few walls more than a standard one: the counts stay low enough to
// keep the
// generating time of the standard sizes. Set by measuring, see test/teleport-gen.js.
export const TELEPORT_CANDIDATES = {
  4: 32, 5: 64, 6: 64, 7: 48, 8: 32, 9: 32, 10: 16, 11: 16, 12: 8,
};
// Humans find the seams hard to hold in mind, so the play app offers the smaller boards only.
// 7 and 8 take about 0.3 and 0.5 s to generate (8 to 12 walls); the wall count hardly depends on
// the candidate count there.
export const WRAP_MIN_OFFERED = 4;
export const WRAP_MAX_OFFERED = 8;
export const WRAP_SIZES = Object.keys(WRAP_CANDIDATES)
  .map(Number)
  .filter(n => n >= WRAP_MIN_OFFERED && n <= WRAP_MAX_OFFERED);
// Most attempts spent per candidate. Failed attempts (Warnsdorff dead ends) are cheap and 30-60% of
// attempts succeed, so this only guards against an unlucky seed.
const ATTEMPTS_PER_CANDIDATE = 12;
// Wall-minimizing second look (refineWalls in walls.js), on the winner only: a total solver-node budget
// per grid cell (the per-check caps of its passes are REFINE_CAP_X times the check cap of the first look).
export const REFINE_NODES_PER_CELL = 20000;
const refineNodesFor = n => REFINE_NODES_PER_CELL * n * n;
// Share of the progress bar for that second look (taken from the minimizing share).
const REFINE_SHARE = 0.25;
// Share of the progress bar for building candidates; the rest is minimizing them.
const BUILD_SHARE = 0.1;
// With solver propagation each node is far more effective, so the seeded node caps shrink.
export const PROP_CAP_X = 0.3;
// A wall-removal check in minimizeWalls gets this share of the build cap (tools/tune-gen.mjs explores it).
export const CHECK_CAP_X = 0.5;
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
// o.wrap: a wrap-around puzzle (core/geom.js): the path, the checkpoint gaps and the walls all
// use the seams; the puzzle gets wrap: true. The grid attempt is unchanged by it.
// o.loop: a Loop puzzle (n even): the path is a ring (ringPath), the puzzle gets loop: true and
// the walls keep the closing edge free (walls.js).
// o.pairs: a Teleport puzzle with that many portal pairs (gen/portals.js): the path runs through
// every pair, the
// numbers keep off the portal cells, and the puzzle gets portals. Not with wrap / loop.
// o.legCollide: leg-collision pruning (see solve.js); o.flags: optional full build-phase solve()
// opts (see gen/flags.js), overrides o.prop/o.legCollide when given, passed straight through to
// makeUnique; o.counts: optional call-count accumulator, passed straight through to makeUnique.
export function* tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, o = {}) {
  const wrap = !!o.wrap;
  const loop = !!o.loop;
  const pairs = o.pairs || 0;
  let path;
  let positions;
  let portals = null;
  if (pairs) {
    // A Teleport puzzle: the pairs first, then a path through all of them, numbers off the portal
    // cells.
    portals = pickPortals(n, pairs, rnd);
    if (!portals) return null;
    path = teleportPath(n, portals, rnd);
    if (!path) return null;
    const rules = teleportCheckpointRules(n, portals);
    if (o.cps === 'random') {
      const open = [];
      for (let i = 1; i < path.length - 1; i++) if (!rules.skip.has(path[i])) open.push(i);
      positions = [0, ...shuffle(open, rnd).slice(0, K - 2).sort((a, b) => a - b), path.length - 1];
    } else {
      positions = gapCheckpoints(n, path, K, false, rules);
    }
    if (!positions) return null;
  } else if (loop) {
    // A ring, cut at cell 1, with the numbers short of the way round (loopCheckpoints).
    const placed = loopCheckpoints(n, ringPath(n, rnd), K, rnd);
    if (!placed) return null;
    ({ path, positions } = placed);
  } else {
    const findPath = o.path === 'backbite' ? backbite : warnsdorff;
    path = findPath(n, rnd, wrap);
    if (!path) return null;
    positions = o.cps === 'random'
      ? randomCheckpoints(path.length, K, rnd)
      : gapCheckpoints(n, path, K, wrap);
    if (!positions) return null;
  }

  const p = makePuzzle(n);
  if (wrap) p.wrap = true;
  if (loop) p.loop = true;
  if (portals) p.portals = portals;
  positions.forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });

  const order = yield* makeUnique(p, path, rnd, { nodeCap, wallBudget, seedFraction, K, prop: o.prop, legCollide: o.legCollide, flags: o.flags, counts: o.counts });
  if (!order) return null;
  p.path = path;
  p.order = order;
  return p;
}

// Last resort: every cell numbered along a Hamiltonian path.
function numberEveryCell(n, path, seed, wrap = false, loop = false) {
  const p = makePuzzle(n);
  if (wrap) p.wrap = true;
  if (loop) p.loop = true;
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

// Deterministic puzzle for (n, seed): same seed => same puzzle (ALGO_VERSION 6: solver propagation on,
// candidates seeded with SEED_FRACTION random walls, best of several minimized candidates, wall removals
// tested through the freed edge).
// o.prop === false reproduces the shape of the ALGO_VERSION 1 search (solver propagation off).
// o.candidates overrides CANDIDATES[n]; o.capX / o.checkCapX override PROP_CAP_X / CHECK_CAP_X (tuning only).
// o.freedEdge (default true since ALGO_VERSION 6): minimize with the solver's mustUse check (see minimizeWalls
//   in walls.js): about 1.5x faster and fewer node-cap hits, so fewer walls. o.freedEdge === false gives the
//   ALGO_VERSION 5 two-solution check (kept for comparisons; the output is not pinned).
// A candidate whose minimizing can no longer beat the best one so far is dropped early (`bound` below):
//   same puzzle, less work.
// The winner then gets a deeper look at the walls its minimizing kept only because a check hit its node cap
//   (refineWalls in walls.js), within o.refineNodes solver nodes (default REFINE_NODES_PER_CELL * n^2; 0 = off).
//   A node budget, not a clock, so the same seed still gives the same puzzle on every device.
// Events: { frac|null, walls, K }. `walls` never increases: it is the fewest walls found so far.
// o.wrap: a wrap-around puzzle (needs n >= 3; core/geom.js), candidates from WRAP_CANDIDATES.
// o.teleport: a Teleport puzzle (needs n >= 4; gen/teleport.js), candidates from
// TELEPORT_CANDIDATES; o.pairs
//   the number of portal pairs (default pairCount(), which reads o.difficulty, 0..5).
export function* generate(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const cells = n * n;
  const wrap = !!o.wrap;
  const loop = !!o.loop;
  const teleport = !!o.teleport;
  if (wrap && n < 3) throw new Error('A wrap-around puzzle needs n >= 3');
  if (loop && (n % 2 || wrap)) throw new Error('A loop puzzle needs an even n, on a grid');
  if (teleport && (n < 4 || wrap || loop)) {
    throw new Error('A Teleport puzzle needs n >= 4, on a grid');
  }
  const prop = o.prop !== false;
  const freedEdge = o.freedEdge !== false;
  const candidatesOf = () => (teleport ? TELEPORT_CANDIDATES[n]
    : wrap ? WRAP_CANDIDATES[n] : loop ? LOOP_CANDIDATES[n] : candidatesFor(n));
  const wanted = o.candidates || candidatesOf() || 2;
  const rnd = makeRng(seed);
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * (o.capX ?? (prop ? PROP_CAP_X : 1)));
  const fallbackCap = Math.min(2000000, Math.max(300000, 20 * nodeCap));
  const checkCap = Math.max(1000, Math.floor(nodeCap * (o.checkCapX ?? CHECK_CAP_X)));
  const Kmin = Math.max(4, n);
  const Kmax = Math.max(Kmin + 1, Math.round(cells / 4));
  const K = pickK(Kmin, Kmax, rnd);
  // Teleport: how many pairs (1 on 5 and 6, 1 or 2 from 7: gen/portals.js), drawn after K so that
  // no other variant's stream changes.
  const pairs = teleport ? (o.pairs ?? pairCount(n, rnd, o.difficulty)) : 0;

  // 1. Build candidates.
  const candidates = [];
  const maxAttempts = wanted * ATTEMPTS_PER_CANDIDATE;
  for (let attempt = 0; attempt < maxAttempts && candidates.length < wanted; attempt++) {
    // The attempt's own wall counts jump around, so report the fewest found so far instead.
    const attemptEvents = tryGenerate(
      n, K, rnd, nodeCap, cells, SEED_FRACTION, { prop, wrap, loop, pairs },
    );
    const found = yield* tag(attemptEvents, { walls: fewestWalls(candidates) });
    if (found) candidates.push(found);
    yield { frac: (BUILD_SHARE * candidates.length) / wanted, walls: fewestWalls(candidates), K };
  }
  for (let fallback = 0; fallback < 4 && candidates.length === 0; fallback++) {
    const attemptEvents = tryGenerate(
      n, K, rnd, fallbackCap, cells, SEED_FRACTION, { prop, wrap, loop, pairs },
    );
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
    const dense = yield* tryGenerate(n, Kmax, rnd, denseCap, cells, 0, { prop, wrap, loop, pairs });
    if (dense) {
      if (dense.order.length) yield* minimizeWalls(dense, dense.order, rnd, nodeCap, Kmax, { prop, freedEdge });
      delete dense.order;
      dense.seed = seed;
      return dense;
    }
    if (teleport) throw new Error('Puzzle generation failed: no Teleport puzzle found for N=' + n);
    if (loop) return numberEveryCell(n, ringPath(n, rnd), seed, false, true);
    for (let x = 0; x < 11; x++) {
      const path = warnsdorff(n, rnd, wrap);
      if (path) return numberEveryCell(n, path, seed, wrap);
    }
    throw new Error('Puzzle generation failed: could not construct a Hamiltonian path for N=' + n);
  }

  // 2. Minimize every candidate; keep the one with the fewest walls (the earliest on a tie).
  let shown = fewestWalls(candidates); // the wall count reported to the UI; it only goes down
  const budget = o.refineNodes ?? refineNodesFor(n);
  const refining = freedEdge && budget > 0;
  const minShare = 1 - BUILD_SHARE - (refining ? REFINE_SHARE : 0);

  function* minimizeCandidate(candidate, index) {
    const total = candidate.order.length;
    const events = minimizeWalls(candidate, candidate.order, rnd, checkCap, K, { prop, freedEdge, bound: winnerWalls });
    let tested = 0;
    for (let step = events.next(); ; step = events.next()) {
      if (step.done) {
        // dropped early: it cannot beat the best candidate, so jump the bar to the end of its share
        if (step.value.aborted) yield { frac: BUILD_SHARE + minShare * ((index + 1) / candidates.length), walls: shown, K };
        return step.value;
      }
      tested++;
      shown = Math.min(shown, step.value.walls);
      const progress = (index + tested / total) / candidates.length;
      yield { frac: BUILD_SHARE + minShare * progress, walls: shown, K };
    }
  }

  let winner = null;
  let winnerWalls = Infinity;
  let winnerUncertain = [];
  for (let i = 0; i < candidates.length && winnerWalls > 0; i++) {
    const candidate = candidates[i];
    let kept = candidate.order.length;
    let uncertain = [];
    if (kept > 0) {
      const r = yield* minimizeCandidate(candidate, i);
      kept = r.kept;
      uncertain = r.uncertain || [];
    }
    if (kept < winnerWalls) {
      winner = candidate;
      winnerWalls = kept;
      winnerUncertain = uncertain;
    }
  }
  // 3. Only the winner: take a second, deeper look at the walls kept because a check hit its node cap.
  if (refining && winnerUncertain.length) {
    const events = refineWalls(winner, winnerUncertain, rnd, { prop, caps: REFINE_CAP_X.map(x => x * checkCap), budget, walls: winnerWalls, K });
    let step;
    while (!(step = events.next()).done) {
      yield { ...step.value, frac: BUILD_SHARE + minShare + (REFINE_SHARE * step.value.nodes) / budget };
    }
    winnerWalls = step.value.kept;
  }
  yield { frac: 1, walls: winnerWalls, K };
  delete winner.order;
  winner.seed = seed;
  return winner;
}

// ---- Designer helpers (random, unseeded by design: caller supplies rnd) ----

// Random Hamiltonian path + K random checkpoints along it, no walls.
// pairs > 0 (n >= 4): a Teleport puzzle with that many portal pairs (fewer if they do not fit),
// the path through all
// of them, the checkpoints off the portal cells.
// loop (n even, on a grid): a Loop puzzle: a random ring cut at a random cell, which is cell 1, and
// the numbers on its first stretch, short of the way round as in loopCheckpoints; p.path is the ring
// from cell 1 on (its last cell touches the first), and K is at least 3.
export function randomPathPuzzle(n, K, rnd, wrap = false, loop = false, pairs = 0) {
  K = Math.max(loop ? 3 : 2, Math.min(K, n * n));
  const p = makePuzzle(n);
  let path;
  let positions;
  if (pairs > 0) {
    // pairs: a Teleport puzzle (n >= 4): the pairs, a path through all of them, the numbers off
    // the portal cells.
    // Fewer pairs when that many do not fit.
    let portals = null;
    for (let want = Math.min(pairs, maxPortalPairs(n, K)); want >= 1 && !path; want--) {
      portals = pickPortals(n, want, rnd);
      path = portals && teleportPath(n, portals, rnd);
    }
    if (!path) throw new Error('No Teleport board found for N=' + n);
    const rules = teleportCheckpointRules(n, portals);
    const open = [];
    for (let i = 1; i < path.length - 1; i++) if (!rules.skip.has(path[i])) open.push(i);
    positions = [0, ...shuffle(open, rnd).slice(0, K - 2).sort((a, b) => a - b), path.length - 1];
    p.portals = portals;
  } else if (loop) {
    const ring = ringPath(n, rnd);
    const cut = Math.floor(rnd() * ring.length);
    path = ring.slice(cut).concat(ring.slice(0, cut));
    const tail = Math.round(path.length * (LOOP_TAIL[0] + (LOOP_TAIL[1] - LOOP_TAIL[0]) * rnd()));
    positions = randomCheckpoints(path.length - tail, K, rnd);
    p.loop = true;
  } else {
    path = backbite(n, rnd, wrap);
    positions = randomCheckpoints(path.length, K, rnd);
    if (wrap) p.wrap = true;
  }
  positions.forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });
  p.path = path;
  return p;
}

export const CAPPED_TRIES = 40;
// generateUnique()'s second look at the walls kept because a check hit its node cap (refineWalls in walls.js):
// this many times the minimizing check cap in solver nodes, per attempt (o.refineNodes overrides; 0 = off).
export const GENERATE_UNIQUE_REFINE_X = 10;

// Share of the free edges a designer attempt pre-walls at random: SEED_FRACTION without a wall cap,
// otherwise only as many walls as the cap allows, so the seeds never outgrow what the puzzle may keep.
function designSeedFraction(n, maxWalls, wrap = false, loop = false) {
  if (maxWalls == null) return SEED_FRACTION;
  const freeEdges = (wrap ? 2 * n * n : n * (n - 1) * 2) - (loop ? n * n : n * n - 1);
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
// o.refineNodes (default GENERATE_UNIQUE_REFINE_X * 2 * nodeCap): solver-node budget per attempt for the deeper look at walls
//   that minimizing kept only because a check hit its cap (minimizeFully in walls.js); 0 = minimize once, as before.
//   An attempt with a wall cap skips it when even removing every undecided wall could not get under maxWalls.
// o.wrap: a wrap-around puzzle (needs n >= 3; core/geom.js).
// o.pairs: a Teleport puzzle with that many portal pairs (at most maxPortalPairs; n >= 4, a grid;
// gen/portals.js),
//   the path through every pair, the numbers off the portal cells.
// o.loop: a Loop puzzle (n even, a grid; core/model.js): the ring path and numbers of tryGenerate (the
//   o.flags path / cps choices do not apply), K at least 3.
// o.prop (default true): solver propagation (same solutions, far fewer nodes).
// o.legCollide (default false): leg-collision pruning (see legsCollide() in solver/prune.js) —
//   applied to every internal solve() call this makes (the makeUnique probe/search loop,
//   minimizeWalls' per-wall checks, and the hardest-candidate node count), not just the final
//   check, so the counts breakdown below reflects its real cost across a full generation run.
// o.flags: optional result of decodeFlags() (see gen/flags.js) — { build, minimize, score, path,
//   cps } — lets each of the 3 solve() phases (build/minimize/score) use a different set of
//   solver prunes, and path/cps override the hardcoded 'backbite'/'gap' below. When given, it
//   overrides o.prop/o.legCollide entirely (each phase byte already carries its own prop/legCollide
//   bits); when absent, behaviour is o.prop/o.legCollide applied to every phase, and the minimize phase
//   with the freedEdge check unless o.freedEdge === false (the same as DEFAULT_FLAGS_INT in flags.js).
// Random by design (caller supplies rnd), so none of this touches generate().
// Events: { frac, walls, K, attempt, of, found }.
// Returns { puzzle, unique, walls, removed, attempts, found, nodes?, counts }; on failure walls = 0.
// counts = { makeUnique, minimizeWalls, other, total } — solve() call counts by phase, for
// comparing legCollide on vs off at the same rnd seed (see design app's Solver panel).
export function* generateUnique(n, K, rnd, o = {}) {
  const loop = !!o.loop;
  const pairs = o.pairs > 0 ? Math.min(Math.floor(o.pairs), maxPortalPairs(n, K)) : 0;
  if (pairs && (n < 4 || o.wrap || loop)) {
    throw new Error('A Teleport puzzle needs n >= 4, on a grid');
  }
  K = Math.max(loop ? 3 : 2, Math.min(K, n * n));
  const maxWalls = o.maxWalls == null ? null : Math.max(0, Math.floor(o.maxWalls));
  const unbounded = maxWalls == null;
  const nodeCap = o.nodeCap || 50000;
  const prop = o.prop ?? true;
  const legCollide = o.legCollide ?? false;
  const f = o.flags || null;
  const buildFlags = f ? f.build : { prop, legCollide };
  const minimizeFlags = f ? f.minimize : { prop, legCollide, freedEdge: o.freedEdge ?? true };
  const scoreFlags = f ? f.score : { prop, legCollide };
  const pathAlgo = f ? f.path : 'backbite';
  const cpsAlgo = f ? f.cps : 'gap';
  const tries = o.tries || (unbounded ? 3 : CAPPED_TRIES);
  const wallBudget = unbounded ? null : Math.ceil(maxWalls * 2.5);
  const wrap = !!o.wrap;
  if (wrap && n < 3) throw new Error('A wrap-around puzzle needs n >= 3');
  if (loop && (n % 2 || wrap)) throw new Error('A loop puzzle needs an even n, on a grid');
  const seedFraction = designSeedFraction(n, maxWalls, wrap, loop);
  const refineBudget = o.refineNodes ?? GENERATE_UNIQUE_REFINE_X * nodeCap * 2;
  const counts = { makeUnique: 0, minimizeWalls: 0, other: 0 };
  const withTotal = () => ({ ...counts, total: counts.makeUnique + counts.minimizeWalls + counts.other });

  let best = null;
  let found = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    const extra = { attempt: attempt + 1, of: tries };
    const gen = tryGenerate(n, K, rnd, nodeCap, wallBudget, seedFraction, {
      path: pathAlgo, cps: cpsAlgo, flags: buildFlags, counts, wrap, loop, pairs,
    });
    const p = yield* tag(gen, extra);
    if (p) {
      const before = p.order.length;
      let removed = 0;
      if (before) {
        const minimized = yield* tag(minimizeFully(p, p.order, rnd, nodeCap * 2, K, { flags: minimizeFlags, counts, refineBudget, maxKept: unbounded ? null : maxWalls }), extra);
        removed = minimized.removed;
      }
      if (unbounded || before - removed <= maxWalls) {
        delete p.order;
        found++;
        const candidate = { puzzle: p, unique: true, walls: before - removed, removed, attempts: attempt + 1 };
        if (!o.hardest) return { ...candidate, found, counts: withTotal() };
        // Difficulty metric: solver nodes for the uniqueness proof.
        counts.other++;
        candidate.nodes = solve(p, { limit: 2, nodeCap: nodeCap * 2, ...scoreFlags }).nodes;
        if (!best || candidate.nodes > best.nodes) best = candidate;
      }
    }
    yield { frac: (attempt + 1) / tries, walls: best ? best.walls : null, K, found, ...extra };
  }
  if (best) return { ...best, found, counts: withTotal() };
  const puzzle = randomPathPuzzle(n, K, rnd, wrap, loop, pairs);
  return { puzzle, unique: false, walls: 0, removed: 0, attempts: tries, found: 0, counts: withTotal() };
}
