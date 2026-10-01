// Runs in the browser (open test/index.html via a local server) and in Node (node test/tests.js). No dependencies.
import { makePuzzle, validate, maxNumber, ALGO_VERSION, endCell, checkpointCells } from '../src/core/model.js';
import { edgeId, edgeCells, allEdges, edgeToKey, keyToEdge, setWallId, wallCount } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { makeRng, dailySeed, hashStr, shuffle } from '../src/core/rng.js';
import { newStat, updateStat, statSummary } from '../src/core/stats.js';
import { solve } from '../src/core/solver/solve.js';
import { isSolved, step } from '../src/core/rules.js';
import { boardConnectivity, boardLegCollide } from '../src/core/connectivity.js';
import { arrowSegment } from '../src/view/geometry.js';
import { buildNeighbors, makeNoDeadEnd, forcedEdges, legsCollide, legConflicts, segBlocker } from '../src/core/solver/prune.js';
import { generate, generateUnique, randomPathPuzzle, pickK, PLAY_SIZES } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { encodeFlags, decodeFlags, flagsToHex, hexToFlags, DEFAULT_FLAGS_INT, DEFAULT_GEN_FLAGS } from '../src/core/gen/flags.js';
import { minimizeWalls } from '../src/core/gen/walls.js';
import { runSync } from '../src/core/run.js';
import { createHoldReveal } from '../src/ui/hold-reveal.js';
import { createDaily, utcDayNumber } from '../src/features/daily.js';
import { HINT_PENALTY_S, penalizedTime } from '../src/features/hints.js';
import { createStore } from '../src/features/stats-store.js';
import { NB, TOP_K, binOf, summarize, statsLine } from '../src/core/hist.js';
import { createLeaderboard, backendsFromConfig, cloudflareBackend, supabaseBackend } from '../src/platform/leaderboard.js';
import { GOLDEN } from './golden.js';
import { metricsFor, referenceSolve, backtrackOverhead, naiveGap, legCollideDependent, firstSolutionGap, fullDiagnostics, gradeOf, refNodeCap, REF_FLAGS } from '../src/core/difficulty.js';
import { calibrate, calibrateAll, calibrateMetric, generateAtDifficulty, DEFAULT_THRESHOLDS, DEFAULT_THRESHOLDS_BY_METRIC, GRADED_METRICS, QUANTILES } from '../src/core/gen/calibration.js';
import { checkpointPositions, segmentCrossCount, segmentOverlapCount, spatialMetrics } from '../src/core/spatial.js';
import { gradesFor, gradesFromMetrics, playGradesFor, GRADE_ORDER } from '../src/core/grades.js';
import { combinedScore, COMBINED_ZSCORE } from '../src/core/gen/calibration.js';
import { solutionPath, trapProfile, trapMetrics, trapGradeOf, trapPredict, TRAP_CFG, TRAP_MODEL } from '../src/core/trap.js';
import { mountDifficultyPanel } from '../src/apps/design/difficulty-panel.js';
import { ratingKey, ratingFromSelection, leanOf, describeRating, toRatingsJson, parseRatingsJson, mergeRatings, parseRatingComment, ratingWeight, UNSURE_WEIGHT, symmetryKey, findDuplicateGroups, transformPuzzle, asciiPuzzle, keyDifference } from '../src/core/ratings-io.js';
import { parsePairsJson, toPairsJson, mergePairs, pairAccuracy, impliedPairs, flipCmp, pairKeyOf } from '../src/core/pairs-io.js';
import { pickStorage } from '../src/platform/storage.js';

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
t('legConflicts / boardLegCollide: agree with legsCollide; report the colliding legs and contested cells', () => {
  // Reported position (same puzzle as the regression test above): path cut at 13 cells, head at (4,4).
  const n = 7, p = makePuzzle(n), rc = (r, c) => r * n + c;
  for (const [r, c, k] of [[0, 0, 6], [0, 5, 5], [1, 5, 7], [3, 2, 4], [3, 6, 3], [5, 1, 1], [6, 5, 2]]) p.cp[rc(r, c)] = k;
  for (const [ty, r, c] of [['V', 3, 0], ['V', 3, 4], ['H', 4, 1], ['V', 5, 0], ['V', 5, 1], ['V', 6, 4]]) {
    setWallId(p.walls, ty === 'V' ? edgeId(n, rc(r, c), rc(r, c + 1)) : edgeId(n, rc(r, c), rc(r + 1, c)), true);
  }
  const path = [[5, 1], [6, 1], [6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4]].map(([r, c]) => rc(r, c));
  const res = boardLegCollide(p, path);
  eq(res.infeasible, true); ok(res.conflicts.length > 0, 'expected at least one conflict');
  const head = path[path.length - 1], { nb, T } = buildNeighbors(p), vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  for (const { a, b, cells } of res.conflicts) {
    ok(cells.length > 0, 'a conflict names at least one contested cell');
    for (const leg of [a, b]) ok((leg[0] === head || p.cp[leg[0]] > 0) && p.cp[leg[1]] > 0, 'leg runs head/checkpoint -> checkpoint');
    eq(a[1] === b[1], false, 'two distinct legs');
    const ba = segBlocker(nb, T, vis, a[0], a[1]), bb = segBlocker(nb, T, vis, b[0], b[1]);
    for (const c of cells) ok(ba.has(c) && bb.has(c), `cell ${c} is forced by both legs`);
  }
  // Open position: nothing to report.
  const open = makePuzzle(3); open.cp[0] = 1; open.cp[4] = 2; open.cp[8] = 3;
  eq(boardLegCollide(open, [0]), { infeasible: false, conflicts: [] });
  // legsCollide <=> legConflicts non-empty, on random puzzles and every prefix of their solutions.
  let checked = 0, collided = 0;
  for (let sd = 1; sd <= 200; sd++) {
    const nn = 4 + (sd % 4), K = 3 + (sd % 5), q = randPuzzle(sd, nn, K, 0.05 * (sd % 10));
    const sol = solve(q, { limit: 1, nodeCap: 20000, capture: true });
    if (sol.exceeded || sol.count === 0) continue;
    const full = sol.paths[0], KK = Math.max(...q.cp), ps = checkpointCells(q), { nb, T } = buildNeighbors(q);
    // walk off the solution at each cut: head moves to any free neighbour, which often creates collisions
    for (let cut = 1; cut < full.length; cut++) for (let d = 0; d < 4; d++) {
      const prefix = full.slice(0, cut), h = prefix[cut - 1], v = nb[h * 4 + d];
      if (v < 0 || prefix.includes(v)) continue;
      const pf = [...prefix, v], vis = new Uint8Array(T); for (const c of pf) vis[c] = 1;
      let need = 1; for (const c of pf) if (q.cp[c]) need = q.cp[c] + 1;
      if (need > KK) continue;
      const legs = [[v, ps[need - 1]]]; for (let k = need; k < KK; k++) legs.push([ps[k - 1], ps[k]]);
      const conf = legConflicts(nb, T, vis, legs); checked++;
      eq(conf.length > 0, legsCollide(nb, T, vis, legs), `seed ${sd} cut ${cut}`);
      if (conf.length) collided++;
    }
  }
  ok(checked > 200 && collided > 0, `expected cases with collisions, checked ${checked} collided ${collided}`);
});
t('checkpointCells + arrowSegment: graph edges k -> k+1, trimmed clear of the badges, head points at k+1', () => {
  const p = makePuzzle(4); p.cp[5] = 2; p.cp[0] = 1; p.cp[15] = 3;
  eq(checkpointCells(p), [0, 5, 15]);
  const { line, tip, head } = arrowSegment(4, 0, 3, 1, 0.3, 0.2, 0.1); // (0,0) -> (0,3): cell centres x 0.5 -> 3.5
  eq(line.map(v => +v.toFixed(3)), [0.8, 0.5, 3.0, 0.5]);
  eq(tip.map(v => +v.toFixed(3)), [3.2, 0.5]);
  eq(head.map(v => +v.toFixed(3)), [3.2, 0.5, 3.0, 0.6, 3.0, 0.4]);
  const d = arrowSegment(4, 0, 5, 2, 0.34); // diagonal (1,1) -> (3,3) at scale 2: tip trimmed 0.68 along the unit direction
  eq(d.tip.map(v => +v.toFixed(3)), [2.519, 2.519]);
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

let sampleCache = null; const cachedSamples = () => sampleCache ??= sampleUniquePuzzles(); // generate once, share across tests

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
t('grades: hold-V still reveals the previous badge grade (decisionNodes) then B and crossPerSeg — order contract the UI relies on', () => {
  eq(GRADE_ORDER.slice(0, 3), ['decisionNodes', 'B', 'crossPerSeg']);
  eq(GRADE_ORDER.length, 5, 'design app shows all five');
});
t('grades: playGradesFor = trap grade (badge) + unchanged legacy grades (hold-V)', () => {
  const p = cachedSamples()[0], pg = playGradesFor(p);
  ok(pg.trap.ok && Number.isInteger(pg.trap.grade) && pg.trap.grade >= 0 && pg.trap.grade <= 5, 'trap grade 0..5');
  eq(pg.trap.grade, trapMetrics(p).grade, 'badge grade is the trap grade');
  eq(pg.legacy.grades, gradesFor(p).grades, 'legacy grades are exactly what gradesFor gave before');
  eq(playGradesFor(p, undefined).trap.predicted, pg.trap.predicted, 'deterministic');
});
t('grades: trap grade exists even when the reference solve is capped (legacy grades then null)', () => {
  const p = cachedSamples()[0];
  eq(gradesFor(p, 1), null, 'sanity: 1-node cap cannot confirm uniqueness');
  ok(trapMetrics(p).ok, 'trap grade needs only a solution path');
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

// ---- trap grade (core/trap.js) + solve()'s `forced` prefix option ----
t('solve(): forced prefix of just the start cell changes nothing (count/nodes/paths identical)', () => {
  for (const p of cachedSamples()) {
    const plain = solve(p, { limit: 2, nodeCap: refNodeCap(p.n), capture: true, ...REF_FLAGS });
    const f = solve(p, { limit: 2, nodeCap: refNodeCap(p.n), capture: true, forced: [p.cp.indexOf(1)], ...REF_FLAGS });
    eq(f.count, plain.count); eq(f.nodes, plain.nodes); eq(f.paths, plain.paths); eq(f.subNodes, plain.nodes);
  }
});
t('solve(): forced prefix along the solution still finds it; a forced wrong turn finds nothing', () => {
  for (const p of cachedSamples()) {
    const path = solutionPath(p), k = Math.max(2, path.length >> 1);
    const on = solve(p, { limit: 2, nodeCap: refNodeCap(p.n), capture: true, forced: path.slice(0, k + 1), ...REF_FLAGS });
    eq(on.count, 1); eq(on.paths[0], path); eq(on.nodes - on.subNodes, k, 'prefix nodes are not charged to the cap');
    const prof = trapProfile(p, path);
    ok(prof.length > 0, 'a real puzzle has wrong turns');
    for (const w of prof) { const off = solve(p, { limit: 1, nodeCap: TRAP_CFG.cap, forced: path.slice(0, w.i + 1).concat(w.cell), ...REF_FLAGS }); eq(off.count, 0, `wrong turn at step ${w.i} must be refuted on a unique puzzle`); }
    eq(prof.nonUnique, false);
  }
});
t('trap: metrics are deterministic, in range, and consistent with the profile', () => {
  for (const p of cachedSamples()) {
    const a = trapMetrics(p), b = trapMetrics(p);
    ok(a.ok, 'solvable'); eq(a.trapMax, b.trapMax); eq(a.trapTop3, b.trapTop3); eq(a.altFrac, b.altFrac); eq(a.grade, b.grade);
    ok(a.altFrac >= 0 && a.altFrac <= 1, 'altFrac is a fraction of steps');
    ok(a.trapTop3 >= a.trapMax, 'top-3 sum includes the max');
    ok(Number.isInteger(a.grade) && a.grade >= 0 && a.grade <= 5, 'grade 0..5');
    eq(a.steps[0].score, a.trapMax); ok(a.steps.every((s, i) => i === 0 || a.steps[i - 1].score >= s.score), 'steps sorted worst first');
    eq(trapMetrics(p, TRAP_CFG, a.path).trapMax, a.trapMax, 'passing the path in skips the solve but gives the same answer');
  }
});
t('trap: TRAP_MODEL carries the fit metadata the design panel displays (tools/fit-trap.mjs --write writes it)', () => {
  const f = TRAP_MODEL.fit;
  ok(f && Number.isInteger(f.n) && f.n > 0 && Number.isFinite(f.looRho) && Number.isFinite(f.looMae) && Number.isFinite(f.lambda), 'fit = { n, lambda, looRho, looMae }');
  for (const k of TRAP_MODEL.features) ok([TRAP_MODEL.mean[k], TRAP_MODEL.sd[k], TRAP_MODEL.w[k]].every(Number.isFinite) && TRAP_MODEL.sd[k] > 0, `weights for ${k}`);
});
// The design panel is DOM code, but its HTML building is plain string work: run the real "Compute diagnostics" path against a
// minimal fake element. (A missing TRAP_MODEL.fit once threw here, in the browser only, because nothing rendered the panel.)
function renderDiagnostics(p) {
  const el = { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    querySelectorAll: () => [], querySelector() { return { style: {}, dataset: {}, textContent: '', innerHTML: '', classList: { toggle() {}, add() {}, remove() {} }, set onclick(f) {}, querySelectorAll: () => [] }; } };
  mountDifficultyPanel(el, () => p, () => undefined).run();
  return el._html;
}
t('design panel: Compute diagnostics renders trap + ladder sections without NaN/undefined', () => {
  const html = renderDiagnostics(cachedSamples()[0]);
  ok(html.includes('Trap grade (candidate)') && html.includes('Technique ladder (candidate)'), 'both sections');
  ok(!/NaN|undefined/.test(html), 'no NaN/undefined in the panel');
  ok(html.includes(`fit to ${TRAP_MODEL.fit.n} hand ratings`), 'fit size comes from TRAP_MODEL.fit');
});
t('design panel: still renders when TRAP_MODEL has no fit metadata (older trap.js)', () => {
  const saved = TRAP_MODEL.fit; delete TRAP_MODEL.fit;
  try { ok(renderDiagnostics(cachedSamples()[0]).includes('Trap grade (candidate)'), 'renders'); } finally { TRAP_MODEL.fit = saved; }
});
// ---- ratings.json format (core/ratings-io.js): shared by the design app's export/import and tools/ ----
t('ratings-io: a rating is one grade, a range, or a range leaning to one end; describeRating/leanOf read it back', () => {
  eq(ratingFromSelection({ lo: 2, hi: 2 }), { human: 2, lo: 2, hi: 2 });
  eq(ratingFromSelection({ lo: 3, hi: 2 }), { human: 2.5, lo: 2, hi: 3 }, 'order does not matter');
  eq(ratingFromSelection({ lo: 2, hi: 3, lean: 1 }), { human: 2.75, lo: 2, hi: 3 });
  eq(ratingFromSelection({ lo: 2, hi: 3, lean: -1 }), { human: 2.25, lo: 2, hi: 3 });
  eq(ratingFromSelection({ lo: 4, hi: 4, lean: 1 }), { human: 4, lo: 4, hi: 4 }, 'a single grade has nothing to lean toward');
  eq([describeRating({ human: 2, lo: 2, hi: 2 }), describeRating({ human: 2.5, lo: 2, hi: 3 }), describeRating({ human: 2.75, lo: 2, hi: 3 }), describeRating({ human: 2.25, lo: 2, hi: 3 }), describeRating({ human: 4, lo: 3, hi: 5 }), describeRating({ human: 3 })],
    ['2', '2 or 3', '2 or 3, close to 3', '2 or 3, close to 2', '3 to 5', '3']);
  eq([leanOf({ human: 2.75, lo: 2, hi: 3 }), leanOf({ human: 2.25, lo: 2, hi: 3 }), leanOf({ human: 2.5, lo: 2, hi: 3 }), leanOf({ human: 2, lo: 2, hi: 2 })], [1, -1, 0, 0]);
});
t('ratings-io: ratingKey is the comment-free puzzle text, the same for a puzzle object, serialize() output and the bare 3 lines', () => {
  const p = cachedSamples()[0], k = ratingKey(p);
  ok(!k.includes('#') && k.startsWith('size ') && k.split('\n').length === 3, 'size / checkpoints / walls only');
  eq(ratingKey(serialize(p)), k); eq(ratingKey(k), k); eq(ratingKey(k + '\n\n# note\n'), k);
});
t('ratings-io: export -> parse round-trips (metrics are not exported), and rows are validated one by one', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  const text = toRatingsJson([{ key: ka, human: 2.75, lo: 2, hi: 3, metrics: { x: 1 } }, { key: kb, human: 1 }]);
  ok(!text.includes('metrics') && text.endsWith('\n'), 'no metrics, trailing newline');
  eq(parseRatingsJson(text), { ratings: [{ key: ka, human: 2.75, lo: 2, hi: 3 }, { key: kb, human: 1, lo: 1, hi: 1 }], problems: [] });
  eq(parseRatingsJson('nope').ratings, []); ok(parseRatingsJson('nope').problems[0].includes('not valid JSON'));
  ok(parseRatingsJson('{}').problems[0].includes('array'));
  const bad = parseRatingsJson(JSON.stringify([{ key: ka, human: 2 }, { human: 1 }, { key: 'garbage', human: 1 }, { key: kb, human: 7 }, { key: kb, human: 2, lo: 3, hi: 2 }, { key: kb, human: 4, lo: 1, hi: 2 }, { key: serialize(b), lo: 1, hi: 2 }]));
  eq(bad.ratings.map(r => [r.key === ka ? 'a' : 'b', r.human, r.lo, r.hi]), [['a', 2, 2, 2], ['b', 1.5, 1, 2]], 'only valid rows import; human defaults to the midpoint of lo/hi; serialize() text is normalised');
  eq(bad.problems.length, 5, 'missing key, unparseable puzzle, human 7, lo > hi, human outside its range'); ok(bad.problems.some(s => s.startsWith('#2:')) && bad.problems.some(s => s.includes('does not parse')) && bad.problems.some(s => s.includes('outside [1, 2]')));
  eq(parseRatingsJson(JSON.stringify([{ key: ka, human: 1 }, { key: serialize(a), human: 3 }])).ratings, [{ key: ka, human: 3, lo: 3, hi: 3 }], 'the same puzzle twice: the later one wins');
});
t('ratings-io: merging replaces the same puzzle, keeps the rest, and clears metrics so they get recomputed', () => {
  const [a, b, c] = cachedSamples(); const ka = ratingKey(a), kb = ratingKey(b), kc = ratingKey(c);
  const log = [{ key: ka, human: 2, lo: 2, hi: 2, metrics: { m: 1 } }, { key: kb, human: 1, metrics: { m: 2 } }];
  const m = mergeRatings(log, [{ key: ka, human: 2, lo: 2, hi: 2 }, { key: kb, human: 2.5, lo: 2, hi: 3 }, { key: kc, human: 4, lo: 4, hi: 4 }]);
  eq([m.added, m.updated, m.changed], [1, 2, 1], 'a and b existed; only b changed; c is new');
  eq(m.entries.map(e => [e.key === ka ? 'a' : e.key === kb ? 'b' : 'c', e.human, e.metrics]), [['a', 2, null], ['b', 2.5, null], ['c', 4, null]]);
  eq(log[0].metrics, { m: 1 }, 'the stored log is not mutated');
  eq(mergeRatings([{ key: 'zzz', human: 0 }], []).entries.length, 1, 'entries missing from the file are kept');
});
t('ratings-io: comment grammar — explicit "human 2, range 2-3", the older forms, and chatter; everything else is an error', () => {
  const g = c => { const r = parseRatingComment(c); return r.ok ? [r.human, r.lo, r.hi, r.unsure] : r.why; };
  eq(g('human 2, range 2-3'), [2, 2, 3, false]); eq(g('human 2.5, range 2–3, unsure'), [2.5, 2, 3, true]); eq(g('range 3-5'), [4, 3, 5, false]); eq(g('human 4'), [4, 4, 4, false]);
  eq(g('Range 1 to 2 , SURE'), [1.5, 1, 2, false], 'case, spacing, "to" and "sure" are tolerated');
  eq(g('this is 2'), [2, 2, 2, false]); eq(g('this is 2 or 3'), [2.5, 2, 3, false]); eq(g('this is 2 or 3, close to 3'), [2.75, 2, 3, false]); eq(g('this is 1 or 2, close to 1'), [1.25, 1, 2, false]);
  eq(g('this is at least 4'), [4, 4, 5, false]); eq(g('this is at most 1'), [0.5, 0, 1, false]);
  eq(g('this is at least 3, close to 4 or 4.'), [4, 3, 5, false], 'the interpreted rating: human 4, range 3-5');
  eq(g('this is at most 2, close to 1 or rather 1'), [1, 1, 1, false]); eq(g('This is close to 3, you graded as 2'), [3, 3, 3, false]);
  eq(g('this one is also 1 or 0, not 3.'), [0.5, 0, 1, false], 'either order; "not 3" is chatter'); eq(g('It is 2, instead of 3'), [2, 2, 2, false]); eq(g('this can be 1, more than 0.'), [1, 1, 1, false]);
  eq(g('this is 2 or 3, close to 3. you graded as 3.'), [2.75, 2, 3, false]); eq(g('this one is medium 2, not expert 4.'), [2, 2, 2, false], 'grade words are ignored');
  for (const bad of ['', 'this is pretty hard', 'human 2, range 3-4', 'human 2, range 4-3', 'human 6', 'range 2-3, wibble', 'this is 2 or 3, close to 1', 'human 2, human 3', 'unsure']) ok(typeof g(bad) === 'string', `rejects "${bad}": ${g(bad)}`);
});
t('ratings-io: unsure ratings — exported only when true, validated, merged, and weighted', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  eq([ratingWeight({ unsure: true }), ratingWeight({}), ratingWeight(undefined), UNSURE_WEIGHT], [0.5, 1, 1, 0.5]);
  const text = toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 3, unsure: true }, { key: kb, human: 1 }]);
  ok(text.includes('"unsure": true') && text.split('unsure').length === 2, 'written only for the unsure one');
  eq(parseRatingsJson(text).ratings.map(r => !!r.unsure), [true, false]);
  ok(parseRatingsJson(JSON.stringify([{ key: ka, human: 1, unsure: 'maybe' }])).problems[0].includes('"unsure"'));
  const m = mergeRatings([{ key: ka, human: 2, lo: 2, hi: 3, metrics: { x: 1 } }], [{ key: ka, human: 2, lo: 2, hi: 3, unsure: true }]);
  eq([m.updated, m.changed, m.entries[0].unsure], [1, 1, true], 'becoming unsure counts as a change');
});
t('ratings-io: duplicates — rotated / mirrored / reversed copies share a symmetry key; exact copies are found; different puzzles are not', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), K = Math.max(...a.cp);
  for (let k = 0; k < 8; k++) eq(symmetryKey(transformPuzzle(a, k, false)), symmetryKey(a), `transform ${k}`);
  eq(symmetryKey(transformPuzzle(a, 3, true)), symmetryKey(a), 'reversed numbering');
  ok(symmetryKey(a) !== symmetryKey(b), 'different puzzles differ');
  const rot = transformPuzzle(a, 1, false);
  ok(ratingKey(rot) !== ka, 'a quarter turn really changes the text'); eq(Math.max(...rot.cp), K); eq(rot.walls.reduce((s, w) => s + (w & 1) + (w >> 1 & 1), 0), a.walls.reduce((s, w) => s + (w & 1) + (w >> 1 & 1), 0), 'wall count preserved');
  const g = findDuplicateGroups([{ key: ka }, { key: kb }, { key: serialize(a) }, { key: ratingKey(rot) }, { key: 'garbage' }]);
  eq(g.exact, [[0, 2]], 'exact: same puzzle despite the header comments'); eq(g.equivalent, [[0, 2, 3]], 'equivalent group lists every member');
  eq(findDuplicateGroups([{ key: ka }, { key: kb }]), { exact: [], equivalent: [] });
  ok(asciiPuzzle(a).split('\n').length >= 2 * a.n - 1, 'ascii picture has a line per row plus wall lines');
});
t('pairs-io: parse / merge / orientation / accuracy', () => {
  const [a, b, c] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), kc = ratingKey(c);
  const text = toPairsJson([{ a: ka, b: kb, cmp: 'harder', ma: { x: 1 } }, { a: kb, b: kc, cmp: 'same' }]);
  ok(!text.includes('"ma"'), 'cached metrics are not exported'); const back = parsePairsJson(text);
  eq(back.problems, []); eq(back.pairs.map(p => p.cmp), ['harder', 'same']);
  const bad = parsePairsJson(JSON.stringify([{ a: ka, b: ka, cmp: 'harder' }, { a: ka, b: kb, cmp: 'bigger' }, { a: 'garbage', b: kb, cmp: 'same' }, { a: ka, b: kb }, { a: ka, b: kb, cmp: 'harder' }, { a: kb, b: ka, cmp: 'harder' }]));
  eq(bad.pairs.length, 1, 'only the last valid row of the repeated pair stays'); eq([bad.pairs[0].a === kb, bad.pairs[0].cmp], [true, 'harder']);
  ok(bad.problems.length === 5 && bad.problems.some(s => s.includes('DIFFERENT verdict')), bad.problems.join(' | '));
  eq([flipCmp('harder'), flipCmp('easier'), flipCmp('same')], ['easier', 'harder', 'same']); eq(pairKeyOf(ka, kb), pairKeyOf(kb, ka));
  const m = mergePairs([{ a: ka, b: kb, cmp: 'harder', ma: {} }, { a: kb, b: kc, cmp: 'same' }], [{ a: kb, b: ka, cmp: 'easier' }, { a: kc, b: ka, cmp: 'harder' }]);
  eq([m.added, m.updated, m.changed], [1, 1, 0], 'B-vs-A "easier" is the same verdict as A-vs-B "harder"'); eq(m.pairs[0].ma, undefined, 'replaced pair loses its cached grades so they are recomputed');
  const val = { [ka]: 1, [kb]: 3, [kc]: 3 }, v = k => val[k];
  const acc = pairAccuracy([{ a: ka, b: kb, cmp: 'harder' }, { a: kb, b: ka, cmp: 'harder' }, { a: kb, b: kc, cmp: 'harder' }, { a: kb, b: kc, cmp: 'same' }, { a: ka, b: 'zzz', cmp: 'harder' }], v);
  eq([acc.decided, acc.correct, acc.accuracy, acc.ties, acc.sameN, acc.sameTied, acc.skipped], [3, 1.5, 0.5, 1, 1, 1, 1], 'right, wrong, tie = half, "same" scored apart, missing value skipped');
  eq(impliedPairs([{ key: 'p', lo: 1, hi: 2 }, { key: 'q', lo: 3, hi: 3 }, { key: 'r', lo: 2, hi: 3 }]).map(x => `${x.a}${x.cmp}${x.b}`), ['pharderq'], 'only non-overlapping ranges imply an order');
});
t('trap: no solution -> { ok:false } instead of a made-up grade; grade clamps to 0..5', () => {
  const p = makePuzzle(4); p.cp[0] = 1; p.cp[15] = 2; p.cp[5] = 3; // 1 -> 2 -> 3 order cannot be a Hamiltonian path here
  const r = trapMetrics(p);
  ok(!r.ok && typeof r.reason === 'string', 'unsolvable puzzle reports why');
  eq([-3, 0.4, 0.5, 2.49, 5.4, 9].map(trapGradeOf), [0, 0, 1, 2, 5, 5]);
  eq(trapPredict({ trapMax: 0, trapTop3: 0, altFrac: 0 }, { features: ['trapMax'], mean: { trapMax: 0 }, sd: { trapMax: 2 }, w: { trapMax: 1 }, b: 1 }), 1);
});

ta('tools/ratings.json: the repo label file parses cleanly, keys are canonical and unique, ranges contain human', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only (reads the file from disk)
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../tools/ratings.json', import.meta.url), 'utf8');
  const { ratings, problems } = parseRatingsJson(text);
  eq(problems, []); ok(ratings.length >= 74, `expected >= 74 ratings, got ${ratings.length}`);
  eq(new Set(ratings.map(r => r.key)).size, ratings.length, 'unique puzzles');
  const bad = JSON.parse(text).map((r, i) => [i + 1, keyDifference(r.key)]).filter(x => x[1]);
  ok(!bad.length, `${bad.length} key(s) in tools/ratings.json are not canonical (they parse, but differ from what the app exports). ${bad.slice(0, 3).map(([i, why]) => `row #${i}: ${why}`).join(' | ')}${bad.length > 3 ? ` | ... +${bad.length - 3} more` : ''}. Fix: node tools/check-ratings.mjs --fix`);
  ok(toRatingsJson(ratings) === text.replace(/\r\n/g, '\n'), 'tools/ratings.json is not laid out the way the app exports it (indentation / field order / trailing newline: did an editor or formatter rewrite it?). Fix: node tools/check-ratings.mjs --fix');
});

// A fake DOM just rich enough to drive the panel's real handlers (buttons, file input, status text); nothing is mocked in the panel itself.
function makePanelDom() {
  const reg = new Map(), mk = () => ({ style: {}, dataset: {}, textContent: '', innerHTML: '', onclick: null, onchange: null, files: null, value: '', classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [] });
  const sel = s => {
    if (!reg.has(s)) {
      const e = mk();
      if (s === '#diffDups') { // the duplicate list builds delete buttons inside its own innerHTML
        e.dels = {};
        e.querySelectorAll = q => q === '.diff-dup-del' ? [...e.innerHTML.matchAll(/data-key-index="(\d+)"/g)].map(m => ({ dataset: { keyIndex: m[1] }, set onclick(f) { e.dels[m[1]] = f; } })) : [];
      }
      reg.set(s, e);
    }
    return reg.get(s);
  };
  const groups = new Map();
  const all = (s, k, f) => { if (!groups.has(s)) groups.set(s, Array.from({ length: k }, (_, i) => { const e = mk(); f(e, i); return e; })); return groups.get(s); };
  const el = { _html: '', set innerHTML(v) { this._html = v; reg.clear(); groups.clear(); }, get innerHTML() { return this._html; }, style: {},
    querySelector: sel,
    querySelectorAll: s => s === '.diff-rate-btn' ? all(s, 6, (e, i) => { e.dataset.grade = i; }) : s === '.diff-lean-btn' ? all(s, 2, (e, i) => { e.dataset.lean = i ? 1 : -1; }) : s === '.diff-pair-btn' ? all(s, 3, (e, i) => { e.dataset.cmp = ['harder', 'same', 'easier'][i]; }) : [] };
  return { el, sel, pair: c => el.querySelectorAll('.diff-pair-btn')[['harder', 'same', 'easier'].indexOf(c)], grade: g => el.querySelectorAll('.diff-rate-btn')[g], lean: d => el.querySelectorAll('.diff-lean-btn')[d < 0 ? 0 : 1], text: () => sel('.diff-rate-text').textContent };
}
const LOG_KEY = 'zip-difficulty-rating-log-v1';
const readLog = async () => { const s = await pickStorage(), r = await s.get(LOG_KEY); return r ? JSON.parse(r.value) : []; };
const writeLog = async v => { const s = await pickStorage(); await s.set(LOG_KEY, JSON.stringify(v)); };
const PAIR_LOG = 'zip-difficulty-pair-log-v1', PREV_REC = 'zip-difficulty-prev-v1';
const readJson = async (k, d) => { const s = await pickStorage(), r = await s.get(k); return r ? JSON.parse(r.value) : d; };
const writeJson = async (k, v) => { const s = await pickStorage(); await s.set(k, JSON.stringify(v)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const resetAll = async () => { await writeLog([]); await writeJson(PAIR_LOG, []); await writeJson(PREV_REC, {}); };

ta('design panel: rating a puzzle as one grade, a range, a range leaning to one end; clicking again removes it', async () => {
  await writeLog([]);
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => p, () => undefined).run();
  await new Promise(r => setTimeout(r, 20));
  const last = async () => (await readLog()).find(e => e.key === key);
  await dom.grade(2).onclick();
  let e = await last(); eq([e.human, e.lo, e.hi], [2, 2, 2]); ok(e.metrics && Number.isFinite(e.metrics['grade: trap']), 'grades are logged with the rating');
  await dom.grade(3).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [2.5, 2, 3], 'a neighbouring grade makes it "2 or 3"');
  eq(dom.text(), 'Saved: 2 or 3 (used as 2.5)');
  await dom.lean(1).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [2.75, 2, 3]); eq(dom.text(), 'Saved: 2 or 3, close to 3 (used as 2.75)');
  await dom.lean(1).onclick(); e = await last(); eq(e.human, 2.5, 'the lean toggles off');
  await dom.grade(5).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [5, 5, 5], 'a non-neighbour replaces the range');
  await dom.grade(5).onclick(); eq(await last(), undefined, 'the same single grade again removes the rating'); eq(dom.text(), 'Not rated.');
  eq((await readLog()).length, 0);
});
ta('design panel: Export ratings.json downloads the log in the shared format', async () => {
  await writeLog([]);
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  const panel = mountDifficultyPanel(dom.el, () => p, () => undefined); panel.run(); await new Promise(r => setTimeout(r, 20));
  await dom.grade(1).onclick(); await dom.grade(2).onclick(); await dom.lean(-1).onclick(); // 1 or 2, close to 1
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null, name = null;
  globalThis.document = { createElement: () => ({ click() { name = this.download; }, remove() {} }), body: { appendChild() {} } };
  URL.createObjectURL = b => { blob = b; return 'blob:test'; }; URL.revokeObjectURL = () => {};
  try {
    await dom.sel('#diffLogExport').onclick();
    eq(name, 'ratings.json');
    eq(JSON.parse(await blob.text()), [{ key, human: 1.25, lo: 1, hi: 2 }]);
    ok(dom.sel('#diffLogStatus').textContent.startsWith('Exported 1 ratings'), dom.sel('#diffLogStatus').textContent);
  } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
});
ta('design panel: Import ratings.json merges, regrades with the current code, replaces same-puzzle ratings and migrates old header keys', async () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  await writeLog([{ key: serialize(a), human: 4, metrics: { 'grade: trap': 99 } }, { key: 'size 5\ncheckpoints\nwalls', human: 0, metrics: null }]); // old-style key (with # comments) + an unrelated entry
  const dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => a, () => undefined).run(); await new Promise(r => setTimeout(r, 20));
  const file = { text: async () => JSON.stringify([{ key: ka, human: 2.75, lo: 2, hi: 3 }, { key: kb, human: 1, lo: 1, hi: 1 }, { key: 'garbage', human: 1 }]) };
  const input = dom.sel('#diffLogFile'); input.files = [file];
  await input.onchange();
  const log = await readLog();
  eq(log.length, 3, 'a replaced (not duplicated), b added, the unrelated entry kept');
  const ea = log.find(e => e.key === ka), eb = log.find(e => e.key === kb);
  eq([ea.human, ea.lo, ea.hi], [2.75, 2, 3], 'the file wins over the stored rating');
  ok(Number.isFinite(ea.metrics['grade: trap']) && ea.metrics['grade: trap'] !== 99, 'stale grades are recomputed on import');
  ok(eb.metrics && Number.isFinite(eb.metrics['grade: ladder']), 'new puzzle is graded');
  const st = dom.sel('#diffLogStatus').textContent;
  ok(st.startsWith('Imported 2 ratings: 1 new, 1 replaced (1 with a different rating)') && st.includes('1 note(s)'), st);
  await writeLog([]);
});
ta('design panel: unsure flag needs a rating, keeps the rating, is exported and survives import', async () => {
  await resetAll();
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => p, () => undefined).run(); await wait(20);
  await dom.sel('.diff-unsure-btn').onclick(); eq(await readJson(LOG_KEY, []), [], 'nothing to be unsure about before a rating exists');
  await dom.grade(2).onclick(); await dom.grade(3).onclick(); await dom.lean(1).onclick(); // 2 or 3, close to 3 = 2.75
  await dom.sel('.diff-unsure-btn').onclick();
  let e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.lo, e.hi, e.unsure], [2.75, 2, 3, true], 'unsure keeps human/lo/hi'); ok(dom.text().includes('unsure'), dom.text());
  await dom.grade(2).onclick(); e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.lo, e.hi, e.unsure], [2, 2, 2, true], 'changing the grade does not change how sure you are');
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null;
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }; URL.createObjectURL = b => (blob = b, 'blob:t'); URL.revokeObjectURL = () => {};
  try { await dom.sel('#diffLogExport').onclick(); eq(JSON.parse(await blob.text()), [{ key, human: 2, lo: 2, hi: 2, unsure: true }]); } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
  await dom.sel('.diff-unsure-btn').onclick(); e = (await readJson(LOG_KEY, []))[0]; ok(!('unsure' in e), 'sure again: the field disappears');
  await writeLog([]); const dom2 = makePanelDom(); mountDifficultyPanel(dom2.el, () => p, () => undefined).run(); await wait(20);
  const input = dom2.sel('#diffLogFile'); input.files = [{ text: async () => JSON.stringify([{ key, human: 1.5, lo: 1, hi: 2, unsure: true }]) }]; await input.onchange();
  e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.unsure], [1.5, true]); ok(dom2.text().includes('unsure'), 'a rating imported as unsure is shown as unsure: ' + dom2.text());
  await resetAll();
});
ta('design panel: pairwise — compare with the previous puzzle, either orientation, remove, export, import', async () => {
  await resetAll();
  const [A, B] = cachedSamples(), kA = ratingKey(A), kB = ratingKey(B);
  let current = A; const dom = makePanelDom(), panel = mountDifficultyPanel(dom.el, () => current, () => undefined);
  panel.run(); await wait(30);
  ok(dom.sel('.diff-pair-text').textContent.startsWith('No previous puzzle yet'), dom.sel('.diff-pair-text').textContent);
  await dom.pair('harder').onclick(); eq(await readJson(PAIR_LOG, []), [], 'no previous puzzle: nothing recorded');
  current = B; panel.run(); await wait(30);
  ok(dom.sel('.diff-pair-text').textContent.includes('Previous puzzle:') && dom.sel('.diff-pair-text').textContent.includes('Not compared yet'), dom.sel('.diff-pair-text').textContent);
  await dom.pair('harder').onclick();
  let pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); eq([pairs[0].a === kA, pairs[0].b === kB, pairs[0].cmp], [true, true, 'harder'], 'verdict is for the CURRENT puzzle (B) relative to the previous one (A)');
  ok(pairs[0].ma && pairs[0].mb && Number.isFinite(pairs[0].mb['grade: trap']), 'both puzzles\' grades are cached for the agreement table'); ok(dom.sel('.diff-pair-text').textContent.includes('You said this one is harder'));
  panel.run(); await wait(30); ok(dom.sel('.diff-pair-text').textContent.includes('Previous puzzle:') && dom.sel('.diff-pair-text').textContent.includes('harder'), 'recomputing B keeps A as the previous puzzle and shows the saved verdict');
  await dom.pair('easier').onclick(); pairs = await readJson(PAIR_LOG, []); eq([pairs.length, pairs[0].cmp], [1, 'easier'], 'a new verdict replaces the old one');
  await dom.pair('easier').onclick(); eq(await readJson(PAIR_LOG, []), [], 'same verdict again removes the pair');
  await dom.pair('harder').onclick();               // B is harder than A, stored as a=A, b=B
  current = A; panel.run(); await wait(30);         // now A is current and B previous: the stored pair must be read in the other orientation
  ok(dom.sel('.diff-pair-text').textContent.includes('You said this one is easier'), 'B harder than A means A is easier than B: ' + dom.sel('.diff-pair-text').textContent);
  await dom.pair('easier').onclick(); eq(await readJson(PAIR_LOG, []), [], 'clicking the verdict you already gave (seen from the other side) removes it');
  await dom.pair('same').onclick(); pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1, 'the same two puzzles stay ONE pair whichever was previous'); eq([pairs[0].cmp], ['same']);
  await dom.pair('harder').onclick(); pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); eq([pairs[0].a === kB, pairs[0].b === kA, pairs[0].cmp], [true, true, 'harder'], 'A harder than B is stored as a=B, b=A');
  await dom.pair('harder').onclick(); eq(await readJson(PAIR_LOG, []), [], 'repeating the verdict from this side removes the pair stored from the other side');
  await dom.pair('harder').onclick(); pairs = await readJson(PAIR_LOG, []);
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null;
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }; URL.createObjectURL = b => (blob = b, 'blob:t'); URL.revokeObjectURL = () => {};
  try { await dom.sel('#diffPairExport').onclick(); eq(JSON.parse(await blob.text()), [{ a: kB, b: kA, cmp: 'harder' }], 'exported without cached grades'); } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
  await writeJson(PAIR_LOG, []); const dom2 = makePanelDom(); mountDifficultyPanel(dom2.el, () => A, () => undefined).run(); await wait(30);
  const pf = dom2.sel('#diffPairFile'); pf.files = [{ text: async () => JSON.stringify([{ a: kB, b: kA, cmp: 'harder' }, { a: kA, b: kA, cmp: 'same' }]) }]; await pf.onchange();
  pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); ok(pairs[0].ma && pairs[0].mb, 'imported pairs are regraded'); ok(dom2.sel('#diffLogStatus').textContent.startsWith('Imported 1 pairs: 1 new') && dom2.sel('#diffLogStatus').textContent.includes('1 note(s)'), dom2.sel('#diffLogStatus').textContent);
  await resetAll();
});
ta('design panel: a rotated copy of a rated puzzle is flagged while rating; Find duplicates lists the pair and deletes one rating', async () => {
  await resetAll();
  const A = cachedSamples()[0], R = transformPuzzle(A, 5, false); let current = A;
  const dom = makePanelDom(), panel = mountDifficultyPanel(dom.el, () => current, () => undefined);
  panel.run(); await wait(30); await dom.grade(2).onclick();
  current = R; panel.run(); await wait(30);
  ok(dom.sel('.diff-dup-note').textContent.includes('Same puzzle as one you already rated (2)'), 'note: ' + dom.sel('.diff-dup-note').textContent);
  await dom.grade(3).onclick(); eq((await readJson(LOG_KEY, [])).length, 2, 'rating it anyway is allowed (and warned about)');
  await dom.sel('#diffLogDups').onclick();
  const html = dom.sel('#diffDups').innerHTML; ok(html.includes('1 duplicate group') && html.includes('diff-ascii') && (html.match(/diff-dup-del/g) || []).length === 2, html.slice(0, 200));
  await dom.sel('#diffDups').dels[1](); const left = await readJson(LOG_KEY, []);
  eq(left.length, 1, 'one rating deleted'); eq(left[0].human, 2, 'the other one stays'); ok(dom.sel('#diffDups').innerHTML.includes('No duplicates'), dom.sel('#diffDups').innerHTML.slice(0, 120));
  await resetAll();
});
ta('tools/check-ratings.mjs passes on the committed ratings.json and pairs.json (no bad rows, no exact duplicates); equivalent puzzles would be warnings', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../tools/check-ratings.mjs', import.meta.url).pathname, '--no-draw'], { encoding: 'utf8' });
  eq(r.status, 0, 'check-ratings failed:\n' + r.stdout.slice(0, 1500));
  ok(r.stdout.includes('0 error(s)'), r.stdout);
});
t('ratings-io: keyDifference names why a key that parses is still not canonical', () => {
  const p = cachedSamples()[0], k = ratingKey(p);
  eq(keyDifference(k), '', 'canonical keys are fine'); eq(keyDifference('garbage'), '', 'an unparseable key is reported elsewhere');
  ok(keyDifference(serialize(p)).includes('# ...'), 'header comments'); ok(keyDifference(serialize(p, { path: [0, 1] }).split('\n').filter(l => !l.startsWith('#')).join('\n')).includes('path'), 'a path line');
  ok(keyDifference(k.replace(/\n/g, '\r\n')).includes('CRLF'), 'CRLF'); ok(keyDifference(k + '\n').includes('whitespace'), 'trailing newline');
  ok(keyDifference(k.replace('checkpoints ', 'checkpoints   ')).includes('spacing'), 'extra spaces: ' + keyDifference(k.replace('checkpoints ', 'checkpoints   ')));
});
ta('tools/check-ratings.mjs: lists non-canonical keys with the reason; --fix rewrites them, keeps every rating, and refuses when rows would be lost', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), tool = new URL('../tools/check-ratings.mjs', import.meta.url).pathname, f = path.join(dir, 'r.json');
  const run = (...x) => spawnSync(process.execPath, [tool, f, '--pairs', path.join(dir, 'none.json'), '--no-draw', ...x], { encoding: 'utf8' });
  fs.writeFileSync(f, JSON.stringify([{ key: serialize(a), human: 2, lo: 2, hi: 2 }, { key: kb.replace(/\n/g, '\r\n'), human: 3, lo: 2, hi: 3, unsure: true }], null, 1) + '\n');
  let r = run(); eq(r.status, 1); ok(r.stdout.includes('2 of 2 key(s) are not in canonical form') && r.stdout.includes('ratings #1: has "# ..."') && r.stdout.includes('ratings #2: has Windows (CRLF)') && r.stdout.includes('--fix'), r.stdout);
  r = run('--fix'); eq(r.status, 0, r.stdout); const fixed = JSON.parse(fs.readFileSync(f, 'utf8'));
  eq(fixed.map(x => [x.key, x.human, x.lo, x.hi, !!x.unsure]), [[ka, 2, 2, 2, false], [kb, 3, 2, 3, true]], 'canonical keys, every rating and the unsure flag kept, order unchanged');
  eq(run().status, 0, 'clean afterwards');
  fs.writeFileSync(f, JSON.stringify([{ key: ka, human: 2, lo: 2, hi: 2 }, { key: serialize(a), human: 3, lo: 3, hi: 3 }]));
  r = run('--fix'); eq(r.status, 1); ok(r.stdout.includes('--fix refused'), r.stdout); eq(JSON.parse(fs.readFileSync(f, 'utf8')).length, 2, 'nothing was rewritten');
  fs.rmSync(dir, { recursive: true, force: true });
});
ta('tools/parse-ratings.mjs: a "path ..." line after a puzzle block belongs to that block, not to the next comment', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), tool = new URL('../tools/parse-ratings.mjs', import.meta.url).pathname, txt = path.join(dir, 'in.txt'), out = path.join(dir, 'out.json');
  fs.writeFileSync(txt, `human 2\n${serialize(a, { path: [0, 1, 2] })}\n\nhuman 3, range 2-3\n${serialize(b)}\n`);
  const r = spawnSync(process.execPath, [tool, txt, '--out', out], { encoding: 'utf8' }); eq(r.status, 0, r.stderr);
  eq(JSON.parse(fs.readFileSync(out, 'utf8')).map(x => [x.key, x.human, x.lo, x.hi]), [[ka, 2, 2, 2], [kb, 3, 2, 3]]);
  fs.rmSync(dir, { recursive: true, force: true });
});
ta('tools/parse-ratings.mjs: exact duplicates with different ratings stop it (exit 1), same rating warns, equivalent puzzles warn (--strict fails), explicit comments and unsure are read', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), rot = ratingKey(transformPuzzle(a, 5, false));
  const tool = new URL('../tools/parse-ratings.mjs', import.meta.url).pathname, base = path.join(dir, 'base.json'), txt = path.join(dir, 'in.txt'), out = path.join(dir, 'out.json');
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  const run = (text, ...extra) => { fs.writeFileSync(txt, text); return spawnSync(process.execPath, [tool, txt, '--base', base, '--out', out, ...extra], { encoding: 'utf8' }); };
  let r = run(`this is 2\n${ka}\n\nthis is 3\n${ka}\n`); eq(r.status, 1, 'same puzzle, different ratings: error'); ok(r.stderr.includes('LABELS DIFFER') && r.stderr.includes('NOTHING WRITTEN'), r.stderr.slice(0, 300));
  r = run(`human 2\n${ka}\n\nthis is 2\n${ka}\n`); eq(r.status, 0, 'same puzzle, same rating: warning only'); ok(r.stderr.includes('same rating'), r.stderr.slice(0, 300));
  r = run(`human 2\n${ka}\n\nhuman 3, range 2-4, unsure\n${kb}\n`); eq(r.status, 0); eq(JSON.parse(fs.readFileSync(out, 'utf8')).map(x => [x.human, x.lo, x.hi, !!x.unsure]), [[2, 2, 2, false], [3, 2, 4, true]], 'explicit comment with unsure');
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  r = run(`human 2\n${ka}\n\nthis is 2 or 3\n${rot}\n`); eq(r.status, 0, 'equivalent puzzle: warning'); ok(r.stderr.includes('EQUIVALENT') && r.stderr.includes('LABELS DIFFER'), r.stderr.slice(0, 400));
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  r = run(`human 2\n${ka}\n\nthis is 2 or 3\n${rot}\n`, '--strict'); eq(r.status, 1, '--strict fails on equivalents');
  r = run(`human 2\n${ka}\n\nthis is pretty hard\n${kb}\n`); eq(r.status, 1, 'an unreadable comment on a NEW puzzle is an error'); ok(r.stderr.includes('not a rating comment'), r.stderr.slice(0, 300));
  fs.rmSync(dir, { recursive: true, force: true });
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

// ---- Game-of-Day averages: histogram math, backend failover (fake fetch), attempt record ----
t('hist: binOf edges and clamping', () => {
  eq([binOf(1000), binOf(1099), binOf(1100), binOf(1200), binOf(500), binOf(0), binOf(-5)], [0, 0, 1, 1, 0, 0, 0]);
  eq([binOf(2048000), binOf(3600000)], [NB - 1, NB - 1]); ok(binOf(2000000) < NB, 'in range');
  for (let ms = 500; ms <= 3600000; ms = Math.round(ms * 1.37)) ok(binOf(ms) >= binOf(ms - 1), 'monotonic');
});
t('hist: summarize exact mean, percentile (mid-rank of own bin), top-10 only when n > 10', () => {
  eq(summarize({ n: 4, sum: 100000, below: 2, cnt: 1, best: [10000, 20000, 30000, 40000] }), { n: 4, mean: 25, top: null, pct: 33 }); // beat 1 of 3 others
  eq(summarize({ n: 1, sum: 42130, below: 0, cnt: 1, best: [42130] }), { n: 1, mean: 42.13, top: null, pct: null });
  eq(summarize({ n: 5, sum: 50000, below: 0, cnt: 5, best: [1, 1, 1, 1, 1] }).pct, 50); // all in one bin: half of the others
  eq(summarize({ n: 11, sum: 110000, below: 0, cnt: 1, best: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] }).pct, 100);
  const s = summarize({ n: 11, sum: 110000, below: 10, cnt: 1, best: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] });
  eq([s.top, s.pct, s.mean], [5.5, 0, 10]);
  for (const bad of [null, {}, { n: 0, sum: 0, below: 0, cnt: 1, best: [] }, { n: 2, sum: 1, below: 2, cnt: 1, best: [] }, { n: 2, sum: 1, below: 0, cnt: 0, best: [] },
    { n: 2, sum: -1, below: 0, cnt: 1, best: [] }, { n: 2, sum: 1, below: 0, cnt: 1, best: 'x' }, { n: 2, sum: 1, below: 0, cnt: 1, best: new Array(TOP_K + 1).fill(1) }, { n: 2.5, sum: 1, below: 0, cnt: 1, best: [] }]) eq(summarize(bad), null, JSON.stringify(bad));
});
t('hints: 180 s penalty per hint', () => { eq(HINT_PENALTY_S, 180); eq([penalizedTime(42.5, 0), penalizedTime(42.5, 1), penalizedTime(42.5, 3)], [42.5, 222.5, 582.5]); });
t('hist: statsLine', () => {
  eq(statsLine({ n: 812, mean: 61.34, top: 33.04, pct: 78 }), 'Everyone: 61.3s avg · Top 10: 33.0s avg · You beat 78%');
  eq(statsLine({ n: 812, mean: 61.34, top: 33.04, pct: 78 }, true), 'Everyone: 61.3s avg (812 players) · Top 10: 33.0s avg · You beat 78%');
  eq(statsLine({ n: 1, mean: 42.13, top: null, pct: null }), 'Everyone: 42.1s avg');
  eq(statsLine({ n: 1, mean: 42.13, top: null, pct: null }, true), 'Everyone: 42.1s avg (1 player)');
  eq(statsLine({ n: 2, mean: 28.5, top: null, pct: 100 }), 'Everyone: 28.5s avg · You beat 100%');
});
t('leaderboard: backendsFromConfig skips unconfigured, keeps order, moves ?lb= first', () => {
  const cfg = { order: ['cloudflare', 'supabase'], cloudflare: { url: 'https://w' }, supabase: { url: 'https://s', key: 'k' } };
  eq(backendsFromConfig(cfg).map(b => b.name), ['cloudflare', 'supabase']);
  eq(backendsFromConfig(cfg, 'supabase').map(b => b.name), ['supabase', 'cloudflare']);
  eq(backendsFromConfig(cfg, 'nope').map(b => b.name), ['cloudflare', 'supabase']);
  eq(backendsFromConfig({ ...cfg, supabase: { url: 'https://s', key: '' } }).map(b => b.name), ['cloudflare']);
  eq(backendsFromConfig({ ...cfg, cloudflare: { url: '' } }, 'cloudflare').map(b => b.name), ['supabase']);
  eq(backendsFromConfig({ ...cfg, cloudflare: { url: '' }, supabase: { url: '' } }), []);
  eq(createLeaderboard([]).enabled, false);
});
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const GOOD = { n: 3, sum: 90000, below: 1, cnt: 1, best: [10000, 30000, 50000] };
const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
const CF = { url: 'https://w.example/' }, SB = { url: 'https://s.example', key: 'anon-key' };
const both = f => createLeaderboard([cloudflareBackend(CF), supabaseBackend(SB)], { fetchFn: f, timeoutMs: 20 });
ta('leaderboard: request shapes (cloudflare text/plain no preflight; supabase rpc + apikey) and summary', async () => {
  const calls = []; const f = async (url, init) => { calls.push([url, init]); return reply(200, GOOD); };
  const r = await both(f).submit('20260929', 42.13);
  eq([r.status, r.backend, r.summary], ['ok', 'cloudflare', { n: 3, mean: 30, top: null, pct: 50 }]);
  eq(calls.length, 1); eq(calls[0][0], 'https://w.example/gotd'); eq(calls[0][1].headers, { 'Content-Type': 'text/plain;charset=UTF-8' });
  eq(JSON.parse(calls[0][1].body), { d: 20260929, t: 42130, b: binOf(42130) });
  const g = []; await createLeaderboard([supabaseBackend(SB)], { fetchFn: async (u, i) => { g.push([u, i]); return reply(200, GOOD); } }).submit('20260929', 42.13);
  eq(g[0][0], 'https://s.example/rest/v1/rpc/submit_gotd'); eq(g[0][1].headers, { 'Content-Type': 'application/json', apikey: 'anon-key' });
  eq(JSON.parse(g[0][1].body), { p_day: 20260929, p_ms: 42130, p_bin: binOf(42130) });
});
ta('leaderboard: fails over on 5xx, 404, network error, timeout and malformed reply', async () => {
  for (const first of [async () => reply(503, {}), async () => reply(404, {}), async () => { throw new TypeError('network'); }, hang, async () => reply(200, { n: 'x' }), async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })]) {
    const urls = []; const r = await both((u, i) => { urls.push(u); return u.includes('w.example') ? first(u, i) : reply(200, GOOD); }).submit('20260929', 30);
    eq([r.status, r.backend, urls.length], ['ok', 'supabase', 2]);
  }
});
ta('leaderboard: 400/422 = rejected without failover; all down = failed; out-of-range time = skipped, nothing sent', async () => {
  for (const code of [400, 422]) { let n = 0; const r = await both(async () => { n++; return reply(code, {}); }).submit('20260929', 30); eq([r.status, n], ['rejected', 1]); }
  let n = 0; eq((await both(async () => { n++; return reply(500, {}); }).submit('20260929', 30)).status, 'failed'); eq(n, 2);
  n = 0; eq((await both(hang).submit('20260929', 30)).status, 'failed');
  for (const sec of [0.4, 3601, NaN]) { let sent = 0; eq((await both(async () => { sent++; return reply(200, GOOD); }).submit('20260929', sec)).status, 'skipped'); eq(sent, 0); }
});
ta('stats-store: pending GOTD attempt is sent:false; saving stats persists and survives hydrate', async () => {
  const st = fakeStorage(), S = createStore(st, [5]); await S.hydrate('20260929');
  await S.recordGotd(5, '20260929', 42.1, true); eq(S.attempt(), { solved: true, time: 42.1, sent: false });
  await S.saveAttempt('20260929', { solved: true, time: 42.1, sent: true, stats: { n: 3, mean: 30, top: null, pct: 50 } });
  const S2 = createStore(st, [5]); await S2.hydrate('20260929'); eq(S2.attempt(), { solved: true, time: 42.1, sent: true, stats: { n: 3, mean: 30, top: null, pct: 50 } });
  const S3 = createStore(fakeStorage(), [5]); await S3.hydrate('20260929'); await S3.recordGotd(5, '20260929', 42.1); eq(S3.attempt(), { solved: true, time: 42.1 });
});

for (const [name, fn] of pending) { const t0 = Date.now(); try { await fn(); pass++; out.push(`ok    ${name} (${Date.now() - t0}ms)`); } catch (e) { fail++; out.push(`FAIL  ${name}: ${e.message}`); } }
const text = out.join('\n') + `\n\n${pass} passed, ${fail} failed`;
if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; } else { console.log(text); if (fail) process.exit(1); }
