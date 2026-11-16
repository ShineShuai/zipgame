// Unit tests of generation: generate, generateUnique, flags, wall minimising.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import {
  makePuzzle, clonePuzzle, validate, maxNumber, ALGO_VERSION,
} from '../../src/core/model.js';
import { allEdges, setWallId, hasWallId, wallCount } from '../../src/core/edges.js';
import { serialize } from '../../src/core/format.js';
import { makeRng, hashStr } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { isSolved } from '../../src/core/rules.js';
import {
  generate, generateUnique, randomPathPuzzle, pickK, PLAY_SIZES, tryGenerate, PROP_CAP_X,
} from '../../src/core/gen/generate.js';
import { scatter } from '../../src/core/gen/checkpoints.js';
import {
  encodeFlags, decodeFlags, flagsToHex, hexToFlags, DEFAULT_FLAGS_INT, DEFAULT_GEN_FLAGS,
  DEFAULT_MINIMIZE_FLAGS, PLAY_FLAGS_INT,
} from '../../src/core/gen/flags.js';
import {
  minimizeWalls, makeUnique, refineWalls, minimizeFully, REFINE_CAP_X,
} from '../../src/core/gen/walls.js';
import { runSync } from '../../src/core/run.js';
import { GOLDEN } from '../golden.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';

t.slow('generate: ALGO_VERSION 6 golden puzzles cover every play size below 16 and are valid and unique', () => {
  // compat pin: bump with the golden puzzles (README)
  eq(ALGO_VERSION, 6);
  for (const n of PLAY_SIZES.filter(size => size < 16)) {
    ok(GOLDEN.some(([size]) => size === n), `no golden puzzle for play size ${n}`);
  }
  for (const [n, seed, hash] of GOLDEN) {
    const p = runSync(generate(n, seed));
    eq(hashStr(serialize(p)), hash, `v6 n=${n} seed=${seed}`);
    eq(validate(p).ok, true, `valid n=${n} seed=${seed}`);
    eq(isSolved(p, p.path), true, `anchor path n=${n} seed=${seed}`);
    eq(solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count, 1, `unique n=${n} seed=${seed}`);
  }
});

t('generate: progress events only move forward (frac up, walls down) and end at 1', () => {
  const events = [];
  runSync(generate(7, 5), e => events.push(e));
  ok(events.length > 0, 'no events');
  let frac = 0;
  let walls = Infinity;
  for (const e of events) {
    if (e.frac != null) {
      ok(e.frac >= frac, `frac went back from ${frac} to ${e.frac}`);
      frac = e.frac;
    }
    if (e.walls != null) {
      ok(e.walls <= walls, `walls went up from ${walls} to ${e.walls}`);
      walls = e.walls;
    }
  }
  eq(frac, 1);
});

t('generate: more candidates never give a puzzle with more walls than the first candidate alone', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const one = wallCount(runSync(generate(7, seed, { candidates: 1 })));
    const many = wallCount(runSync(generate(7, seed, { candidates: 6 })));
    ok(many <= one, `seed ${seed}: ${many} walls with 6 candidates vs ${one} with 1`);
  }
});

t('pickK: deterministic, always in range, uses 2 rnd values, mode near 30% of the range', () => {
  const Kmin = 9;
  const Kmax = 20;
  eq(pickK(Kmin, Kmax, makeRng(7)), pickK(Kmin, Kmax, makeRng(7)));

  let draws = 0;
  const rng = makeRng(3);
  pickK(Kmin, Kmax, () => { draws++; return rng(); });
  eq(draws, 2);

  const rnd = makeRng(1);
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const k = pickK(Kmin, Kmax, rnd);
    ok(k >= Kmin && k <= Kmax, `k=${k} outside [${Kmin}, ${Kmax}]`);
    counts[k] = (counts[k] || 0) + 1;
  }
  const mode = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
  ok(Math.abs(mode - (Kmin + 0.3 * (Kmax - Kmin))) <= 1, `mode ${mode} is not near 30% of the range`);
  eq(pickK(5, 6, makeRng(2)) >= 5, true); // a two-value range still works
});

t('generate: unique, anchor path valid, progress events, same-seed determinism', () => {
  let ev = 0, last = null; const p = runSync(generate(5, 77), e => { ev++; last = e; });
  eq(validate(p).ok, true); eq(isSolved(p, p.path), true); eq(solve(p, { limit: 2, nodeCap: 2e6 }).count, 1);
  ok(ev > 0 && last.frac === 1); eq(serialize(runSync(generate(5, 77))), serialize(p));
});

t('designer helpers: randomPathPuzzle, generateUnique, scatter', () => {
  const rnd = makeRng(5), a = randomPathPuzzle(6, 5, rnd); eq(validate(a).max, 5); eq(isSolved(a, a.path), true);
  const r = runSync(generateUnique(6, 5, rnd)); eq(r.unique, true); eq(solve(r.puzzle, { nodeCap: 1e6 }).count, 1);
  const cp = scatter(makePuzzle(6), 7, rnd); eq([...cp].filter(Boolean).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7]);
});

t('generateUnique: maxWalls / K are hard bounds (feasible, tight, infeasible); unbounded call unchanged', () => {
  let tight = 0;
  for (let s = 1; s <= 12; s++) { // feasible: unique, <= K checkpoints, <= maxWalls, reported walls == actual walls
    const r = runSync(generateUnique(6, 6, makeRng(s), { maxWalls: 6 })), p = r.puzzle;
    eq(r.unique, true, `seed ${s}`); ok(wallCount(p) <= 6 && wallCount(p) === r.walls && maxNumber(p) === 6, `bounds seed ${s}`);
    eq(solve(p, { limit: 2, nodeCap: 2e6 }).count, 1); eq(isSolved(p, p.path), true);
  }
  for (let s = 1; s <= 8; s++) { // maxWalls 0: unique only when the checkpoints alone force it; never a wall either way
    const r = runSync(generateUnique(6, 8, makeRng(s), { maxWalls: 0 })); eq(wallCount(r.puzzle), 0); if (r.unique) { tight++; eq(solve(r.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1); }
  } ok(tight > 0, 'no wall-free unique puzzle found');
  const bad = runSync(generateUnique(6, 2, makeRng(1), { maxWalls: 0 })); // infeasible: falls back inside the bounds, flagged non-unique
  eq([bad.unique, bad.walls, wallCount(bad.puzzle), maxNumber(bad.puzzle)], [false, 0, 0, 2]);
  const evs = [], f = runSync(generateUnique(6, 2, makeRng(3), { maxWalls: 0, tries: 3 }), e => evs.push(e)); // all 3 tries fail
  eq([f.unique, f.attempts, wallCount(f.puzzle)], [false, 3, 0]); ok(evs.length && evs.every(e => e.of === 3 && e.attempt >= 1 && e.attempt <= 3) && evs.some(e => e.attempt === 3), 'attempt-tagged events');
  const legacy = runSync(generateUnique(6, 5, makeRng(5))); eq(legacy.unique, true); ok(wallCount(legacy.puzzle) === legacy.walls, 'unbounded still exact');
});

t('generateUnique hardest: uses every try, keeps the max-node candidate, bounds still hold', () => {
  for (const seed of [1, 2, 3]) {
    const first = runSync(generateUnique(6, 6, makeRng(seed), { maxWalls: 6, tries: 12 })), evs = [];
    const h = runSync(generateUnique(6, 6, makeRng(seed), { maxWalls: 6, tries: 12, hardest: true }), e => evs.push(e));
    eq(h.unique, true); ok(h.found >= 1 && h.attempts >= first.attempts, 'found/attempts');
    ok(new Set(evs.map(e => e.attempt)).size === 12 && evs.at(-1).attempt === 12 && evs.at(-1).found === h.found, 'all 12 tries used, candidate count reported');
    ok(wallCount(h.puzzle) <= 6 && wallCount(h.puzzle) === h.walls && maxNumber(h.puzzle) === 6, 'bounds');
    const nodes = q => solve(q, { limit: 2, nodeCap: 1e6, prop: true }).nodes;
    eq(nodes(h.puzzle), h.nodes); ok(h.nodes >= nodes(first.puzzle), 'first candidate is among the candidates, so max >= first');
    eq(solve(h.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1);
  }
  const none = runSync(generateUnique(6, 2, makeRng(1), { maxWalls: 0, tries: 2, hardest: true })); eq([none.unique, none.found, wallCount(none.puzzle)], [false, 0, 0]);
});

t('flags: encode/decode round trip (all-off, all-on, seg tri-state, path/cps, per-phase divergence)', () => {
  const off = { prop: false, legCollide: false, pocket: false, parity: false, prune2: false, seg: false };
  eq(decodeFlags(encodeFlags({ score: off, path: 'warnsdorff', cps: 'gap' })), { build: off, minimize: off, score: off, path: 'warnsdorff', cps: 'gap' });
  const on = { prop: true, legCollide: true, pocket: true, parity: true, prune2: true, seg: 'all' };
  eq(decodeFlags(encodeFlags({ score: on, path: 'backbite', cps: 'random' })), { build: on, minimize: on, score: on, path: 'backbite', cps: 'random' });
  for (const seg of [false, true, 'all']) eq(decodeFlags(encodeFlags({ score: { seg } })).score.seg, seg);
  // per-phase divergence: each phase keeps its own byte independently
  const build = { prop: true, legCollide: false, pocket: false, parity: false, prune2: false, seg: false };
  const minimize = { prop: false, legCollide: true, pocket: false, parity: false, prune2: false, seg: true };
  const score = { prop: true, legCollide: true, pocket: true, parity: false, prune2: true, seg: 'all' };
  const v = encodeFlags({ build, minimize, score, path: 'backbite', cps: 'gap' });
  eq(decodeFlags(v), { build, minimize, score, path: 'backbite', cps: 'gap' });
  // single-phase encode (only `score` given, as the plain Solve button would) mirrors into build/minimize too
  eq(decodeFlags(encodeFlags({ build: on })), { build: on, minimize: on, score: on, path: 'warnsdorff', cps: 'gap' });
  // hex round trip, both cases, plus bare-hex and decimal input
  eq(hexToFlags(flagsToHex(v)), v); eq(flagsToHex(0), '0x0');
  eq(hexToFlags('0X' + v.toString(16).toUpperCase()), v);
  eq(hexToFlags('ff'), 0xff); eq(hexToFlags('123'), 123); // no a-f digit and no 0x prefix -> read as decimal
  eq(hexToFlags('not-hex'), null); eq(hexToFlags(''), null); eq(hexToFlags('  '), null);
  // default constant matches generateUnique()'s actual defaults (prop on, rest off, backbite/gap; minimize also freedEdge)
  eq(decodeFlags(DEFAULT_FLAGS_INT), { build: DEFAULT_GEN_FLAGS, minimize: DEFAULT_MINIMIZE_FLAGS, score: DEFAULT_GEN_FLAGS, path: 'backbite', cps: 'gap' });
});

t('generateUnique: o.flags with per-phase divergence actually reaches each phase\'s solve() calls, and o.flags overrides o.prop/o.legCollide', () => {
  // build=legCollide off, minimize=legCollide on: force it by giving minimize a tiny nodeCap that
  // only survives with legCollide's extra pruning, and confirm the run still succeeds end-to-end.
  const flags = { build: { prop: true, legCollide: false, seg: false, pocket: false, parity: false, prune2: false },
                   minimize: { prop: true, legCollide: true, seg: false, pocket: false, parity: false, prune2: false },
                   score: { prop: true, legCollide: true, seg: false, pocket: false, parity: false, prune2: false },
                   path: 'backbite', cps: 'gap' };
  const r = runSync(generateUnique(6, 6, makeRng(9), { maxWalls: 6, flags, prop: false /* must be ignored: flags wins */ }));
  eq(r.unique, true); eq(solve(r.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1);
  // o.flags absent still behaves exactly like plain o.prop/o.legCollide (no regression path)
  const withProp = runSync(generateUnique(6, 6, makeRng(9), { maxWalls: 6, prop: true, legCollide: false }));
  const withoutFlags = runSync(generateUnique(6, 6, makeRng(9), { maxWalls: 6 }));
  eq(serialize(withProp.puzzle), serialize(withoutFlags.puzzle));
});

t('minimizeWalls: options-object form matches the legacy boolean-5th-arg form exactly (back-compat)', () => {
  const rnd1 = makeRng(4), a = randomPathPuzzle(6, 6, rnd1);
  for (let i = 0; i < 8; i++) setWallId(a.walls, i, true);
  const orderA = [...Array(8).keys()];
  const b = { n: a.n, cp: a.cp.slice(), walls: a.walls.slice() };
  const rndA = makeRng(1), rndB = makeRng(1);
  const legacy = runSync(minimizeWalls(a, orderA, rndA, 5000, maxNumber(a), true));
  const opts = runSync(minimizeWalls(b, orderA, rndB, 5000, maxNumber(b), { prop: true }));
  eq(legacy, opts); eq(serialize(a), serialize(b));
});

// A puzzle that a tiny check cap leaves with many undecided walls, so the second look has work to do.
function undecidedSetup() {
  const rnd = makeRng(5), K = 9, p = randomPathPuzzle(9, K, rnd);
  const order = runSync(makeUnique(p, p.path, rnd, { nodeCap: 90000, wallBudget: null, seedFraction: 0.4, K, prop: true }));
  return { p, order, K, cap: 100 }; // 28 walls; a check cap of 100 leaves 18, 17 of them undecided (300000 leaves 14)
}

const necessaryWalls = p => allEdges(p.n).every(w => { if (!hasWallId(p.walls, w)) return true; const q = clonePuzzle(p); setWallId(q.walls, w, false); return solve(q, { limit: 2, nodeCap: 5e6, prop: true }).count >= 2; });

t('minimizeWalls: reports the walls kept only because a check hit its cap (uncertain); a generous cap leaves none', () => {
  const { p: p0, order, K, cap } = undecidedSetup();
  const small = clonePuzzle(p0), big = clonePuzzle(p0);
  const a = runSync(minimizeWalls(small, order, makeRng(3), cap, K, { prop: true, freedEdge: true }));
  ok(a.uncertain.length >= 2, 'the setup must leave undecided walls');
  ok(a.uncertain.every(w => hasWallId(small.walls, w)), 'an undecided wall is still a wall');
  ok(a.uncertain.length <= a.kept);
  const b = runSync(minimizeWalls(big, order, makeRng(3), 300000, K, { prop: true, freedEdge: true }));
  eq(b.uncertain, []); ok(b.kept < a.kept, 'the big cap removes more');
  ok(necessaryWalls(big), 'with no undecided wall left, every kept wall is necessary');
});

t('refineWalls: only undecided walls can go; the puzzle stays unique; budget is a node count that is respected', () => {
  const { p: p0, order, K, cap } = undecidedSetup();
  const p = clonePuzzle(p0);
  const a = runSync(minimizeWalls(p, order, makeRng(3), cap, K, { prop: true, freedEdge: true }));
  const before = new Set(allEdges(p.n).filter(w => hasWallId(p.walls, w)));
  const events = [];
  const r = runSync(refineWalls(p, a.uncertain, makeRng(4), { caps: [600, 6000, 300000], prop: true, K, walls: a.kept }), e => events.push(e));
  ok(r.removed > 0 && r.removed <= a.uncertain.length);
  eq(r.kept, a.kept - r.removed); eq(wallCount(p), r.kept);
  for (const w of allEdges(p.n)) if (before.has(w) && !hasWallId(p.walls, w)) ok(a.uncertain.includes(w), 'removed a wall that was not undecided');
  const u = solve(p, { limit: 2, nodeCap: 5e6, prop: true }); eq([u.count, u.exceeded], [1, false]);
  eq(r.left, []); ok(necessaryWalls(p));
  ok(events.length > 0 && events.every(e => e.frac === null && e.K === K && Number.isInteger(e.walls) && e.nodes <= r.nodes), 'events share the minimizeWalls shape');
  eq(events[events.length - 1].walls, r.kept);
  // a tiny budget stops early and leaves the rest undecided, never spending (much) more than the budget
  const q = clonePuzzle(p0); runSync(minimizeWalls(q, order, makeRng(3), cap, K, { prop: true, freedEdge: true }));
  const budget = 500, s = runSync(refineWalls(q, a.uncertain, makeRng(4), { caps: [600, 6000, 300000], prop: true, budget }));
  ok(s.left.length > 0 && s.nodes <= budget + a.uncertain.length, `nodes ${s.nodes}`);
  const w = solve(q, { limit: 2, nodeCap: 5e6, prop: true }); eq(w.count, 1);
  // no caps or no budget: nothing happens
  eq(runSync(refineWalls(q, a.uncertain, makeRng(4), { caps: [], prop: true })).removed, 0);
  eq(runSync(refineWalls(q, a.uncertain, makeRng(4), { caps: [6000], budget: 0, prop: true })).removed, 0);
});

t('minimizeFully: no budget = minimizeWalls exactly; with a budget it reaches a puzzle whose kept walls are all necessary; maxKept skips pointless second looks', () => {
  const { p: p0, order, K, cap } = undecidedSetup();
  const o = { prop: true, freedEdge: true };
  const a = clonePuzzle(p0), b = clonePuzzle(p0);
  const ra = runSync(minimizeWalls(a, order, makeRng(3), cap, K, o)), rb = runSync(minimizeFully(b, order, makeRng(3), cap, K, o));
  eq(ra, rb); eq(serialize(a), serialize(b));
  // budget, with events of both phases
  const c = clonePuzzle(p0), seen = new Set();
  const rc = runSync(minimizeFully(c, order, makeRng(3), cap, K, { ...o, refineBudget: 1e8, refineCapX: [10, 100, 5000] }), e => seen.add(e.nodes == null ? 'first' : 'second'));
  eq([...seen].sort(), ['first', 'second']);
  eq(rc.uncertain, []); eq(rc.removed, ra.removed + (ra.kept - rc.kept)); eq(wallCount(c), rc.kept); ok(rc.kept < ra.kept);
  const u = solve(c, { limit: 2, nodeCap: 5e6, prop: true }); eq([u.count, u.exceeded], [1, false]); ok(necessaryWalls(c));
  // maxKept: even removing every undecided wall would leave more than this, so no second look
  const d = clonePuzzle(p0);
  eq(runSync(minimizeFully(d, order, makeRng(3), cap, K, { ...o, refineBudget: 1e8, maxKept: 0 })), ra); eq(serialize(d), serialize(a));
  // the default per-pass caps widen from pass to pass
  ok(REFINE_CAP_X.every((x, i) => x > (REFINE_CAP_X[i - 1] ?? 1)), 'ascending multiples');
});

t.slow('generate(): the deeper look at undecided walls never adds walls to the winner and keeps it valid and unique with every kept wall needed', () => {
  for (const [n, seed] of [[9, 3], [10, 1]]) {
    const off = runSync(generate(n, seed, { refineNodes: 0 })), on = runSync(generate(n, seed));
    const walls = p => wallCount(p.walls ? p : p);
    ok(validate(on).ok);
    const r = solve(on, { limit: 2, nodeCap: 5e6, prop: true }); eq([r.count, r.exceeded], [1, false]);
    ok(wallCount(on) <= wallCount(off), `n=${n}: ${wallCount(on)} > ${wallCount(off)}`);
    ok(necessaryWalls(on), `n=${n} seed=${seed}: a kept wall is unnecessary`);
    // the same candidate wins in both runs, so the second look only takes walls out of it
    for (const w of allEdges(n)) if (hasWallId(on.walls, w)) ok(hasWallId(off.walls, w), 'refined puzzle has a wall the unrefined one lacks');
  }
});

t('flags: the freedEdge bit (minimize phase) round-trips, and every integer made before it still decodes to the same objects', () => {
  // compat pin: the play app's seed tag stays as it is in the links and records made with it
  eq(flagsToHex(PLAY_FLAGS_INT), '0x18101');
  eq(decodeFlags(PLAY_FLAGS_INT).minimize.freedEdge, true);
  eq(decodeFlags(DEFAULT_FLAGS_INT).minimize.freedEdge, true);
  const before = 0x1010101; // the design app's default before the bit existed: still the plain two-solution check
  eq(decodeFlags(before), { build: DEFAULT_GEN_FLAGS, minimize: DEFAULT_GEN_FLAGS, score: DEFAULT_GEN_FLAGS, path: 'backbite', cps: 'gap' });
  eq(Object.keys(decodeFlags(before).minimize).includes('freedEdge'), false);
  eq(before | 0x8000, DEFAULT_FLAGS_INT);
  eq(decodeFlags(encodeFlags(decodeFlags(DEFAULT_FLAGS_INT))), decodeFlags(DEFAULT_FLAGS_INT));
});

t('generateUnique: without o.flags it behaves exactly like the default flags (freedEdge in minimize), and o.freedEdge === false like the old flags', () => {
  const run = o => { const r = runSync(generateUnique(7, 7, makeRng(9), { maxWalls: 10, tries: 4, ...o })); return [serialize(r.puzzle), r.walls, r.counts.total]; };
  eq(run({}), run({ flags: decodeFlags(DEFAULT_FLAGS_INT) }));
  eq(run({ freedEdge: false }), run({ flags: decodeFlags(0x1010101) }));
});

t('freedEdge (default in generate() since ALGO_VERSION 6): generate() and generateUnique() give valid, unique puzzles where every kept wall is needed', () => {
  const needed = p => { for (const w of allEdges(p.n)) { if (!hasWallId(p.walls, w)) continue; const q = clonePuzzle(p); setWallId(q.walls, w, false); ok(solve(q, { limit: 2, nodeCap: 2e6, prop: true }).count >= 2, 'a kept wall is unnecessary'); } };
  for (const [n, seed] of [[6, 1], [6, 2], [7, 1], [7, 2]]) {
    const p = runSync(generate(n, seed, { freedEdge: true }));
    ok(validate(p).ok); const r = solve(p, { limit: 2, nodeCap: 2e6, prop: true }); eq([r.count, r.exceeded], [1, false]); needed(p);
  }
  // the ALGO_VERSION 5 check (freedEdge: false) still gives valid unique puzzles
  const v5 = runSync(generate(6, 1, { freedEdge: false })); ok(validate(v5).ok); eq(solve(v5, { limit: 2, nodeCap: 2e6, prop: true }).count, 1);
  // generateUnique's default and the default flags both use it
  for (const o of [{}, { flags: decodeFlags(DEFAULT_FLAGS_INT) }]) { const u = runSync(generateUnique(7, 7, makeRng(5), { maxWalls: 8, ...o })); eq(u.unique, true); needed(u.puzzle); }
});

t('generate(): the dense last-resort path (densest K, minimized) is unique and every kept wall is needed with freedEdge on and off', () => {
  // the same calls generate() makes when no candidate was built: tryGenerate at the largest K, then minimizeWalls
  for (const freedEdge of [true, false]) for (const [n, seed] of [[6, 1], [7, 2], [8, 3]]) {
    const rnd = makeRng(seed), cells = n * n, Kmax = Math.max(5, Math.round(cells / 4)), cap = Math.round(Math.max(30000, 200 * cells) * PROP_CAP_X);
    let dense = null; // an attempt can fail (Warnsdorff dead end): retry like generate() does
    for (let attempt = 0; attempt < 30 && !dense; attempt++) dense = runSync(tryGenerate(n, Kmax, rnd, Math.max(300000, 20 * cap), cells, 0, { prop: true }));
    ok(dense && dense.order, 'no dense puzzle');
    runSync(minimizeWalls(dense, dense.order, rnd, cap, Kmax, { prop: true, freedEdge }));
    const r = solve(dense, { limit: 2, nodeCap: 2e6, prop: true }); eq([r.count, r.exceeded], [1, false], `n=${n} freedEdge=${freedEdge}`);
    for (const w of allEdges(n)) { if (!hasWallId(dense.walls, w)) continue; const q = clonePuzzle(dense); setWallId(q.walls, w, false); ok(solve(q, { limit: 2, nodeCap: 2e6, prop: true }).count >= 2, 'a kept wall is unnecessary'); }
  }
});

t('minimizeWalls: bound aborts only a run that ends with >= bound walls; any other run equals the unbounded one', () => {
  const rnd = makeRng(11), p0 = randomPathPuzzle(7, 7, rnd);
  const order = runSync(makeUnique(p0, p0.path, rnd, { nodeCap: 9000, wallBudget: null, seedFraction: 0.4, K: 7, prop: true }));
  ok(order && order.length > 4);
  const run = bound => { const p = clonePuzzle(p0); const r = runSync(minimizeWalls(p, order, makeRng(3), 4500, 7, { prop: true, bound })); return { r, text: serialize(p) }; };
  const full = run(undefined), kept = full.r.kept;
  ok(kept >= 1);
  eq(run(kept).r, { removed: 0, kept: Infinity, aborted: true });
  eq(run(kept + 1), full); eq(run(Infinity), full);
});

registerAsyncTests();
