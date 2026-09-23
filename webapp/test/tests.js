// Runs in the browser (open test/index.html via a local server) and in Node (node test/tests.js). No dependencies.
import { makePuzzle, validate, maxNumber, ALGO_VERSION, endCell } from '../src/core/model.js';
import { edgeId, edgeCells, allEdges, edgeToKey, keyToEdge, setWallId, wallCount } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { makeRng, dailySeed, hashStr, shuffle } from '../src/core/rng.js';
import { newStat, updateStat, statSummary } from '../src/core/stats.js';
import { solve } from '../src/core/solver/solve.js';
import { isSolved, step } from '../src/core/rules.js';
import { boardConnectivity } from '../src/core/connectivity.js';
import { buildNeighbors, makeNoDeadEnd } from '../src/core/solver/prune.js';
import { generate, generateUnique, randomPathPuzzle, pickK, PLAY_SIZES } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { runSync } from '../src/core/run.js';
import { createHoldReveal } from '../src/ui/hold-reveal.js';
import { createDaily, utcDayNumber } from '../src/features/daily.js';
import { createStore } from '../src/features/stats-store.js';
import { GOLDEN } from './golden.js';

// ---- mini harness ----
const out = []; let pass = 0, fail = 0;
const t = (name, fn) => { const t0 = Date.now(); try { fn(); pass++; out.push(`ok    ${name} (${Date.now() - t0}ms)`); } catch (e) { fail++; out.push(`FAIL  ${name}: ${e.message}`); } };
const eq = (a, b, m = '') => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m} expected ${B} got ${A}`); };
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

// (size, seed) cases for the prop:false (v1-style) search: only checked structurally, since its output is not pinned any more.
const V1_CASES = [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [7, 1], [7, 2], [7, 3], [9, 1]];

const randPuzzle = (seed, n, K, wallFrac) => {
  const rnd = makeRng(seed), p = makePuzzle(n), T = n * n, cells = shuffle([...Array(T).keys()], rnd).slice(0, K);
  cells.forEach((c, i) => { p.cp[c] = i + 1; });
  allEdges(n).forEach(e => { if (rnd() < wallFrac) setWallId(p.walls, e, true); });
  return p;
};
// Exhaustive reference: enumerate every Hamiltonian path that obeys the rules.
function brute(p) {
  const n = p.n, T = n * n, K = Math.max(...p.cp), start = p.cp.indexOf(1), end = p.cp.indexOf(K), vis = new Uint8Array(T); let count = 0;
  const nbr = i => { const r = (i / n) | 0, c = i % n, o = []; if (c < n - 1) o.push(i + 1); if (c > 0) o.push(i - 1); if (r < n - 1) o.push(i + n); if (r > 0) o.push(i - n); return o; };
  const wall = (a, b) => p.walls[Math.min(a, b)] & (Math.abs(a - b) === 1 ? 1 : 2);
  const go = (c, k, need) => {
    vis[c] = 1;
    let nd = need; if (p.cp[c]) { if (p.cp[c] !== nd) { vis[c] = 0; return; } nd++; }
    if (k === T) { if (c === end && nd === K + 1) count++; vis[c] = 0; return; }
    for (const v of nbr(c)) if (!vis[v] && !wall(c, v)) go(v, k + 1, nd);
    vis[c] = 0;
  };
  if (start >= 0) go(start, 1, 1);
  return count;
}

t('edges: id <-> cells <-> key round trip', () => {
  for (const n of [2, 5, 16]) { const es = allEdges(n); eq(es.length, 2 * n * (n - 1)); for (const e of es) { const [a, b] = edgeCells(n, e); eq(edgeId(n, a, b), e); eq(edgeId(n, b, a), e); eq(keyToEdge(n, edgeToKey(n, e)), e); } }
});
t('format: serialize/parse round trip, size 2..16, errors', () => {
  for (let s = 1; s <= 20; s++) { const p = randPuzzle(s, 2 + (s % 15), 3, 0.3); eq(serialize(parse(serialize(p))), serialize(p)); }
  eq(parse('size 16').n, 16);
  for (const bad of ['size 17', 'size 1', 'walls V,0,0', 'size 3\nwalls V,0,2', 'size 3\nwalls H,2,0', 'size 3\ncheckpoints 3,0=1', 'size 3\nfoo']) { let threw = false; try { parse(bad); } catch (e) { threw = true; } ok(threw, 'should reject: ' + bad); }
});
t('format: path line — round trip, cell order, and rejects disconnected / walled / repeated cells', () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[8] = 9;
  const withPath = serialize(p, { path: [0, 1, 2, 5, 4, 3, 6, 7, 8] });
  ok(withPath.includes('path 0,0 0,1 0,2 1,2 1,1 1,0 2,0 2,1 2,2'), 'path line present in expected r,c order');
  const back = parse(withPath);
  eq(back.path, [0, 1, 2, 5, 4, 3, 6, 7, 8]);
  eq(serialize(back, { path: back.path }), withPath, 'round trip with path is stable');
  eq(serialize(p).includes('path'), false, 'no path option -> no path line');
  eq(parse(serialize(p)).path, undefined, 'no path line -> no .path field');

  for (const bad of ['size 3\ncheckpoints 0,0=1\npath 0,0 2,2', 'size 3\npath 5,5']) {
    let threw = false; try { parse(bad); } catch (e) { threw = true; } ok(threw, 'should reject: ' + bad);
  }
  const walled = makePuzzle(3); setWallId(walled.walls, edgeId(3, 0, 1), true);
  let threw = false; try { parse(serialize(walled, { path: [] }) + '\npath 0,0 0,1'); } catch (e) { threw = true; } ok(threw, 'should reject path crossing a wall');
  threw = false; try { parse('size 3\npath 0,0 0,1 0,0'); } catch (e) { threw = true; } ok(threw, 'should reject repeated cell');
});
t('rng: deterministic; dailySeed matches legacy values', () => {
  const a = makeRng(42), b = makeRng(42); for (let i = 0; i < 5; i++) eq(a(), b());
  eq(dailySeed(20350, 5, 0), 181660932); eq(dailySeed(20350, 9, 3), 2782780257);
});
t('stats: Welford == naive', () => {
  const xs = [3.2, 5.1, 4.4, 9.9, 1.2, 7.7], st = newStat(); xs.forEach(x => updateStat(st, x));
  const m = xs.reduce((a, b) => a + b) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)), s = statSummary(st);
  ok(Math.abs(s.mean - m) < 1e-9 && Math.abs(s.sd - sd) < 1e-9);
});
t('solver: matches brute force (n=3,4; random walls/checkpoints)', () => {
  let cmp = 0;
  for (let s = 1; s <= 120; s++) {
    const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)), r = solve(p, { limit: 1e9, nodeCap: 1e7 });
    ok(!r.exceeded); eq(r.count, brute(p), `case ${s}`); cmp++;
  } ok(cmp === 120);
});
t('solver: prune2 keeps counts, nodes <= baseline', () => {
  for (let s = 1; s <= 40; s++) { const p = randPuzzle(s, 5, 3 + (s % 4), 0.2), a = solve(p, { limit: 1e9, nodeCap: 5e6 }), b = solve(p, { limit: 1e9, nodeCap: 5e6, prune2: true }); eq(b.count, a.count, `case ${s}`); ok(b.nodes <= a.nodes); }
});
t('solver: prop == baseline (count, paths, DFS order), nodes <= baseline, matches brute force', () => {
  let cmp = 0;
  for (let s = 1; s <= 120; s++) { const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)); eq(solve(p, { limit: 1e9, nodeCap: 1e7, prop: true }).count, brute(p), `brute ${s}`); }
  for (let s = 1; s <= 150; s++) {
    const n = 3 + (s % 4), p = randPuzzle(s, n, 2 + (s % 5), 0.05 * (s % 9));
    for (const extra of [{}, { prune2: true }]) for (const limit of [2, 1e9]) {
      const a = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true }), b = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true, prop: true });
      ok(!a.exceeded && !b.exceeded); eq(b.count, a.count, `count ${s}`); eq(b.paths, a.paths, `paths ${s}`); ok(b.nodes <= a.nodes, `nodes ${s}`); cmp++;
    }
  } ok(cmp === 600);
});
t('rules: isSolved, step (default / truncate / strictOrder)', () => {
  const p = makePuzzle(3); [0, 4, 8].forEach((c, i) => { p.cp[c] = i + 1; });
  const sol = [0, 1, 2, 5, 4, 3, 6, 7, 8]; eq(isSolved(p, sol), true); eq(isSolved(p, [...sol].reverse()), false, 'wrong start/end'); eq(isSolved(p, sol.slice(0, 8)), false, 'incomplete');
  const path = []; eq(step(p, path, 1), null); eq(step(p, path, 0), 'push'); eq(step(p, path, 1), 'push'); eq(step(p, path, 0), 'pop');
  eq(step(p, path, 4), null, 'not adjacent'); eq(step(p, path, 1), 'push'); eq(step(p, path, 2), 'push'); eq(step(p, path, 0), null, 'no truncate by default');
  eq(step(p, path, 0, { truncate: true }), 'trunc'); eq(path, [0]);
  const S = { strictOrder: true }, q = [0, 1, 2, 5];
  eq(step(p, q, 8, S), null, 'checkpoint 3 before 2'); eq(step(p, q, 4, S), 'push'); eq(step(p, q, 7, S), 'push'); eq(step(p, q, 8, S), 'push'); eq(step(p, q, 5, S), null);
});
t('connectivity: reachable/deadEnd/unreachable on open board, walled split, and forced dead end', () => {
  // 3x3, no walls: from cell 0, every other cell is reachable and nothing is a forced dead end yet.
  const open = makePuzzle(3); open.cp[0] = 1; open.cp[8] = 9;
  let r = boardConnectivity(open, [0]);
  eq(r.connOk, true);
  eq([...r.reachable].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  eq(r.deadEnd.size, 0);
  eq(r.unreachable.size, 0);

  // Wall off cell 8 (end) from both its neighbours (5 and 7): the board splits, connOk must go false
  // and the isolated end cell is correctly excluded (still "unreachable", not a dead end, since it's cut off).
  const split = makePuzzle(3); split.cp[0] = 1; split.cp[8] = 9;
  setWallId(split.walls, edgeId(3, 8, 7), true);
  setWallId(split.walls, edgeId(3, 8, 5), true);
  r = boardConnectivity(split, [0]);
  eq(r.connOk, false);
  eq(r.unreachable.has(8), true);
  eq(r.reachable.has(8), false);

  // Wall a middle cell (4) down to one open neighbour only: with head at 0 and 1 visited, cell 4's only
  // free neighbour left is 5, so it's a forced dead end (must be entered last from that side).
  const dead = makePuzzle(3); dead.cp[0] = 1; dead.cp[8] = 9;
  setWallId(dead.walls, edgeId(3, 4, 1), true);
  setWallId(dead.walls, edgeId(3, 4, 3), true);
  setWallId(dead.walls, edgeId(3, 4, 7), true);
  r = boardConnectivity(dead, [0, 1]);
  eq(r.deadEnd.has(4), true, 'cell 4 has only neighbour 5 left, must be a forced dead end');

  // The head cell itself and already-visited cells are never reported.
  eq(r.reachable.has(0), false);
  eq(r.reachable.has(1), false);
});
t('solver prune: overlay dead-end flag and solver noDeadEnd agree (random puzzles/paths)', () => {
  // boardConnectivity's isDeadEnd and the solver's noDeadEnd both reduce to the same freeNeighbors
  // rule (see solver/prune.js) — pin that they actually agree, not just that each looks right alone.
  // noDeadEnd(head) is all-or-nothing over every neighbour of head, so the equivalent per-call
  // assertion is: it fails iff at least one head-adjacent, non-end, reachable cell is flagged dead
  // by the overlay (the free===0 branch is unreachable by adjacency symmetry — see write-up).
  const rnd = makeRng(20260923);
  for (let trial = 0; trial < 40; trial++) {
    const n = 3 + (trial % 4);
    const p = randomPathPuzzle(n, 2 + (trial % (n * n - 1)), rnd);
    const cut = 1 + Math.floor(rnd() * (p.path.length - 1));
    const path = p.path.slice(0, cut);
    const head = path[path.length - 1];
    const r = boardConnectivity(p, path);
    const { nb, T } = buildNeighbors(p);
    const vis = new Uint8Array(T);
    for (const c of path) vis[c] = 1;
    const noDeadEnd = makeNoDeadEnd(nb, vis, endCell(p));
    let headAdjacentDead = false;
    for (let d = 0; d < 4; d++) { const u = nb[head * 4 + d]; if (u >= 0 && r.deadEnd.has(u)) headAdjacentDead = true; }
    eq(noDeadEnd(head), !headAdjacentDead, `trial ${trial}: noDeadEnd(head) must disagree with the overlay only never`);
  }
});
t('generate: ALGO_VERSION 4 golden puzzles cover every play size below 16 and are valid and unique', () => {
  eq(ALGO_VERSION, 4);
  for (const n of PLAY_SIZES.filter(size => size < 16)) {
    ok(GOLDEN.some(([size]) => size === n), `no golden puzzle for play size ${n}`);
  }
  for (const [n, seed, hash] of GOLDEN) {
    const p = runSync(generate(n, seed));
    eq(hashStr(serialize(p)), hash, `v4 n=${n} seed=${seed}`);
    eq(validate(p).ok, true, `valid n=${n} seed=${seed}`);
    eq(isSolved(p, p.path), true, `anchor path n=${n} seed=${seed}`);
    eq(solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count, 1, `unique n=${n} seed=${seed}`);
  }
});
t('generate: prop:false (v1-style search) still yields unique valid puzzles', () => {
  for (const [n, seed] of V1_CASES) {
    const p = runSync(generate(n, seed, { prop: false }));
    eq(validate(p).ok, true, `v1 n=${n} seed=${seed}`);
    eq(solve(p, { limit: 2, nodeCap: 2e6 }).count, 1, `v1 unique n=${n} seed=${seed}`);
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
t('hold-reveal: shows while "v" is held; ignores key repeat, modifiers and text fields; hides on cancel', () => {
  const seen = [];
  const reveal = createHoldReveal(visible => seen.push(visible));
  const press = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });

  reveal.keydown(press('v'));
  reveal.keydown(press('v'));                               // key repeat reports once
  reveal.keyup(press('v'));
  reveal.keydown(press('V'));
  reveal.cancel();                                          // window blur / tab hidden while held
  reveal.cancel();                                          // repeated cancel reports once
  reveal.keydown(press('v', { ctrlKey: true }));            // paste shortcut is not a reveal
  reveal.keydown(press('v', { target: { tagName: 'INPUT' } }));
  reveal.keydown(press('v', { target: { tagName: 'DIV', isContentEditable: true } }));
  reveal.keydown(press('x'));
  eq(seen, [true, false, true, false]);
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

// ---- per-size daily counters & today/total stats (fake storage + fake clock) ----
const fakeStorage = () => { const m = new Map(); return { async get(k) { return m.has(k) ? { value: m.get(k) } : null; }, async set(k, v) { m.set(k, v); } }; };
const atDay = d => () => new Date(Date.UTC(2026, 8, d, 12));
const pending = [];
const ta = (name, fn) => pending.push([name, fn]); // async tests, run after the sync ones

ta('daily: sequence per size is independent of what was played in other sizes', async () => {
  const A = createDaily(fakeStorage(), atDay(19)), B = createDaily(fakeStorage(), atDay(19)), seedsA = [], seedsB = [];
  for (const step of [['open', 5], ['open', 7], ['skip', 5], ['skip', 7], ['skip', 5]]) { const g = await A[step[0]](step[1]); if (step[1] === 5) seedsA.push(g.seed); }
  for (const step of [['open', 5], ['skip', 5], ['skip', 5]]) seedsB.push((await B[step[0]](step[1])).seed);
  eq(seedsA, seedsB); eq(new Set(seedsA).size, 3);
});
ta('daily: Play local advances only after the current game was solved; New puzzle always advances', async () => {
  const D = createDaily(fakeStorage(), atDay(19));
  const g1 = await D.open(5), again = await D.open(5); eq(again.index, g1.index, 'unsolved -> same game');
  await D.markSolved(5, g1.index); eq((await D.peek(5)).index, 1, 'peek shows next'); eq((await D.open(5)).index, 1, 'solved -> next game');
  eq((await D.skip(5)).index, 2); eq((await D.open(7)).index, 0, 'other size untouched');
});
ta('daily: counter resets on a new UTC day; seeds match dailySeed', async () => {
  const st = fakeStorage(), d19 = createDaily(st, atDay(19)), d20 = createDaily(st, atDay(20));
  await d19.skip(5); await d19.skip(5); eq((await d19.peek(5)).index, 2); eq((await d20.peek(5)).index, 0);
  eq((await d20.peek(5)).seed, dailySeed(utcDayNumber(atDay(20)()), 5, 0, ALGO_VERSION));
});
ta('stats-store: today resets each day, total accumulates, both persist', async () => {
  const st = fakeStorage(), S = createStore(st, [5]); await S.hydrate('20260919');
  await S.recordSolve(5, 100, 10); await S.recordSolve(5, 100, 20); await S.recordSolve(5, 101, 30);
  eq([S.today(5, 100).n, S.today(5, 101).n, S.total(5).n], [0, 1, 3]); eq(S.today(5, 101).recent, [30]);
  const S2 = createStore(st, [5]); await S2.hydrate('20260919'); eq([S2.today(5, 101).n, S2.total(5).n], [1, 3]);
});

for (const [name, fn] of pending) { const t0 = Date.now(); try { await fn(); pass++; out.push(`ok    ${name} (${Date.now() - t0}ms)`); } catch (e) { fail++; out.push(`FAIL  ${name}: ${e.message}`); } }
const text = out.join('\n') + `\n\n${pass} passed, ${fail} failed`;
if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; } else { console.log(text); if (fail) process.exit(1); }
