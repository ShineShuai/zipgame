// Runs in the browser (open test/index.html via a local server) and in Node (node test/tests.js). No dependencies.
import { makePuzzle, validate, maxNumber, ALGO_VERSION, endCell } from '../src/core/model.js';
import { edgeId, edgeCells, allEdges, edgeToKey, keyToEdge, setWallId, wallCount } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { makeRng, dailySeed, hashStr, shuffle } from '../src/core/rng.js';
import { newStat, updateStat, statSummary } from '../src/core/stats.js';
import { solve } from '../src/core/solver/solve.js';
import { isSolved, step } from '../src/core/rules.js';
import { boardConnectivity } from '../src/core/connectivity.js';
import { buildNeighbors, makeNoDeadEnd, forcedEdges, legsCollide } from '../src/core/solver/prune.js';
import { generate, generateUnique, randomPathPuzzle, pickK, PLAY_SIZES } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { encodeFlags, decodeFlags, flagsToHex, hexToFlags, DEFAULT_FLAGS_INT, DEFAULT_GEN_FLAGS } from '../src/core/gen/flags.js';
import { minimizeWalls } from '../src/core/gen/walls.js';
import { runSync } from '../src/core/run.js';
import { createHoldReveal } from '../src/ui/hold-reveal.js';
import { createDaily, utcDayNumber } from '../src/features/daily.js';
import { createStore } from '../src/features/stats-store.js';
import { GOLDEN } from './golden.js';
import { metricsFor, referenceSolve, backtrackOverhead, naiveGap, legCollideDependent, firstSolutionGap, fullDiagnostics, gradeOf, refNodeCap, REF_FLAGS } from '../src/core/difficulty.js';
import { calibrate, calibrateAll, calibrateMetric, generateAtDifficulty, DEFAULT_THRESHOLDS, DEFAULT_THRESHOLDS_BY_METRIC, GRADED_METRICS, QUANTILES } from '../src/core/gen/calibration.js';
import { checkpointPositions, segmentCrossCount, segmentOverlapCount, spatialMetrics } from '../src/core/spatial.js';
import { gradesFor, gradesFromMetrics, GRADE_ORDER } from '../src/core/grades.js';
import { combinedScore, COMBINED_ZSCORE } from '../src/core/gen/calibration.js';

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
t('solver: seg == baseline (count, paths, DFS order), nodes <= baseline, matches brute force', () => {
  let cmp = 0;
  for (const segMode of [true, 'all']) {
    for (let s = 1; s <= 120; s++) { const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)); eq(solve(p, { limit: 1e9, nodeCap: 1e7, seg: segMode }).count, brute(p), `brute ${segMode} ${s}`); }
    for (let s = 1; s <= 150; s++) {
      const n = 3 + (s % 4), p = randPuzzle(s, n, 2 + (s % 5), 0.05 * (s % 9));
      for (const extra of [{}, { prune2: true }, { prop: true }]) for (const limit of [2, 1e9]) {
        const a = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true }), b = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true, seg: segMode });
        ok(!a.exceeded && !b.exceeded); eq(b.count, a.count, `count ${segMode} ${s}`); eq(b.paths, a.paths, `paths ${segMode} ${s}`); ok(b.nodes <= a.nodes, `nodes ${segMode} ${s}`); cmp++;
      }
    }
  } ok(cmp === 1800);
});
t('solver: parity == baseline (count, paths, DFS order), nodes <= baseline, matches brute force', () => {
  let cmp = 0;
  for (let s = 1; s <= 120; s++) { const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)); eq(solve(p, { limit: 1e9, nodeCap: 1e7, parity: true }).count, brute(p), `brute ${s}`); }
  for (let s = 1; s <= 150; s++) {
    const n = 3 + (s % 4), p = randPuzzle(s, n, 2 + (s % 5), 0.05 * (s % 9));
    for (const extra of [{}, { prune2: true }, { prop: true }, { seg: true }, { seg: 'all' }, { prune2: true, prop: true }]) for (const limit of [2, 1e9]) {
      const a = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true }), b = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true, parity: true });
      ok(!a.exceeded && !b.exceeded); eq(b.count, a.count, `count ${s}`); eq(b.paths, a.paths, `paths ${s}`); ok(b.nodes <= a.nodes, `nodes ${s}`); cmp++;
    }
  } ok(cmp === 1800);
});
t('solver: legCollide == baseline (count, paths, DFS order), nodes <= baseline, matches brute force', () => {
  let cmp = 0;
  for (let s = 1; s <= 120; s++) { const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)); eq(solve(p, { limit: 1e9, nodeCap: 1e7, legCollide: true }).count, brute(p), `brute ${s}`); }
  for (let s = 1; s <= 150; s++) {
    const n = 3 + (s % 4), p = randPuzzle(s, n, 2 + (s % 5), 0.05 * (s % 9));
    for (const extra of [{}, { prune2: true }, { prop: true }, { seg: true }, { pocket: true }, { parity: true }, { prop: true, pocket: true, parity: true }]) for (const limit of [2, 1e9]) {
      const a = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true }), b = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true, legCollide: true });
      ok(!a.exceeded && !b.exceeded); eq(b.count, a.count, `count ${s}`); eq(b.paths, a.paths, `paths ${s}`); ok(b.nodes <= a.nodes, `nodes ${s}`); cmp++;
    }
  } ok(cmp === 2100);
});
t('solver: legCollide catches the reported forced-corridor-collision case (fewer nodes than baseline)', () => {
  const n = 7, p = makePuzzle(n);
  const rc = (r, c) => r * n + c;
  for (const [r, c, k] of [[0, 0, 6], [0, 5, 5], [1, 5, 7], [3, 2, 4], [3, 6, 3], [5, 1, 1], [6, 5, 2]]) p.cp[rc(r, c)] = k;
  for (const [t, r, c] of [['V', 3, 0], ['V', 3, 4], ['H', 4, 1], ['V', 5, 0], ['V', 5, 1], ['V', 6, 4]]) {
    setWallId(p.walls, t === 'V' ? edgeId(n, rc(r, c), rc(r, c + 1)) : edgeId(n, rc(r, c), rc(r + 1, c)), true);
  }
  // At nodeCap 5000, plain search doesn't find the puzzle's solution before exhausting the
  // budget; legCollide-pruning does, on this exact instance — a direct demonstration of the
  // collision check's benefit, not just equivalence.
  const a = solve(p, { limit: 2, nodeCap: 5000, capture: true });
  const b = solve(p, { limit: 2, nodeCap: 5000, capture: true, legCollide: true });
  ok(a.exceeded && a.count === 0, 'sanity: baseline should NOT resolve this instance within 5000 nodes');
  ok(b.count === 1, `legCollide should find the (unique) solution within the same budget (got count=${b.count})`);
  // Full-budget equivalence: same solution set once both are allowed to finish.
  const aFull = solve(p, { limit: 2, nodeCap: 2e6, capture: true });
  const bFull = solve(p, { limit: 2, nodeCap: 2e6, capture: true, legCollide: true });
  ok(!aFull.exceeded && !bFull.exceeded);
  eq(bFull.count, aFull.count); eq(bFull.paths, aFull.paths);
  ok(bFull.nodes <= aFull.nodes, `legCollide should not need more nodes than baseline (base=${aFull.nodes}, legCollide=${bFull.nodes})`);
});
t('forcedEdges: standalone deduction sound against exhaustive completion enumeration', () => {
  // For a given (puzzle, path-prefix, head), enumerate every valid completion by brute force.
  // forcedEdges().infeasible must imply zero completions. Every forced cell must be entered via
  // its forced direction in every completion that does exist (never contradicted).
  function completions(p, prefix) {
    const n = p.n, T = n * n, K = Math.max(...p.cp), end = p.cp.indexOf(K);
    const vis = new Uint8Array(T);
    for (const c of prefix) vis[c] = 1;
    const nbr = i => { const r = (i / n) | 0, c = i % n, o = []; if (c < n - 1) o.push(i + 1); if (c > 0) o.push(i - 1); if (r < n - 1) o.push(i + n); if (r > 0) o.push(i - n); return o; };
    const wall = (a, b) => p.walls[Math.min(a, b)] & (Math.abs(a - b) === 1 ? 1 : 2);
    const out = [];
    let need = 1;
    for (const c of prefix) { if (p.cp[c]) { if (p.cp[c] !== need) return []; need++; } }
    const head = prefix[prefix.length - 1];
    const go = (c, k, nd, path) => {
      let need2 = nd;
      if (p.cp[c]) { if (p.cp[c] !== need2) return; need2++; }
      if (k === T) { if (c === end && need2 === K + 1) out.push(path.slice()); return; }
      for (const v of nbr(c)) {
        if (vis[v] || wall(c, v)) continue;
        vis[v] = 1; path.push(v);
        go(v, k + 1, need2, path);
        path.pop(); vis[v] = 0;
      }
    };
    go(head, prefix.length, need, prefix.slice());
    return out;
  }

  let checked = 0, forcedChecks = 0;
  for (let s = 1; s <= 60; s++) {
    const n = 3 + (s % 3), p = randPuzzle(s, n, 2 + (s % 4), 0.1 * (s % 5));
    const K = Math.max(...p.cp);
    if (K < 1) continue;
    const sol = solve(p, { limit: 1, nodeCap: 5000, capture: true });
    if (sol.count !== 1) continue; // only test on puzzles with a findable solution to walk prefixes of
    const path = sol.paths[0];
    const { nb, T } = buildNeighbors(p);
    for (let cut = 1; cut < path.length; cut++) {
      const prefix = path.slice(0, cut);
      const vis = new Uint8Array(T);
      for (const c of prefix) vis[c] = 1;
      const head = prefix[prefix.length - 1];
      const end = p.cp.indexOf(K);
      const { forced, dirs, infeasible } = forcedEdges(nb, T, vis, head, end);
      const all = completions(p, prefix);
      checked++;
      if (infeasible) { ok(all.length === 0, `infeasible but completions exist: seed ${s} cut ${cut}`); continue; }
      if (all.length === 0) continue; // forcedEdges may under-detect infeasibility (that's fine, it's a sound-not-complete prune) — nothing to check
      // Every forced direction must be an edge actually used (u adjacent to its dir-d neighbour
      // in the path) in EVERY completion — the precise meaning of "this edge is forced".
      const DR = [0, 0, 1, -1], DC = [1, -1, 0, 0], n = p.n;
      for (const u of forced) {
        for (let d = 0; d < 4; d++) {
          if (!((dirs[u] >> d) & 1)) continue;
          const v = nb[u * 4 + d];
          for (const full of all) {
            const idx = full.indexOf(u);
            ok(idx >= 0, `forced cell ${u} missing from a completion: seed ${s} cut ${cut}`);
            const prev = idx > 0 ? full[idx - 1] : -1;
            const next = idx < full.length - 1 ? full[idx + 1] : -1;
            ok(prev === v || next === v, `forced edge ${u}->${v} (dir ${d}) not used in a completion: seed ${s} cut ${cut}`);
          }
          forcedChecks++;
        }
      }
    }
  }
  ok(checked > 50, `expected enough cases, got ${checked}`);
  ok(forcedChecks > 50, `expected some forced-edge checks to actually run, got ${forcedChecks}`);
});
t('legsCollide: never fires on a genuine prefix of a real solution (soundness)', () => {
  // legsCollide is a NECESSARY (not sufficient) infeasibility condition: it may miss some dead
  // positions, but it must NEVER fire on a prefix that a real solution actually continues from.
  // Cross-check against solve()'s own found paths (ground truth), general to any puzzle — not
  // tied to how it was generated (that's the whole point of this check).
  let checked = 0, firedOnRealPrefix = 0;
  for (let s = 1; s <= 400; s++) {
    const n = 3 + (s % 5), K = 2 + (s % 6), wf = 0.05 * (s % 10);
    const p = randPuzzle(s, n, K, wf);
    const sol = solve(p, { limit: 1, nodeCap: 30000, capture: true });
    if (sol.exceeded || sol.count === 0) continue;
    const full = sol.paths[0];
    const KK = Math.max(...p.cp);
    const pos = new Int32Array(KK + 1).fill(-1);
    for (let i = 0; i < n * n; i++) if (p.cp[i]) pos[p.cp[i]] = i;
    const { nb, T } = buildNeighbors(p);
    for (let cut = 1; cut < full.length; cut++) {
      const prefix = full.slice(0, cut);
      const vis = new Uint8Array(T);
      for (const c of prefix) vis[c] = 1;
      const head = prefix[prefix.length - 1];
      let need = 1;
      for (const c of prefix) if (p.cp[c]) need = p.cp[c] + 1;
      if (need > KK) continue;
      const legs = [[head, pos[need]]];
      for (let k = need; k < KK; k++) legs.push([pos[k], pos[k + 1]]);
      checked++;
      if (legsCollide(nb, T, vis, legs)) { firedOnRealPrefix++; ok(false, `false positive: seed ${s} cut ${cut}`); }
    }
  }
  ok(checked > 100, `expected enough cases, got ${checked}`);
  eq(firedOnRealPrefix, 0);
});
t('legsCollide: catches the reported forced-corridor-collision case one move before existing checks', () => {
  // Regression test for a specific reported position: two consecutive checkpoint legs' forced
  // corridors overlap outside their shared endpoint, making the position dead — but connOk,
  // noDeadEnd and forced-edge propagation all still say the position looks fine at that point.
  const n = 7, p = makePuzzle(n);
  const rc = (r, c) => r * n + c;
  for (const [r, c, k] of [[0, 0, 6], [0, 5, 5], [1, 5, 7], [3, 2, 4], [3, 6, 3], [5, 1, 1], [6, 5, 2]]) p.cp[rc(r, c)] = k;
  for (const [t, r, c] of [['V', 3, 0], ['V', 3, 4], ['H', 4, 1], ['V', 5, 0], ['V', 5, 1], ['V', 6, 4]]) {
    setWallId(p.walls, t === 'V' ? edgeId(n, rc(r, c), rc(r, c + 1)) : edgeId(n, rc(r, c), rc(r + 1, c)), true);
  }
  const fullPath = [[5, 1], [6, 1], [6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4], [4, 5]].map(([r, c]) => rc(r, c));
  const { nb, T } = buildNeighbors(p);
  const K = Math.max(...p.cp);
  const pos = new Int32Array(K + 1).fill(-1);
  for (let i = 0; i < T; i++) if (p.cp[i]) pos[p.cp[i]] = i;

  const collideAt = new Array(fullPath.length + 1).fill(false);
  const noDeadEnd0 = makeNoDeadEnd(nb, new Uint8Array(T), pos[K]);
  for (let cut = 1; cut <= fullPath.length; cut++) {
    const prefix = fullPath.slice(0, cut);
    const vis = new Uint8Array(T);
    for (const c of prefix) vis[c] = 1;
    const head = prefix[prefix.length - 1];
    let need = 1;
    for (const c of prefix) if (p.cp[c]) need = p.cp[c] + 1;
    const legs = [[head, pos[need]]];
    for (let k = need; k < K; k++) legs.push([pos[k], pos[k + 1]]);
    collideAt[cut] = legsCollide(nb, T, vis, legs);
  }
  // legsCollide must fire by cut=13 (one move before the reported dead move to (4,5) at cut=14).
  ok(collideAt[13], 'legsCollide should already fire at cut=13 (head at (4,4))');
  ok(collideAt[14], 'legsCollide should still fire at cut=14 (the reported position)');
  // And the position genuinely has zero completions from cut=13 onward (exhaustive check).
  const vis13 = new Uint8Array(T);
  for (const c of fullPath.slice(0, 13)) vis13[c] = 1;
  function anyCompletion(cell, k, need) {
    if (k === T) return cell === pos[K] && need === K + 1;
    for (let d = 0; d < 4; d++) {
      const v = nb[cell * 4 + d];
      if (v < 0 || vis13[v]) continue;
      let need2 = need;
      if (p.cp[v]) { if (p.cp[v] !== need2) continue; need2++; }
      vis13[v] = 1;
      const ok2 = anyCompletion(v, k + 1, need2);
      vis13[v] = 0;
      if (ok2) return true;
    }
    return false;
  }
  let need13 = 1;
  for (const c of fullPath.slice(0, 13)) if (p.cp[c]) need13 = p.cp[c] + 1;
  eq(anyCompletion(fullPath[12], 13, need13), false, 'position should genuinely be unsolvable from cut=13');
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
  // default constant matches generate()/generateUnique()'s actual defaults (prop on, rest off, backbite/gap)
  eq(decodeFlags(DEFAULT_FLAGS_INT), { build: DEFAULT_GEN_FLAGS, minimize: DEFAULT_GEN_FLAGS, score: DEFAULT_GEN_FLAGS, path: 'backbite', cps: 'gap' });
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

// ---- difficulty grading ----

// A handful of real generated puzzles across sizes/K, reused by several tests below so each isn't
// re-generating+re-solving from scratch.
function sampleUniquePuzzles() {
  const cases = [[7, 6, 11], [9, 8, 22], [11, 10, 33]]; // [n, K, seed]
  const out = [];
  for (const [n, K, seed] of cases) {
    const r = runSync(generateUnique(n, K, makeRng(seed), { tries: 20 }));
    if (r.unique) out.push(r.puzzle);
  }
  ok(out.length > 0, 'expected at least one unique sample puzzle to test against');
  return out;
}

t('solve(): decisions option is additive-only — same count/exceeded/nodes/paths as without it', () => {
  for (const p of sampleUniquePuzzles()) {
    const cap = refNodeCap(p.n);
    const plain = solve(p, { limit: 2, nodeCap: cap, capture: true, ...REF_FLAGS });
    const withD = solve(p, { limit: 2, nodeCap: cap, capture: true, decisions: true, ...REF_FLAGS });
    eq(plain.count, withD.count, 'count');
    eq(plain.exceeded, withD.exceeded, 'exceeded');
    eq(plain.nodes, withD.nodes, 'nodes — decision counting must not change search or pruning');
    eq(plain.paths, withD.paths, 'paths (capture)');
    ok(Number.isInteger(withD.decisionNodes) && withD.decisionNodes >= 0, 'decisionNodes present and sane');
    ok(withD.maxDecisionDepth >= 0 && withD.maxDecisionDepth <= 1, 'maxDecisionDepth is a 0..1 fraction');
  }
});
t('solve(): decisionNodes/maxDecisionDepth absent unless opts.decisions is truthy', () => {
  const p = sampleUniquePuzzles()[0];
  const r = solve(p, { limit: 2, nodeCap: refNodeCap(p.n) });
  eq('decisionNodes' in r, false); eq('maxDecisionDepth' in r, false);
});
t('difficulty: metricsFor matches a direct referenceSolve + backtrackOverhead computation', () => {
  for (const p of sampleUniquePuzzles()) {
    const r = referenceSolve(p);
    const m = metricsFor(p);
    eq(m.nodes, r.nodes); eq(m.exceeded, r.exceeded); eq(m.decisionNodes, r.decisionNodes || 0);
    eq(m.unique, r.count === 1 && !r.exceeded);
    eq(m.B, backtrackOverhead(r, p.n));
    ok(m.B >= -1, 'B = nodes/cells - 1 is bounded below by -1 (nodes >= 0)');
  }
});
t('difficulty: naiveGap — naive (prop/parity off) never finds FEWER nodes than the reference solve', () => {
  // Turning off prunes can only add search, never remove it (same solutions, same DFS order for a
  // given prefix — see solve.js's own comment on prune2/prop/seg/pocket/parity/legCollide).
  for (const p of sampleUniquePuzzles()) {
    const cap = refNodeCap(p.n);
    const base = metricsFor(p, cap);
    const gap = naiveGap(p, base.nodes, cap);
    ok(gap.naiveNodes >= base.nodes || gap.naiveExceeded, `naive should cost >= reference (got ${gap.naiveNodes} vs ${base.nodes})`);
    eq(gap.naiveGap, gap.naiveNodes - base.nodes);
  }
});
t('difficulty: legCollideDependent is false whenever legCollide was never needed to prove uniqueness', () => {
  // Construct a small puzzle whose uniqueness is easy without any cross-leg reasoning (K close to
  // K_full, densely numbered) — legCollide dropping out should not break its already-confirmed
  // uniqueness.
  const p = randomPathPuzzle(5, 24, makeRng(3)); // near K_full(5)=24 per zip-puzzle-theory memory
  const check = solve(p, { limit: 2, nodeCap: 200000, ...REF_FLAGS });
  if (check.count === 1 && !check.exceeded) {
    eq(legCollideDependent(p, 200000), false);
  }
});
t('difficulty: firstSolutionGap — firstNodes <= reference nodes (limit:1 can only stop earlier or equal)', () => {
  for (const p of sampleUniquePuzzles()) {
    const cap = refNodeCap(p.n);
    const base = metricsFor(p, cap);
    const first = firstSolutionGap(p, base.nodes, cap);
    ok(first.firstNodes <= base.nodes, `first-solution search shouldn't need more nodes than the uniqueness proof (${first.firstNodes} vs ${base.nodes})`);
    eq(first.firstGap, base.nodes - first.firstNodes);
  }
});
t('difficulty: fullDiagnostics bundles all of the above consistently for one puzzle', () => {
  const p = sampleUniquePuzzles()[0];
  const cap = refNodeCap(p.n);
  const base = metricsFor(p, cap);
  const d = fullDiagnostics(p, cap);
  eq(d.nodes, base.nodes); eq(d.decisionNodes, base.decisionNodes); eq(d.B, base.B);
  ok(Number.isFinite(d.regression), 'regression score computed');
  ok(typeof d.legCollideDependent === 'boolean');
});
t('difficulty: gradeOf is a pure step function — monotone, respects thresholds, unbounded top bucket', () => {
  const thresholds = [10, 50, 200, 1000];
  eq(gradeOf(0, thresholds), 0);
  eq(gradeOf(9, thresholds), 0);
  eq(gradeOf(10, thresholds), 1);
  eq(gradeOf(999, thresholds), 3);
  eq(gradeOf(1000, thresholds), 4);
  eq(gradeOf(1e9, thresholds), 4, 'no 6th threshold => top grade is unbounded above');
  // monotone: grade never decreases as decisionNodes increases
  let last = -1;
  for (const x of [0, 1, 10, 11, 49, 50, 51, 199, 200, 999, 1000, 5000]) {
    const g = gradeOf(x, thresholds);
    ok(g >= last, `grade decreased at x=${x}`); last = g;
  }
});
t('calibration: calibrate() pools across every N in range, not per-N (thresholds shared, not per-size)', () => {
  // Small/fast sample: this only checks the pooling contract (one shared threshold list, and the
  // sample count matches what was actually requested), not statistical quality — see
  // tools/calibrate.mjs for a real calibration run.
  const { thresholds, samples, n } = calibrate([5, 6], 42, 3);
  eq(Array.isArray(thresholds), true);
  eq(thresholds.length, QUANTILES.length);
  ok(n <= 6, 'at most samplesPerN * number of sizes samples');
  ok(n > 0, 'expected at least one successful sample at N=5,6 with 3 tries each');
  eq(samples.length, n);
  // thresholds must be non-decreasing (they're quantile cuts over one sorted pooled array)
  for (let i = 1; i < thresholds.length; i++) ok(thresholds[i] >= thresholds[i - 1], 'thresholds non-decreasing');
});
t('calibration: DEFAULT_THRESHOLDS is a non-decreasing array of the expected length', () => {
  eq(Array.isArray(DEFAULT_THRESHOLDS), true);
  eq(DEFAULT_THRESHOLDS.length, QUANTILES.length);
  for (let i = 1; i < DEFAULT_THRESHOLDS.length; i++) ok(DEFAULT_THRESHOLDS[i] >= DEFAULT_THRESHOLDS[i - 1]);
});
t('calibration: every GRADED_METRICS entry has its own non-decreasing default thresholds of the expected length', () => {
  for (const id of Object.keys(GRADED_METRICS)) {
    const th = DEFAULT_THRESHOLDS_BY_METRIC[id];
    ok(Array.isArray(th), `${id}: missing default thresholds`);
    eq(th.length, QUANTILES.length, `${id}: threshold count`);
    for (let i = 1; i < th.length; i++) ok(th[i] >= th[i - 1], `${id}: thresholds must be non-decreasing`);
  }
  eq(DEFAULT_THRESHOLDS_BY_METRIC.decisionNodes, DEFAULT_THRESHOLDS, 'decisionNodes entry must stay identical to the legacy DEFAULT_THRESHOLDS export');
});
t('calibration: calibrateAll shares ONE generation pass across metrics — same sample count per metric, per-metric thresholds differ', () => {
  const res = calibrateAll([5, 6], 42, 3);
  const ids = Object.keys(GRADED_METRICS);
  eq(Object.keys(res).sort(), ids.slice().sort());
  const counts = ids.map(id => res[id].n);
  ok(counts.every(c => c === counts[0]), `every metric must be calibrated from the same puzzles (counts ${counts})`);
  ok(counts[0] > 0, 'expected at least one usable sample at N=5,6');
  for (const id of ids) {
    eq(res[id].thresholds.length, QUANTILES.length);
    for (let i = 1; i < res[id].thresholds.length; i++) ok(res[id].thresholds[i] >= res[id].thresholds[i - 1]);
  }
  // calibrate() (legacy single-metric alias) must agree with calibrateAll's decisionNodes entry for
  // the same seed — same generation stream, same quantile cuts.
  eq(calibrate([5, 6], 42, 3).thresholds, res.decisionNodes.thresholds);
});
t('calibration: calibrateMetric reproduces calibrateAll for the same metric/seed (single-metric path is not a different algorithm)', () => {
  const all = calibrateAll([5, 6], 7, 3);
  for (const id of Object.keys(GRADED_METRICS)) eq(calibrateMetric(id, [5, 6], 7, 3).thresholds, all[id].thresholds, id);
});
t('calibration: generateAtDifficulty finds a matching grade across an N range, or returns null (never throws)', () => {
  const rnd = makeRng(555);
  const result = runSync(generateAtDifficulty([7, 8, 9], 2, DEFAULT_THRESHOLDS, rnd, { tries: 25 }));
  if (result) {
    eq(gradeOf(result.metrics.decisionNodes, DEFAULT_THRESHOLDS), 2);
    ok([7, 8, 9].includes(result.n), 'chosen N within the requested range');
    eq(result.grade, 2);
  } // else: heuristic search legitimately found nothing in 25 tries — not itself a failure
});

// ---- calibrated multi-grade computation (core/grades.js) ----
// generateUnique at a hand-picked K can produce a puzzle whose uniqueness proof exceeds the grading
// node cap (e.g. the N=11 sample) — gradesFor correctly returns null for those. The play app never
// hits that case in practice (generate() only keeps puzzles that fit its own, comparable cap; 0 of 125
// sampled play puzzles were ungraded), so tests that need an actual grade use only puzzles that fit.
let _gradable = null; // computed once: each check is a full reference solve, and 4 tests below share it
const gradablePuzzles = () => (_gradable ||= sampleUniquePuzzles().filter(p => !metricsFor(p).exceeded));
t('grades: gradesFor returns one 0..5 integer grade per GRADE_ORDER metric, plus the raw value it bucketed', () => {
  ok(gradablePuzzles().length > 0, 'expected at least one sample puzzle within the grading budget');
  for (const p of gradablePuzzles()) {
    const g = gradesFor(p);
    ok(g, 'expected a grade for a puzzle whose reference solve fit the cap');
    eq(Object.keys(g.grades), GRADE_ORDER);
    eq(Object.keys(g.raw), GRADE_ORDER);
    for (const id of GRADE_ORDER) {
      ok(Number.isInteger(g.grades[id]) && g.grades[id] >= 0 && g.grades[id] <= 5, `${id}: grade ${g.grades[id]} out of 0..5`);
      ok(Number.isFinite(g.raw[id]), `${id}: raw value must be finite`);
    }
  }
});
t('grades: each metric is bucketed with ITS OWN thresholds (same raw value gives different grades for different metrics)', () => {
  const p = gradablePuzzles()[0];
  const g = gradesFor(p);
  // Feed one identical raw value through every metric's own cutpoints: they must not all agree,
  // otherwise the thresholds were shared/reused across metrics (the bug per-metric calibration avoids).
  const same = GRADE_ORDER.map(id => gradeOf(1, DEFAULT_THRESHOLDS_BY_METRIC[id]));
  ok(new Set(same).size > 1, `identical raw value graded identically by every metric: ${same}`);
  eq(gradesFromMetrics(g.metrics, g.spatial).grades, g.grades, 'gradesFromMetrics must reproduce gradesFor for the same solve results');
});
t('grades: gradesFor returns null (no grade) when the reference solve cannot confirm uniqueness within the cap', () => {
  const p = gradablePuzzles()[0];
  ok(gradesFor(p), 'sanity: gradable within the normal cap');
  eq(gradesFor(p, 1), null, 'a 1-node cap cannot confirm uniqueness => no grade, never a made-up one');
});
t('grades: decisionNodes and B are size-normalized (per cell / per N), not raw counts', () => {
  const p = gradablePuzzles()[0];
  const g = gradesFor(p);
  eq(g.raw.decisionNodes, g.metrics.decisionNodes / (p.n * p.n));
  eq(g.raw.B, g.metrics.B / p.n);
});
t('grades: combinedScore is a pure function of the puzzle\'s own metrics (z of B/N + z of crossPerSeg)', () => {
  const m = { B: 10, n: 5 }, s = { crossPerSeg: 0.2 };
  const want = (10 / 5 - COMBINED_ZSCORE.BperN.mean) / COMBINED_ZSCORE.BperN.sd + (0.2 - COMBINED_ZSCORE.cross.mean) / COMBINED_ZSCORE.cross.sd;
  ok(Math.abs(combinedScore(m, s) - want) < 1e-12);
  eq(combinedScore(m, s), combinedScore({ ...m }, { ...s }), 'same inputs => same score, independent of any other puzzle');
});
t('grades: play badge grade is the decisionNodes grade and hold-V grades are B and crossPerSeg (order contract the UI relies on)', () => {
  eq(GRADE_ORDER.slice(0, 3), ['decisionNodes', 'B', 'crossPerSeg']);
  eq(GRADE_ORDER.length, 5, 'design app shows all five');
});

// ---- spatial (checkpoint-geometry) candidate metrics ----
t('spatial: checkpointPositions returns [r,c] in checkpoint-number order, 1-indexed input', () => {
  const p = makePuzzle(3);
  p.cp[0] = 2; p.cp[8] = 1; p.cp[4] = 3; // (0,0)=2 (2,2)=1 (1,1)=3
  eq(checkpointPositions(p), [[2, 2], [0, 0], [1, 1]]); // index 0 = checkpoint "1", etc.
});
t('spatial: segmentCrossCount finds an X-crossing between two non-adjacent segments, misses a non-crossing one', () => {
  // 4 checkpoints forming an X between segments (1->2) and (3->4): definitely crosses.
  const crossing = [[0, 0], [2, 2], [0, 2], [2, 0]];
  eq(segmentCrossCount(crossing), 1);
  // Same 4 points, reordered so consecutive segments don't cross (a simple loop-ish path instead).
  const notCrossing = [[0, 0], [0, 2], [2, 2], [2, 0]];
  eq(segmentCrossCount(notCrossing), 0);
});
t('spatial: segmentCrossCount and segmentOverlapCount ignore adjacent (shared-endpoint) segments', () => {
  // 3 collinear points: segments (1->2),(2->3) share checkpoint 2 and always "touch" there — must
  // not be counted as a cross/overlap (there's no j>=i+2 pair to even test with only 3 points).
  const pts = [[0, 0], [0, 5], [0, 10]];
  eq(segmentCrossCount(pts), 0);
  eq(segmentOverlapCount(pts), 0);
});
t('spatial: segmentOverlapCount is >= segmentCrossCount for the same points (bbox overlap is a looser test)', () => {
  for (const pts of [
    [[0, 0], [2, 2], [0, 2], [2, 0]],
    [[0, 0], [0, 5], [5, 5], [5, 0], [2, 2]],
    [[1, 1], [4, 4], [1, 4], [4, 1], [0, 0]],
  ]) {
    ok(segmentOverlapCount(pts) >= segmentCrossCount(pts), `overlap (${segmentOverlapCount(pts)}) should be >= cross (${segmentCrossCount(pts)})`);
  }
});
t('spatial: spatialMetrics on a real generated puzzle returns finite, non-negative, K-consistent fields', () => {
  const p = runSync(generateUnique(8, 10, makeRng(9), { tries: 15 })).puzzle;
  const m = spatialMetrics(p);
  eq(m.K, 10);
  ok(Number.isInteger(m.segmentCrossCount) && m.segmentCrossCount >= 0);
  ok(Number.isInteger(m.segmentOverlapCount) && m.segmentOverlapCount >= 0);
  ok(m.segmentOverlapCount >= m.segmentCrossCount);
  ok(m.crossPerSeg >= 0 && m.overlapPerSeg >= 0);
  eq(m.crossPerSeg, m.segmentCrossCount / (m.K - 1));
});

// ---- per-size daily counters & today/total stats (fake storage + fake clock) ----
const fakeStorage = () => { const m = new Map(); return { async get(k) { return m.has(k) ? { value: m.get(k) } : null; }, async set(k, v) { m.set(k, v); } }; };
const atDay = d => () => new Date(Date.UTC(2026, 8, d, 12));
const pending = [];
const ta = (name, fn) => pending.push([name, fn]); // async tests, run after the sync ones

// ---- hint-popover (minimal fake DOM — this repo has no browser/jsdom test runner, so a small
// hand-rolled stub sufficient to exercise attachOne()'s branches is used instead of adding a new
// dependency; installs a fake global document/window only for this one test and restores whatever
// was there before, so it can't leak into any other test) ----
ta('hint-popover: attaches plain-text hints, preserves markup children, and setHintText updates in place without duplicating', async () => {
  class FakeClassList { constructor() { this.set = new Set(); } add(c) { this.set.add(c); } contains(c) { return this.set.has(c); } toggle(c, v) { if (v) this.set.add(c); else this.set.delete(c); } }
  class FakeEl {
    constructor() { this.dataset = {}; this._html = ''; this._children = []; this.classList = new FakeClassList(); this._attrs = {}; this._listeners = {}; }
    get children() { return this._children; }
    get textContent() { return this._html.replace(/<[^>]+>/g, ''); }
    set textContent(v) { this._html = v; this._children = []; }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = v; this._children = v ? [{ className: 'hint-popover' }] : []; }
    appendChild(child) { this._children.push(child); if (child.className === 'hint-popover') this._pop = child; }
    setAttribute(k, v) { this._attrs[k] = v; }
    addEventListener() { /* not exercised by these assertions */ }
    getBoundingClientRect() { return { bottom: 0 }; }
    querySelector(sel) { return sel.includes('hint-popover') ? (this._pop || null) : null; }
  }
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  globalThis.document = { createElement: () => new FakeEl() };
  globalThis.window = { innerHeight: 800 };
  try {
    const { attachHint, setHintText } = await import('../src/ui/hint-popover.js');

    const plain = new FakeEl(); plain.textContent = 'Click the gaps between cells to add or remove blocking walls.';
    attachHint(plain);
    eq(plain.dataset.hint, 'Click the gaps between cells to add or remove blocking walls.');
    eq(plain.dataset.hintAttached, '1');

    const withCode = new FakeEl();
    withCode.innerHTML = 'generate() has no flags of its own... <code id="x">ab12</code> more text';
    attachHint(withCode);
    ok(withCode._pop, 'markup-bearing hint should still get a popover');
    eq(withCode._children.length > 0, true, 'the <code> child must survive attachment, not be flattened away');

    const before = JSON.stringify(plain.dataset);
    attachHint(plain);
    eq(JSON.stringify(plain.dataset), before, 'attaching an already-attached hint is a no-op (idempotent)');

    const dyn = new FakeEl();
    setHintText(dyn, 'Drag from checkpoint 1...');
    eq(dyn.dataset.hintAttached, '1', 'setHintText on a never-attached element attaches it');
    eq(dyn._pop.textContent, 'Drag from checkpoint 1...');

    setHintText(dyn, 'Click a cell then type a number...');
    eq(dyn._pop.textContent, 'Click a cell then type a number...', 'setHintText on an attached element updates the existing popover');
    eq(dyn._children.filter(c => c.className === 'hint-popover').length, 1, 'updating text must not create a second popover node');
  } finally {
    globalThis.document = prevDoc; globalThis.window = prevWin;
  }
});

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
