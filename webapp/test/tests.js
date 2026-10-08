// Runs in the browser (open test/index.html via a local server) and in Node (node test/tests.js). No dependencies.
import { makePuzzle, clonePuzzle, validate, maxNumber, ALGO_VERSION, endCell, checkpointCells } from '../src/core/model.js';
import { edgeId, edgeCells, allEdges, edgeToKey, keyToEdge, setWallId, hasWallId, wallCount, wallIds } from '../src/core/edges.js';
import { serialize, parse, commentTimes } from '../src/core/format.js';
import { makeRng, dailySeed, hashStr, shuffle } from '../src/core/rng.js';
import { newStat, updateStat, statSummary } from '../src/core/stats.js';
import { solve } from '../src/core/solver/solve.js';
import { isSolved, step } from '../src/core/rules.js';
import { boardConnectivity, boardLegCollide } from '../src/core/connectivity.js';
import { arrowSegment } from '../src/view/geometry.js';
import { buildNeighbors, makeNoDeadEnd, forcedEdges, legsCollide, legConflicts, segBlocker } from '../src/core/solver/prune.js';
import { makePropagator } from '../src/core/solver/propagate.js';
import { makeIncremental } from '../src/core/solver/incremental.js';
import { generate, generateUnique, randomPathPuzzle, pickK, PLAY_SIZES, tryGenerate, PROP_CAP_X } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { encodeFlags, decodeFlags, flagsToHex, hexToFlags, DEFAULT_FLAGS_INT, DEFAULT_GEN_FLAGS, DEFAULT_MINIMIZE_FLAGS, PLAY_FLAGS_INT } from '../src/core/gen/flags.js';
import { minimizeWalls, makeUnique, refineWalls, minimizeFully, REFINE_CAP_X } from '../src/core/gen/walls.js';
import { runSync } from '../src/core/run.js';
import { runAsync, measured } from '../src/platform/run.js';
import { createHoldReveal } from '../src/ui/hold-reveal.js';
import { createDaily, utcDayNumber, utcDateString, dateOfDay, fetchGameOfDayFor } from '../src/features/daily.js';
import { createReplay, GAMES_PER_CHANCE, BACKFILL_DAYS } from '../src/features/replay.js';
import { REPLAY_DAYS } from '../src/core/hist.js';
import { EN, ZH, t as tr } from '../src/ui/i18n.js';
import { HINT_PENALTY_S, penalizedTime } from '../src/features/hints.js';
import { createStore } from '../src/features/stats-store.js';
import { newTrace, traceStep, traceClear, buildRecord, createPlayLog, PLAYLOG_KEY } from '../src/features/playlog.js';
import { encodeShare, decodeShare, SHARE_VERSION, MAX_LEGS } from '../src/core/share-code.js';
import { levelOf, legsUndo, legLevels, stripText, dayOfDate, makeShareRecord, shareUrl, parseShareLink, shareText, shareStatus, isPlayable, LEVEL_EMOJI } from '../src/features/share.js';
import { NB, TOP_K, binOf, summarize, statsLine } from '../src/core/hist.js';
import { parseDays, mergeDays, combineDays, isReplicated } from '../src/core/stats-merge.js';
import { wls, fitCandidate, predictH, dedupe, isMonotone, selectEntries, pickEntries, fitTime, predictMs, withoutSeeds, TIME_PRIOR, invert, floorMs, needsThinking, aboveFloor, EXTRA_MIN_SKILL, timePoints, playPoints, fitTimeSize, sizeShift, sizeLevel, localDifficulty, globalDifficulty, localFromGlobal } from '../src/core/gotd-model.js';
import { barsSvg, linesSvg, histSvg, scatterSvg } from '../src/apps/stats/charts.js';
import { fetchStats } from '../src/platform/stats-client.js';
import { createLeaderboard, backendsFromConfig, cloudflareBackend, supabaseBackend, tursoBackend, afterSubmit, submitAttempt, MAX_ROUNDS } from '../src/platform/leaderboard.js';
import { GOLDEN } from './golden.js';
import { metricsFor, referenceSolve, backtrackOverhead, gradeOf, refNodeCap, REF_FLAGS } from '../src/core/difficulty.js';
import { calibrate, calibrateAll, calibrateMetric, generateAtDifficulty, DEFAULT_THRESHOLDS, DEFAULT_THRESHOLDS_BY_METRIC, GRADED_METRICS, QUANTILES } from '../src/core/gen/calibration.js';
import { checkpointPositions, segmentCrossCount, segmentOverlapCount, spatialMetrics } from '../src/core/spatial.js';
import { gradesFor, gradesFromMetrics, playGradesFor, GRADE_ORDER } from '../src/core/grades.js';
import { combinedScore, COMBINED_ZSCORE } from '../src/core/gen/calibration.js';
import { solutionPath, trapProfile, trapMetrics, trapGradeOf, trapPredict, capGradeBySize, SIZE_GRADE_CAP, ladderTrials, TRAP_CFG, TRAP_MODEL } from '../src/core/trap.js';
import { generateTargeted, targetBand, maxTargetGrade, missOf, proposalBudget, TARGET_CFG } from '../src/core/gen/target.js';
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
t('format: time comments — only the given times, in a fixed order, ignored by parse, none by default', () => {
  const p = makePuzzle(3);
  p.cp[0] = 1;
  p.cp[8] = 9;
  const plain = serialize(p);
  eq(plain.includes('_time_'), false, 'no times option -> no time lines');
  eq(serialize(p, { times: {} }), plain, 'empty times -> identical to plain');
  eq(serialize(p, { times: { generateMs: null, solveMs: null, playS: null } }), plain, 'null times are skipped');

  const all = serialize(p, { times: { generateMs: 12.345, solveMs: 0.04, playS: 83.25 } });
  const lines = all.split('\n');
  eq(lines.filter(l => l.includes('_time_')), ['# generate_time_ms 12.3', '# solve_time_ms 0.0', '# play_time_s 83.3'], 'one comment line per time: ms or s with one decimal');
  const firstTime = lines.findIndex(l => l.includes('_time_'));
  eq(lines.findIndex(l => l.startsWith('size ')) > firstTime, true, 'time comments come before the data lines');
  eq(lines.slice(firstTime).filter(l => l.startsWith('#')).length, 3, 'nothing but the three comments between');

  eq(serialize(parse(all)), plain, 'parse skips the comments: round trip gives the plain text');
  eq(serialize(p, { times: { solveMs: 5 } }).split('\n').filter(l => l.includes('_time_')), ['# solve_time_ms 5.0'], 'a single time');
  const withPath = serialize(p, { path: [0, 1, 2, 5, 4, 3, 6, 7, 8], times: { playS: 1 } });
  eq(parse(withPath).path, [0, 1, 2, 5, 4, 3, 6, 7, 8], 'times and a path line together still parse');
});
t('run: measured() passes events and the return value through and clocks only the generator’s own compute time', () => {
  const burn = ms => {
    const end = performance.now() + ms;
    while (performance.now() < end) { /* busy wait */ }
  };
  function* work() {
    yield { frac: 0.1 };
    burn(8);
    yield undefined;
    burn(8);
    yield { frac: 1 };
    burn(8);
    return 'done';
  }
  const clock = { ms: 0 };
  const seen = [];
  const result = runSync(measured(work(), clock), e => {
    seen.push(e);
    burn(40); // consumer-side work (UI updates in the app) must not be counted
  });
  eq(result, 'done');
  eq(seen, [{ frac: 0.1 }, { frac: 1 }], 'falsy events are dropped by runSync as before; others arrive unchanged');
  ok(clock.ms >= 24, `clock counts the 3 x 8 ms of compute (got ${clock.ms.toFixed(1)})`);
  ok(clock.ms < 24 + 40, `clock excludes the consumer's 2 x 40 ms (got ${clock.ms.toFixed(1)})`);
});
t('run: measured() works under runAsync (time-sliced, setTimeout yields) and propagates errors', async () => {
  const clock = { ms: 0 };
  const events = [];
  const value = await runAsync(measured(generate(5, 3), clock), { onEvent: e => events.push(e), sliceMs: 1 });
  eq(serialize(value), serialize(runSync(generate(5, 3))), 'same puzzle as the plain run');
  ok(clock.ms > 0, 'some compute time was clocked');
  ok(events.length > 0, 'progress events still reach onEvent');
  function* boom() {
    yield { frac: 0 };
    throw new Error('boom');
  }
  let message = null;
  try {
    await runAsync(measured(boom(), { ms: 0 }));
  } catch (e) {
    message = e.message;
  }
  eq(message, 'boom');
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
t('forcedEdges / propagation: dropping the edge that would close a forced chain into a cycle', () => {
  // 4x4, start (0,1), checkpoint 2 at (0,0), end (3,2), no walls, head on the start cell. The
  // corner cells force their two edges each. Two of the resulting chains end on neighbouring
  // cells ((1,2)-(1,3) and (2,0)-(2,1)): joining those ends would close a 4-cycle, so the new rule
  // drops both edges. That cascades until the centre cell (1,1) has fewer than 2 open edges. The
  // degree and cycle rules alone leave this position open. An exhaustive search (no prunes)
  // confirms there is no completion.
  const p = parse('size 4\ncheckpoints 0,0=2 0,1=1 3,2=3\nwalls');
  const { nb, T } = buildNeighbors(p);
  const start = p.cp.indexOf(1), end = p.cp.indexOf(3);
  const vis = new Uint8Array(T);
  vis[start] = 1;
  eq(solve(p, { limit: 1, nodeCap: 1e6 }).count, 0, 'sanity: no solution exists');
  eq(forcedEdges(nb, T, vis, start, end).infeasible, true);
  eq(solve(p, { limit: 1, nodeCap: 1e6, prop: true }).nodes, 1, 'prop refutes it at the root');
});
t('forcedEdges: sound on random positions, and whenever it says infeasible the prop solver refutes the same prefix', () => {
  let checked = 0, flagged = 0;
  for (let s = 1; s <= 600; s++) {
    const n = 3 + (s % 3), p = randPuzzle(s * 77 + 5, n, 2 + (s % 3), 0.15 * (s % 4));
    const K = Math.max(...p.cp), end = p.cp.indexOf(K), { nb, T } = buildNeighbors(p);
    const rnd = makeRng(s);
    const prefix = [p.cp.indexOf(1)];
    const vis = new Uint8Array(T);
    vis[prefix[0]] = 1;
    let need = 2;
    const len = 1 + Math.floor(rnd() * Math.min(6, T - 2));
    for (let i = 1; i < len; i++) {
      const h = prefix[prefix.length - 1], opts = [];
      for (let d = 0; d < 4; d++) { const v = nb[h * 4 + d]; if (v >= 0 && !vis[v] && (!p.cp[v] || p.cp[v] === need)) opts.push(v); }
      if (!opts.length) break;
      const v = opts[Math.floor(rnd() * opts.length)];
      vis[v] = 1; prefix.push(v); if (p.cp[v]) need++;
    }
    const head = prefix[prefix.length - 1];
    if (head === end) continue;
    checked++;
    const r = forcedEdges(nb, T, vis, head, end);
    if (!r.infeasible) continue;
    flagged++;
    const truth = solve(p, { limit: 1, nodeCap: 1e6, forced: prefix });
    eq(truth.count, 0, `forcedEdges infeasible but a completion exists: seed ${s}`);
    const withProp = solve(p, { limit: 1, nodeCap: 1e6, forced: prefix, prop: true });
    eq(withProp.count, 0);
    ok(withProp.subNodes <= 1, `prop solver did not refute the prefix at once: seed ${s}, subNodes ${withProp.subNodes}`);
  }
  ok(checked > 400, `expected many positions, got ${checked}`);
  ok(flagged > 20, `expected some infeasible positions, got ${flagged}`);
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
t('generate: ALGO_VERSION 6 golden puzzles cover every play size below 16 and are valid and unique', () => {
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
  // the default per-pass caps are the documented ones
  eq(REFINE_CAP_X, [8, 32, 128]);
});

t('generate(): the deeper look at undecided walls never adds walls to the winner and keeps it valid and unique with every kept wall needed', () => {
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

// ---- solver speedups: fast path, local connectivity, mustUse, freedEdge, bound ----

t('solver: incremental prop, fast path and local connectivity change nothing but speed (nodes, count, paths, DFS order, decision counters)', () => {
  let cmp = 0;
  const REF = { incr: false, fast: false, lconn: false }; // the from-scratch propagation and plain flood fill
  const same = (p, extra, limit, label) => {
    const o = { ...extra, limit, nodeCap: 20000, capture: true, decisions: true };
    const a = solve(p, { ...o, ...REF });
    for (const mode of [{}, { incr: false }]) {
      const b = solve(p, { ...o, ...mode });
      eq([b.nodes, b.count, b.exceeded, b.paths, b.decisionNodes, b.maxDecisionDepth], [a.nodes, a.count, a.exceeded, a.paths, a.decisionNodes, a.maxDecisionDepth], `${label} ${JSON.stringify(mode)}`); cmp++;
    }
  };
  for (let s = 1; s <= 60; s++) {
    const n = 4 + (s % 6), p = randPuzzle(s, n, 3 + (s % 5), 0.05 * (s % 9));
    for (const extra of [{}, { prop: true }, { prop: true, pocket: true }, { prop: true, seg: true, parity: true }]) for (const limit of [2, 1e9]) same(p, extra, limit, `random ${s} ${JSON.stringify(extra)} limit ${limit}`);
  }
  // the states the generator really searches: a unique puzzle with each wall freed in turn
  for (const p of cachedSamples()) for (const w of allEdges(p.n).filter(e => hasWallId(p.walls, e)).slice(0, 14)) {
    const q = clonePuzzle(p); setWallId(q.walls, w, false);
    same(q, { prop: true }, 2, `freed wall ${w} of n=${p.n}`);
    const [x, y] = edgeCells(p.n, w);
    same(q, { prop: true, mustUse: [x, y] }, 1, `freed wall ${w} of n=${p.n} mustUse`);
  }
  ok(cmp >= 900, 'compared ' + cmp);
});

t('incremental propagation: after every move, undo and redo, the state equals propagate.js deduce() from scratch (the play-mode overlay engine)', () => {
  let states = 0, infeasible = 0;
  // solvable puzzles: the generated samples as they are, and with every second wall freed (many more branches)
  const boards = []; cachedSamples().forEach((q, i) => { boards.push(q); const f = clonePuzzle(q); allEdges(q.n).filter(w => hasWallId(q.walls, w)).forEach((w, j) => { if ((i + j) % 2 === 0) setWallId(f.walls, w, false); }); boards.push(f); });
  ok(boards.length >= 4, 'boards ' + boards.length);
  for (const [bi, p] of boards.entries()) for (const seed of [1, 2, 3]) {
    const n = p.n, wallFrac = 0, T = n * n, { nb } = buildNeighbors(p);
    const start = p.cp.indexOf(1), end = p.cp.indexOf(maxNumber(p));
    const vis = new Uint8Array(T), one = makePropagator(nb, T, end, vis), inc = makeIncremental(nb, T, end, vis);
    const ul = new Int32Array(T), vm = new Uint8Array(T), rnd = makeRng(bi * 10 + seed);
    const scratch = (cur, count) => { // deduce() from scratch for the current path
      let un = 0; vm.fill(0);
      for (let c = 0; c < T; c++) { if (!vis[c]) ul[un++] = c; else for (let d = 0; d < 4; d++) { const x = nb[c * 4 + d]; if (x >= 0) vm[x] |= 1 << (d ^ 1); } }
      return one.deduce(cur, count, ul, un, vm);
    };
    const agree = (cur, count, okInc, label) => {
      const okOne = scratch(cur, count);
      eq(okInc, okOne, `${label}: feasibility`); states++;
      if (!okOne) { infeasible++; return; }
      for (let u = 0; u < T; u++) if (!vis[u] || u === cur) eq([inc.S[u], inc.forcedBits(u)], [one.av[u], one.fr[u]], `${label}: cell ${u}`);
    };
    for (let walk = 0; walk < 8; walk++) {
      vis.fill(0); let cur = start, count = 1; vis[cur] = 1;
      let live = inc.init(cur, count); agree(cur, count, live, 'root');
      const trail = [];
      for (let s = 0; s < T - 1 && live; s++) {
        const cands = []; for (let d = 0; d < 4; d++) { const x = nb[cur * 4 + d]; if (x >= 0 && !vis[x] && ((inc.S[cur] >> d) & 1)) cands.push(x); }
        if (!cands.length) break;
        const next = cands[Math.floor(rnd() * cands.length)], mark = inc.mark(), prev = cur;
        vis[next] = 1; count++; cur = next;
        live = inc.step(prev, cur, count); agree(cur, count, live, `walk ${walk} step ${s}`);
        trail.push({ mark, prev, cur, count });
        if (live && rnd() < 0.3) { // back out of that move: the parent's state must come back exactly
          const f = trail.pop(); inc.undo(f.mark, f.prev); vis[f.cur] = 0; cur = f.prev; count = f.count - 1;
          agree(cur, count, scratch(cur, count), `walk ${walk} undo ${s}`);
        }
      }
    }
  }
  ok(states > 1500 && infeasible < states, 'compared ' + states + ' states, ' + infeasible + ' infeasible');
});

t('solver: mustUse finds exactly the solutions that walk the edge (all flag sets)', () => {
  let cmp = 0;
  for (let s = 1; s <= 60; s++) {
    const n = 3 + (s % 3), p = randPuzzle(s, n, 2 + (s % 3), 0.04 * (s % 6));
    const all = solve(p, { limit: 1e9, nodeCap: 1e7, capture: true });
    ok(!all.exceeded);
    for (const e of allEdges(n)) {
      if (hasWallId(p.walls, e)) continue;
      const [a, b] = edgeCells(n, e);
      const want = all.paths.filter(w => w.some((c, i) => i > 0 && ((w[i - 1] === a && c === b) || (w[i - 1] === b && c === a)))).map(String);
      for (const extra of [{}, { prop: true }, { prop: true, pocket: true, parity: true }, { prop: true, legCollide: true }]) {
        const r = solve(p, { ...extra, limit: 1e9, nodeCap: 1e7, capture: true, mustUse: [a, b] });
        ok(!r.exceeded); eq(r.paths.map(String), want, `case ${s} edge ${e} ${JSON.stringify(extra)}`); cmp++;
      }
    }
  }
  ok(cmp > 1000, 'compared ' + cmp);
});

t('flags: the freedEdge bit (minimize phase) round-trips, and every integer made before it still decodes to the same objects', () => {
  // pinned: the design app's default flags and the play app's seed tag (generate() and the design app use the freedEdge minimize check)
  eq(DEFAULT_FLAGS_INT, 0x1018101); eq(flagsToHex(PLAY_FLAGS_INT), '0x18101');
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

t('forcedEdges: a path that already ran through the end cell is reported infeasible (design app free play)', () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[1] = 2; // start 0, end 1
  const { nb } = buildNeighbors(p), vis = new Uint8Array(9); [0, 1, 2].forEach(c => { vis[c] = 1; });
  eq(forcedEdges(nb, 9, vis, 2, 1).infeasible, true);
  eq(forcedEdges(nb, 9, vis, 1, 1).infeasible, false); // head on the end: nothing to deduce, as before
});


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
t('difficulty: a larger node cap only un-truncates — metrics that finished under the default cap are identical', () => {
  // Tools raise the cap (tools/lib.mjs evalCap) so every rated puzzle gets real metrics instead of lower bounds.
  for (const p of sampleUniquePuzzles()) {
    const cap = refNodeCap(p.n), m = metricsFor(p, cap), big = metricsFor(p, cap * 10);
    ok(!big.exceeded || m.exceeded, 'a larger cap never turns a finished solve into a capped one');
    if (!m.exceeded) for (const k of ['nodes', 'decisionNodes', 'maxDecisionDepth', 'B', 'unique']) eq(big[k], m[k]);
  }
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
  const c = TRAP_MODEL.cuts;
  ok(Array.isArray(c) && c.length === 5 && c.every(Number.isFinite) && c.every((v, i) => !i || v > c[i - 1]), 'cuts = 5 strictly increasing score thresholds');
  const a = f.looAnchors;
  ok(a && ['easy', 'hard3', 'hard4'].every(k => Array.isArray(a[k]) && a[k].length === 2 && a[k][0] <= a[k][1]), 'fit.looAnchors = { easy, hard3, hard4 } as [hits, total]');
});
t('playlog: a trace counts cells drawn and taken back, with the real rules; pushes - undone = cells left on the board', () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[8] = 2;
  const path = [], tr = newTrace(), mv = c => { const b = path.length, k = step(p, path, c, { truncate: true }); traceStep(tr, k, b, path.length); return k; };
  eq([0, 1, 2, 5].map(mv), ['push', 'push', 'push', 'push']);
  eq(mv(2), 'pop', 'one-step undo');
  eq([5, 4, 3].map(mv), ['push', 'push', 'push']);
  eq(mv(1), 'trunc', 'cut back to an earlier cell');
  eq(mv(8), null, 'a blocked move is not counted');
  eq({ pushes: tr.pushes, undone: tr.undone, maxUndone: tr.maxUndone, backtracks: tr.backtracks, resets: tr.resets }, { pushes: 7, undone: 5, maxUndone: 4, backtracks: 2, resets: 0 });
  eq(tr.pushes - tr.undone, path.length, 'pushes - undone = cells on the board');
  traceClear(tr, path.length);
  eq([tr.resets, tr.undone, tr.backtracks], [1, 7, 3], 'the reset button takes back everything drawn');
  traceClear(tr, 0); eq(tr.resets, 1, 'resetting an empty path counts nothing');
});
t('playlog: consecutive one-step undos are one take-back action; maxUndone is the deepest one', () => {
  const tr = newTrace();
  for (let i = 0; i < 6; i++) traceStep(tr, 'push', i, i + 1);
  for (let i = 0; i < 3; i++) traceStep(tr, 'pop', 6 - i, 5 - i); // one run of 3
  traceStep(tr, 'push', 3, 4); traceStep(tr, 'pop', 4, 3);        // a second run of 1
  eq([tr.backtracks, tr.undone, tr.maxUndone], [2, 4, 3]);
});
ta('playlog: records keep the puzzle text, raw time and counts; the stored list is capped, survives a reload and a corrupt value', async () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[8] = 2;
  const tr = newTrace(); traceStep(tr, 'push', 0, 1);
  const rec = buildRecord(p, tr, { ms: 12345.6, solved: true, hints: 1, mode: 'gotd', at: 7 });
  eq([rec.n, rec.ms, rec.solved, rec.hints, rec.mode, rec.pushes, rec.at], [3, 12346, true, 1, 'gotd', 1, 7]);
  eq(serialize(parse(rec.key)), serialize(p), 'the key is the puzzle text the ratings and tools use');
  const st = fakeStorage(), log = createPlayLog(st, 2);
  await Promise.all([log.add({ id: 1 }), log.add({ id: 2 }), log.add({ id: 3 })]);
  eq((await log.all()).map(r => r.id), [2, 3], 'concurrent adds are all kept, then the oldest is dropped past the cap');
  eq((await createPlayLog(st, 2).all()).map(r => r.id), [2, 3], 'a new log object reads the same list back');
  eq(JSON.parse(await log.exportJson()).length, 2, 'export is the JSON list');
  await st.set(PLAYLOG_KEY, '{not json');
  eq(await createPlayLog(st).all(), [], 'a corrupt value reads as an empty log');
});
ta('playlog-eval: runs end to end on a small play log and prints the metrics and the badge table', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const rated = JSON.parse(fs.readFileSync(new URL('../tools/ratings.json', import.meta.url))).filter(r => parse(r.key).n <= 6).slice(0, 6);
  ok(rated.length >= 4, 'the ratings hold enough small puzzles for the smoke test');
  const recs = rated.flatMap((r, i) => [0, 1].map(k => { const p = parse(r.key), T = p.n * p.n; return { v: 1, key: r.key, n: p.n, ms: 4000 + 900 * i + 300 * k, solved: true, hints: 0, mode: 'local', pushes: T + i, undone: i, maxUndone: i, backtracks: i ? 1 : 0, resets: 0, at: i * 2 + k + 1 }; }));
  recs.push({ ...recs[0], solved: false, at: 99 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlog-')), f = path.join(dir, 'playlog.json'); fs.writeFileSync(f, JSON.stringify(recs));
  const r = spawnSync(process.execPath, [new URL('../tools/playlog-eval.mjs', import.meta.url).pathname, f, '--cap', '20000', '--min-solved', '5'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(r.status, 0, r.stderr);
  ok(r.stdout.includes(`${recs.length} records`) && r.stdout.includes('1 abandoned') && r.stdout.includes('grade:trap') && r.stdout.includes('by Play badge'), r.stdout.slice(0, 400));
  ok(!/NaN|undefined/.test(r.stdout.replace(/—/g, '')), 'no NaN/undefined in the output');
});
t('trap: grade = number of cuts reached; no cuts = the old round(); size caps apply on top', () => {
  const cuts = { cuts: [1, 2, 3, 4, 5] };
  eq([-3, 0.99, 1, 2.5, 4.99, 5, 9].map(v => trapGradeOf(v, cuts)), [0, 0, 1, 2, 4, 5, 5], 'count of cuts <= score, clamped 0..5');
  eq([-3, 0.4, 0.5, 2.49, 5.4, 9].map(v => trapGradeOf(v, {})), [0, 0, 1, 2, 5, 5], 'a model without cuts rounds, as before');
  eq([[5, 5], [5, 1], [6, 5], [6, 3], [7, 5], [11, 5]].map(([n, g]) => capGradeBySize(g, n)), [SIZE_GRADE_CAP[5], 1, SIZE_GRADE_CAP[6], 3, 5, 5], '5x5 <= 2, 6x6 <= 3, larger sizes uncapped');
  ok(SIZE_GRADE_CAP[5] === 2 && SIZE_GRADE_CAP[6] === 3, 'the agreed caps');
});
t('trap: lTr = log(1 + ladder trials), capped by TRAP_CFG.ladderWorkCap, is part of the model and of every result', () => {
  ok(TRAP_MODEL.features.includes('lTr'), 'the model uses lTr');
  const p = makePuzzle(5); // any solvable board: 1 at the start, 2 at the end
  p.cp[0] = 1; p.cp[24] = 2;
  const m = trapMetrics(p);
  ok(m.ok && Number.isInteger(m.ladTrials) && m.ladTrials >= 0, 'ladTrials is a count');
  ok(Math.abs(m.lTr - Math.log1p(m.ladTrials)) < 1e-12, 'lTr = log1p(ladTrials)');
  eq(ladderTrials(p), m.ladTrials, 'ladderTrials() gives the same count');
  ok(m.grade <= SIZE_GRADE_CAP[5], 'a 5x5 stays at or below its cap');
  ok(m.gradeUncapped >= m.grade, 'the cap only lowers');
});
// The design panel is DOM code, but its HTML building is plain string work: run the real "Compute diagnostics" path against a
// minimal fake element. (A missing TRAP_MODEL.fit once threw here, in the browser only, because nothing rendered the panel.)
function renderDiagnostics(p) {
  const el = { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    querySelectorAll: () => [], querySelector() { return { style: {}, dataset: {}, textContent: '', innerHTML: '', classList: { toggle() {}, add() {}, remove() {} }, set onclick(f) {}, querySelectorAll: () => [] }; } };
  mountDifficultyPanel(el, () => p, () => undefined).run();
  return el._html;
}
// ---- targeted generation (core/gen/target.js): written against the CURRENT trap model, so a refit (fit-trap.mjs --write) needs no edit here ----
t('target: the band of a grade is read from the model cuts; open at both ends; the size cap makes a lower grade the top one', () => {
  const m = { cuts: [1, 2, 3, 4, 5] }; // spacing 1, margin 0.15
  const b0 = targetBand(0, 9, m), b2 = targetBand(2, 9, m), b5 = targetBand(5, 9, m);
  eq([b0.lo, b0.hi, b0.a, b0.b], [-Infinity, 1, -Infinity, 0.85]);
  eq([b2.lo, b2.hi, b2.a, b2.b].map(x => +x.toFixed(2)), [2, 3, 2.15, 2.85]);
  eq([b5.lo, b5.hi, b5.a, b5.b].map(x => +x.toFixed(2)), [5, Infinity, 5.15, Infinity]);
  eq([maxTargetGrade(5, m), maxTargetGrade(6, m), maxTargetGrade(9, m), maxTargetGrade(9, {})], [SIZE_GRADE_CAP[5], SIZE_GRADE_CAP[6], 5, 5]);
  const c5 = targetBand(5, 5, m); // a 5x5 never shows more than SIZE_GRADE_CAP[5], so that grade is open above
  eq([c5.grade, c5.hi], [SIZE_GRADE_CAP[5], Infinity]);
  const narrow = targetBand(1, 9, { cuts: [1, 1.1, 3, 4, 5] }); // a fitted band thinner than the margin shrinks it to 30% per side
  eq([narrow.a, narrow.b].map(x => +x.toFixed(2)), [1.03, 1.07]);
  eq([missOf(0.5, b2), missOf(2.5, b2), missOf(3.4, b2)].map(x => +x.toFixed(2)), [1.65, 0, 0.55]);
});
t('target: generateTargeted is deterministic and returns a unique puzzle whose reported grade is its trap grade', () => {
  for (const [n, g, seed] of [[6, 1, 1], [7, 3, 2]]) {
    const a = runSync(generateTargeted(n, g, seed)), b = runSync(generateTargeted(n, g, seed));
    ok(a.puzzle && a.unique, 'a puzzle');
    eq(serialize(a.puzzle), serialize(b.puzzle), 'same seed + target = same puzzle');
    const r = solve(a.puzzle, { limit: 2, nodeCap: 300000, ...REF_FLAGS });
    ok(r.count === 1 && !r.exceeded, 'unique'); ok(isSolved(a.puzzle, a.puzzle.path), 'its path is the solution');
    const m = trapMetrics(a.puzzle);
    eq(m.grade, a.grade, 'reported grade = the Play badge grade'); ok(Math.abs(m.predicted - a.pred) < 1e-9, 'reported score = trapPredicted');
    eq(a.hit, a.grade === a.target); eq(a.puzzle.seed, seed);
    const Kmin = Math.max(4, n), Kmax = Math.max(Kmin + 1, Math.round(n * n / 4));
    ok(a.K >= Kmin && a.K <= Kmax && a.K === maxNumber(a.puzzle), `K ${a.K} stays in generate()'s range ${Kmin}..${Kmax}`);
  }
});
t('target: every grade the generator can show is reachable (this is what to look at after a refit: node tools/target-eval.mjs)', () => {
  let hit = 0, total = 0;
  for (const g of [0, 1, 2, 3]) for (const seed of [1, 2]) { const r = runSync(generateTargeted(7, g, seed * 31 + g)); total++; if (r.hit) hit++; }
  ok(hit >= 0.75 * total, `${hit}/${total} targets hit at 7x7, grades 0-3`);
});
t('target: wall-minimal mode keeps only needed walls and the reported grade is the grade of that puzzle; a time cap stops the search and returns the closest puzzle', () => {
  const r = runSync(generateTargeted(7, 3, 4)), p = r.puzzle;
  ok(r.minimal === true, 'minimal by default');
  for (const w of wallIds(p)) { // dropping any single wall must give a second solution (or an undecided check): the wall is needed
    const q = clonePuzzle(p); setWallId(q.walls, w, false);
    ok(solve(q, { limit: 2, nodeCap: 300000, ...REF_FLAGS }).count !== 1, 'a wall of the result is not needed');
  }
  eq(trapMetrics(p).grade, r.grade, 'grade read on the stripped puzzle');
  const off = runSync(generateTargeted(7, 3, 4, { minimize: false }));
  ok(off.minimal === false && validate(off.puzzle).ok, 'minimize:false = the first version');
  const t0 = performance.now(), c = runSync(generateTargeted(9, 5, 3, { maxMs: 400 }));
  ok(performance.now() - t0 < 3000, 'a 400 ms time cap ends the run soon (the cap is checked between tried changes, one can take a while)');
  ok(c.puzzle && validate(c.puzzle).ok && c.elapsedMs >= 0 && typeof c.timedOut === 'boolean', 'the closest puzzle is returned with its time info');
});
t('target: a grade the size cannot show is clamped (5x5 <= its cap), the budget scales with effort, events report progress', () => {
  const events = [], r = runSync(generateTargeted(5, 5, 7, { effort: 0.5 }), e => events.push(e));
  eq([r.requested, r.target], [5, SIZE_GRADE_CAP[5]]); ok(r.grade <= SIZE_GRADE_CAP[5], 'capped grade');
  ok(r.proposals <= proposalBudget(5, 0.5) + 2, 'stays within the proposal budget');
  ok(proposalBudget(7, 2) > proposalBudget(7, 1) && proposalBudget(7, 1) > proposalBudget(5, 1), 'budget grows with effort and size');
  ok(events.length > 0 && events.every(e => e.frac >= 0 && e.frac <= 1 && e.target === r.target), 'events: frac in 0..1, target');
  ok(events.every((e, i) => i === 0 || e.frac >= events[i - 1].frac), 'progress never goes back');
});
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
t('leaderboard: backendsFromConfig = always + backup chain + the others; skips unconfigured and unknown types; ?lb= moves a backup first', () => {
  const cfg = {
    backends: {
      asia: { type: 'supabase', url: 'https://a', key: 'k' },
      cf: { type: 'cloudflare', url: 'https://w' },
      eu: { type: 'supabase', url: 'https://e', key: 'k' },
      spare: { type: 'supabase', url: 'https://x', key: 'k' },
    },
    always: 'asia',
    order: ['cf', 'eu'],
  };
  const names = list => list.map(b => b.name);
  const setup = backendsFromConfig(cfg);
  eq([setup.always.name, names(setup.chain), names(setup.list)], ['asia', ['cf', 'eu'], ['asia', 'cf', 'eu', 'spare']], 'a backend that is neither always nor in order is read-only');
  eq(names(backendsFromConfig(cfg, 'eu').chain), ['eu', 'cf']);
  eq(names(backendsFromConfig(cfg, 'asia').chain), ['cf', 'eu'], '?lb= naming the always-written backend changes nothing');
  eq(names(backendsFromConfig(cfg, 'nope').chain), ['cf', 'eu']);
  eq(names(backendsFromConfig({ ...cfg, order: ['cf', 'asia', 'eu', 'cf'] }).chain), ['cf', 'eu'], 'always is never a backup; duplicates dropped');
  const noKey = backendsFromConfig({ ...cfg, backends: { ...cfg.backends, asia: { type: 'supabase', url: 'https://a', key: '' } } });
  eq([noKey.always, names(noKey.chain), names(noKey.list)], [null, ['cf', 'eu'], ['cf', 'eu', 'spare']], 'always not configured: the backups alone');
  eq(backendsFromConfig({ ...cfg, always: undefined }).always, null);
  eq(names(backendsFromConfig({ ...cfg, backends: { ...cfg.backends, eu: { type: 'mongo', url: 'https://t', key: 'k' } } }).chain), ['cf'], 'a type this build does not know is skipped');
  eq(names(backendsFromConfig({ ...cfg, backends: { ...cfg.backends, eu: { type: 'turso', url: 'https://t', key: 'k' } } }).chain), ['cf', 'eu'], 'turso is a known type');
  eq(names(backendsFromConfig({ ...cfg, backends: { ...cfg.backends, eu: { type: 'turso', url: 'https://t', key: '' } } }).chain), ['cf'], 'a turso entry without its token is not configured');
  eq(names(backendsFromConfig({ ...cfg, backends: { ...cfg.backends, cf: { type: 'cloudflare', url: '' } } }).chain), ['eu']);
  const none = backendsFromConfig({ backends: {}, always: 'asia', order: ['cf'] });
  eq([none.always, none.chain, none.list], [null, [], []]);
  eq(createLeaderboard(none).enabled, false);
  eq(createLeaderboard(setup).readOrder, ['asia', 'cf', 'eu']);
});
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const GOOD = { n: 3, sum: 90000, below: 1, cnt: 1, best: [10000, 30000, 50000] };
const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
const CF = { url: 'https://w.example/' }, SB = { url: 'https://s.example', key: 'anon-key' }, ASIA = { url: 'https://asia.example', key: 'asia-key' };
const both = f => createLeaderboard({ always: null, chain: [cloudflareBackend(CF), supabaseBackend(SB)] }, { fetchFn: f, timeoutMs: 20 }); // backups only
ta('leaderboard: request shapes (cloudflare text/plain no preflight; supabase rpc + apikey) and summary', async () => {
  const calls = []; const f = async (url, init) => { calls.push([url, init]); return reply(200, GOOD); };
  const r = await both(f).submit('20260929', 42.13);
  eq([r.status, r.backend, r.summary], ['ok', 'cloudflare', { n: 3, mean: 30, top: null, pct: 50 }]);
  eq(calls.length, 1); eq(calls[0][0], 'https://w.example/gotd'); eq(calls[0][1].headers, { 'Content-Type': 'text/plain;charset=UTF-8' });
  eq(JSON.parse(calls[0][1].body), { d: 20260929, t: 42130, b: binOf(42130) });
  const g = []; await createLeaderboard({ always: null, chain: [supabaseBackend(SB)] }, { fetchFn: async (u, i) => { g.push([u, i]); return reply(200, GOOD); } }).submit('20260929', 42.13);
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
// always-written backend `asia` + backup chain [cloudflare, supabase]; every host answers as routes[host]; the summary's mean tells who answered
const three = routes => {
  const calls = [];
  const fetchFn = async (url, init) => {
    const host = new URL(url).host;
    calls.push(host);
    return routes[host](url, init);
  };
  const lb = createLeaderboard({ always: supabaseBackend(ASIA, 'asia'), chain: [cloudflareBackend(CF), supabaseBackend(SB)] }, { fetchFn, timeoutMs: 20 });
  return { lb, calls };
};
const meanOf = seconds => async () => reply(200, { n: 3, sum: 3000 * seconds, below: 1, cnt: 1, best: [10000, 30000, 50000] });
const ALL = { 'asia.example': meanOf(30), 'w.example': meanOf(40), 's.example': meanOf(50) };
const down = async () => reply(503, {});
const brief = r => [r.status, r.backend, r.summary && r.summary.mean, r.done, r.complete];
ta('leaderboard: always + first backup are both written, the summary comes from always, the later backups stay untouched', async () => {
  const { lb, calls } = three(ALL);
  eq(brief(await lb.submit('20261004', 42.13)), ['ok', 'asia', 30, ['asia', 'cloudflare'], true]);
  eq([...calls].sort(), ['asia.example', 'w.example']);
});
ta('leaderboard: always and the backup chain are requested in parallel', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = mean => async () => { await gate; return meanOf(mean)(); };
  const { lb, calls } = three({ 'asia.example': slow(30), 'w.example': slow(40), 's.example': slow(50) });
  const pending = lb.submit('20261004', 30);
  await new Promise(resolve => setTimeout(resolve, 0));
  eq([...calls].sort(), ['asia.example', 'w.example'], 'both in flight before either answered');
  release();
  eq((await pending).done, ['asia', 'cloudflare']);
});
ta('leaderboard: the backup chain fails over (cloudflare down: supabase), always is unaffected', async () => {
  const { lb, calls } = three({ ...ALL, 'w.example': down });
  eq(brief(await lb.submit('20261004', 30)), ['ok', 'asia', 30, ['asia', 'supabase'], true]);
  eq([...calls].sort(), ['asia.example', 's.example', 'w.example']);
});
ta('leaderboard: backups all down = ok but not complete; always down = the backup answers and always is still owed', async () => {
  const noBackups = three({ ...ALL, 'w.example': down, 's.example': down });
  eq(brief(await noBackups.lb.submit('20261004', 30)), ['ok', 'asia', 30, ['asia'], false]);
  const noAsia = three({ ...ALL, 'asia.example': down });
  eq(brief(await noAsia.lb.submit('20261004', 30)), ['ok', 'cloudflare', 40, ['cloudflare'], false]);
  const hung = three({ ...ALL, 'asia.example': (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  eq(brief(await hung.lb.submit('20261004', 30)), ['ok', 'cloudflare', 40, ['cloudflare'], false], 'a timeout of always does not stop the backup');
  const nothing = three({ 'asia.example': down, 'w.example': down, 's.example': down });
  eq(brief(await nothing.lb.submit('20261004', 30)), ['failed', undefined, undefined, [], false]);
});
ta('leaderboard: a retry writes only what is missing (done), and nothing when nothing is missing', async () => {
  const chainOnly = three(ALL);
  eq(brief(await chainOnly.lb.submit('20261004', 30, ['asia'])), ['ok', 'cloudflare', 40, ['asia', 'cloudflare'], true]);
  eq(chainOnly.calls, ['w.example']);
  const alwaysOnly = three(ALL);
  eq(brief(await alwaysOnly.lb.submit('20261004', 30, ['supabase'])), ['ok', 'asia', 30, ['supabase', 'asia'], true]);
  eq(alwaysOnly.calls, ['asia.example']);
  const done = three(ALL);
  eq(await done.lb.submit('20261004', 30, ['asia', 'cloudflare']), { status: 'ok', done: ['asia', 'cloudflare'], complete: true });
  eq(done.calls, []);
});
ta('leaderboard: a 400/422 backend counts as settled; one that stored the solve wins; only rejections = rejected', async () => {
  const alwaysRejects = three({ ...ALL, 'asia.example': async () => reply(400, {}) });
  eq(brief(await alwaysRejects.lb.submit('20261004', 30)), ['ok', 'cloudflare', 40, ['asia', 'cloudflare'], true]);
  const chainRejects = three({ ...ALL, 'w.example': async () => reply(422, {}) });
  eq(brief(await chainRejects.lb.submit('20261004', 30)), ['ok', 'asia', 30, ['asia', 'cloudflare'], true]);
  eq([...chainRejects.calls].sort(), ['asia.example', 'w.example'], 'a rejection ends the chain: no failover to supabase');
  const allReject = three({ ...ALL, 'asia.example': async () => reply(400, {}), 'w.example': async () => reply(400, {}) });
  eq((await allReject.lb.submit('20261004', 30)).status, 'rejected');
  const skipped = three(ALL);
  eq([(await skipped.lb.submit('20261004', 0.4)).status, skipped.calls], ['skipped', []]);
});
ta('leaderboard / stats-client: an adapter with decode() (a database with its own reply envelope) plugs in without changes to the flow', async () => {
  // stands for a backend like Turso's HTTP API: always HTTP 200, the result or an error inside an envelope
  const wrapped = {
    name: 'wrapped',
    request: ({ d, t, b }) => ({ url: 'https://wrapped.example/q', init: { method: 'POST', body: JSON.stringify({ d, t, b }) } }),
    read: ({ from, to }) => ({ url: `https://wrapped.example/r?${from}-${to}`, init: { method: 'GET' } }),
    decode: (kind, json) => {
      if (json.error) return json.error === 'invalid' ? { rejected: true } : null;
      return json.result;
    },
  };
  const answer = body => async () => ({ ok: true, status: 200, json: async () => body });
  const lbOf = f => createLeaderboard({ always: wrapped, chain: [] }, { fetchFn: f, timeoutMs: 20 });
  eq(brief(await lbOf(answer({ result: GOOD })).submit('20261004', 30)), ['ok', 'wrapped', 30, ['wrapped'], true]);
  eq((await lbOf(answer({ error: 'invalid' })).submit('20261004', 30)).status, 'rejected');
  eq((await lbOf(answer({ error: 'db down' })).submit('20261004', 30)).status, 'failed');
  eq((await lbOf(answer({ result: { n: 'x' } })).submit('20261004', 30)).status, 'failed');
  const day = { d: 20261004, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000] };
  const [ok] = await fetchStats([wrapped], { from: 20261004, to: 20261004 }, { fetchFn: answer({ result: { days: [day] } }) });
  eq([ok.status, ok.days.length, ok.days[0].n], ['ok', 1, 3]);
  const [bad] = await fetchStats([wrapped], { from: 20261004, to: 20261004 }, { fetchFn: answer({ error: 'x' }) });
  eq(bad.status, 'failed');
});
const TB = { url: 'https://zip-x.turso.io/', key: 'public-token' };
const cell = v => (typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: v });
const pipe = (...results) => ({ baton: null, base_url: null, results: [...results, { type: 'ok', response: { type: 'close' } }] });
const rowOf = obj => ({ type: 'ok', response: { type: 'execute', result: { cols: Object.keys(obj).map(name => ({ name })), rows: [Object.values(obj).map(cell)], affected_row_count: 0 } } });
const done = n => ({ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: n } } });
const failed = message => ({ type: 'error', error: { message } });
const STATS_ROW = { n: 3, sum: 90000, below: 1, cnt: 1, best: '[10000,30000,50000]' };
t('turso adapter: request = one pipeline (INSERT, summary SELECT) with the token as bearer; read = one statement', () => {
  const be = tursoBackend(TB, 'turso-asia'), b = binOf(42130);
  const { url, init } = be.request({ d: 20261004, t: 42130, b, u: 'uid-12345678' });
  eq([be.name, url, init.method, init.headers], ['turso-asia', 'https://zip-x.turso.io/v2/pipeline', 'POST', { 'Content-Type': 'application/json', Authorization: 'Bearer public-token' }]);
  const req = JSON.parse(init.body).requests;
  eq(req.map(r => r.type), ['execute', 'execute', 'close']);
  eq(req[0].stmt.args, [{ type: 'text', value: 'uid-12345678' }, { type: 'integer', value: '20261004' }, { type: 'integer', value: '42130' }, { type: 'integer', value: String(b) }]);
  eq(req[1].stmt.args, [{ type: 'integer', value: '20261004' }, { type: 'integer', value: String(b) }]);
  ok(/^INSERT OR IGNORE INTO submit/.test(req[0].stmt.sql) && /FROM solve/.test(req[1].stmt.sql));
  const uid = () => JSON.parse(be.request({ d: 20261004, t: 42130, b }).init.body).requests[0].stmt.args[0].value;
  ok(uid().length >= 8 && uid().length <= 64 && uid() !== uid(), 'a fresh random uid of 8..64 characters per request');
  const r = be.read({ from: 20261001, to: 20261004 });
  eq([r.url, JSON.parse(r.init.body).requests.map(x => x.type), JSON.parse(r.init.body).requests[0].stmt.args], ['https://zip-x.turso.io/v2/pipeline', ['execute', 'close'], [{ type: 'integer', value: '20261001' }, { type: 'integer', value: '20261004' }]]);
});
t('turso adapter: decode = stats / rejected (the trigger raised invalid) / throws (any other error, nothing usable)', () => {
  const be = tursoBackend(TB), threw = f => { try { f(); } catch { return true; } return false; };
  eq(be.decode('submit', pipe(done(1), rowOf(STATS_ROW))), GOOD);
  eq(be.decode('submit', pipe(done(0), rowOf(STATS_ROW))), GOOD, 'a uid that is already stored: the same answer');
  eq(be.decode('submit', pipe(failed('SQLite error: invalid'), rowOf(STATS_ROW))), { rejected: true });
  ok(threw(() => be.decode('submit', pipe(failed('SQLite error: not authorized'), rowOf(STATS_ROW)))), 'SQLITE_AUTH is a failure, not a rejection');
  ok(threw(() => be.decode('submit', pipe(done(1), failed('SQLite error: no such table: solve')))));
  ok(threw(() => be.decode('submit', pipe(done(1), { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0 } } }))), 'no stats row');
  ok(threw(() => be.decode('submit', { error: 'x' })) && threw(() => be.decode('read', null)));
  const day = d => ({ d, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000], seeds: [] });
  eq(be.decode('read', pipe(rowOf({ reply: JSON.stringify({ days: [day(20261005), day(20261004)] }) }))).days.map(x => x.d), [20261004, 20261005], 'days come back oldest first');
  eq(be.decode('read', pipe(rowOf({ reply: '{"days":[]}' }))), { days: [] });
  ok(threw(() => be.decode('read', pipe(failed('SQLite error: not authorized')))));
});
ta('turso adapter in the flow: HTTP 200 with an error inside = rejected / failed; a good envelope = ok; the stats page reads it too', async () => {
  const be = tursoBackend(TB, 'turso-asia');
  const answer = body => async () => ({ ok: true, status: 200, json: async () => body });
  const lbOf = f => createLeaderboard({ always: be, chain: [] }, { fetchFn: f, timeoutMs: 20 });
  eq(brief(await lbOf(answer(pipe(done(1), rowOf(STATS_ROW)))).submit('20261004', 30)), ['ok', 'turso-asia', 30, ['turso-asia'], true]);
  eq((await lbOf(answer(pipe(failed('SQLite error: invalid'), rowOf(STATS_ROW)))).submit('20261004', 30)).status, 'rejected');
  eq((await lbOf(answer(pipe(failed('SQLite error: not authorized'), rowOf(STATS_ROW)))).submit('20261004', 30)).status, 'failed');
  eq((await lbOf(async () => reply(401, {})).submit('20261004', 30)).status, 'failed', 'a wrong token is a failure (HTTP 401), so a backup would be tried');
  const day = { d: 20261004, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000], seeds: [3000] };
  const [res] = await fetchStats([be], { from: 20261004, to: 20261004 }, { fetchFn: answer(pipe(rowOf({ reply: JSON.stringify({ days: [day] }) }))) });
  eq([res.status, res.days.length, res.days[0].n, res.days[0].seeds], ['ok', 1, 3, [3000]]);
});
// any combination of `always` / `order` over four backends (one of them Turso): who gets the solve. A host in `down` answers HTTP 503.
const comboCfg = (always, order, tursoKey = 'tok') => ({
  backends: {
    'turso-asia': { type: 'turso', url: 'https://t.example', key: tursoKey }, 'supabase-asia': { type: 'supabase', url: 'https://asia.example', key: 'k' },
    cloudflare: { type: 'cloudflare', url: 'https://w.example' }, supabase: { type: 'supabase', url: 'https://s.example', key: 'k' },
  },
  always, order,
});
const comboRun = async (always, order, down = [], tursoKey) => {
  const hosts = new Set();
  const fetchFn = async url => {
    const host = new URL(url).host;
    hosts.add(host);
    if (down.includes(host)) return reply(503, {});
    return host === 't.example' ? { ok: true, status: 200, json: async () => pipe(done(1), rowOf(STATS_ROW)) } : reply(200, GOOD);
  };
  const lb = createLeaderboard(backendsFromConfig(comboCfg(always, order, tursoKey)), { fetchFn, timeoutMs: 20 });
  const r = await lb.submit('20261004', 30);
  return { status: r.status, backend: r.backend, complete: r.complete, done: [...r.done].sort(), hosts: [...hosts].sort(), readOrder: lb.readOrder };
};
ta('config combinations: always turso-asia with the other backends as backups (supabase-asia first) = two writes per solve, failover inside the chain', async () => {
  const order = ['supabase-asia', 'cloudflare', 'supabase'];
  eq(await comboRun('turso-asia', order), { status: 'ok', backend: 'turso-asia', complete: true, done: ['supabase-asia', 'turso-asia'], hosts: ['asia.example', 't.example'], readOrder: ['turso-asia', 'supabase-asia', 'cloudflare', 'supabase'] });
  const asiaDown = await comboRun('turso-asia', order, ['asia.example']);
  eq([asiaDown.status, asiaDown.backend, asiaDown.complete, asiaDown.done, asiaDown.hosts], ['ok', 'turso-asia', true, ['cloudflare', 'turso-asia'], ['asia.example', 't.example', 'w.example']], 'the next backup takes over');
  const tursoDown = await comboRun('turso-asia', order, ['t.example']);
  eq([tursoDown.status, tursoDown.backend, tursoDown.complete, tursoDown.done], ['ok', 'supabase-asia', false, ['supabase-asia']], 'always failed: stored by a backup, but not complete (the retry goes to turso-asia only)');
  const allDown = await comboRun('turso-asia', order, ['t.example', 'asia.example', 'w.example', 's.example']);
  eq([allDown.status, allDown.complete, allDown.done], ['failed', false, []]);
});
ta('config combinations: no backups, turso as the first backup (always: null), always listed in order, a backend in neither list', async () => {
  const alone = await comboRun('turso-asia', []);
  eq([alone.status, alone.complete, alone.hosts, alone.readOrder], ['ok', true, ['t.example'], ['turso-asia']]);
  const asBackup = await comboRun(null, ['turso-asia', 'supabase-asia']);
  eq([asBackup.backend, asBackup.complete, asBackup.hosts], ['turso-asia', true, ['t.example']], 'a backup chain writes to the first backend that answers only');
  eq((await comboRun(null, ['turso-asia', 'supabase-asia'], ['t.example'])).hosts, ['asia.example', 't.example']);
  eq(backendsFromConfig(comboCfg('turso-asia', ['turso-asia', 'supabase-asia'])).chain.map(b => b.name), ['supabase-asia'], 'always is never its own backup');
  const readOnly = await comboRun('turso-asia', ['cloudflare']);
  eq([readOnly.hosts, readOnly.readOrder], [['t.example', 'w.example'], ['turso-asia', 'cloudflare']], 'supabase-asia and supabase are neither written nor part of the summary order');
  eq(backendsFromConfig(comboCfg('turso-asia', ['cloudflare'])).list.map(b => b.name), ['turso-asia', 'cloudflare', 'supabase-asia', 'supabase'], '...but the stats page and the seeder still use them');
});
ta('config combinations: an `always` backend without its key counts as not set (nothing is written to it, silently), the backups still work', async () => {
  const setup = backendsFromConfig(comboCfg('turso-asia', ['supabase-asia'], ''));
  eq([setup.always, setup.chain.map(b => b.name)], [null, ['supabase-asia']]);
  const r = await comboRun('turso-asia', ['supabase-asia'], [], '');
  eq([r.status, r.hosts, r.done], ['ok', ['asia.example'], ['supabase-asia']]);
});
const SUM = mean => ({ n: 3, mean, top: null, pct: 50 });
const OWED = { solved: true, time: 42.1, sent: false };
const ORDER = ['asia', 'cloudflare', 'supabase'];
t('afterSubmit: complete = the minimal record; incomplete keeps done / rounds / statsFrom; the always-written backend\'s summary wins', () => {
  eq(afterSubmit(OWED, { status: 'ok', done: ['asia', 'cloudflare'], complete: true, backend: 'asia', summary: SUM(30) }, ORDER), { solved: true, time: 42.1, sent: true, stats: SUM(30) });
  const first = afterSubmit(OWED, { status: 'ok', done: ['cloudflare'], complete: false, backend: 'cloudflare', summary: SUM(40) }, ORDER);
  eq(first, { solved: true, time: 42.1, sent: false, stats: SUM(40), statsFrom: 'cloudflare', done: ['cloudflare'], rounds: 1 });
  eq(afterSubmit(first, { status: 'ok', done: ['cloudflare', 'asia'], complete: true, backend: 'asia', summary: SUM(30) }, ORDER), { solved: true, time: 42.1, sent: true, stats: SUM(30) }, 'the retry of always replaces the backup\'s summary');
  const kept = { ...OWED, stats: SUM(30), statsFrom: 'asia', done: ['asia'], rounds: 1 };
  eq(afterSubmit(kept, { status: 'ok', done: ['asia', 'supabase'], complete: true, backend: 'supabase', summary: SUM(50) }, ORDER).stats, SUM(30), 'a later backup never replaces an earlier one\'s summary');
});
t('afterSubmit: a backend that never answers is given up after MAX_ROUNDS rounds; offline (nothing stored) never counts', () => {
  eq(MAX_ROUNDS, 3);
  let rec = afterSubmit(OWED, { status: 'ok', done: ['asia'], complete: false, backend: 'asia', summary: SUM(30) }, ORDER);
  eq([rec.sent, rec.rounds], [false, 1]);
  rec = afterSubmit(rec, { status: 'failed', done: ['asia'], complete: false }, ORDER);
  eq([rec.sent, rec.rounds], [false, 2]);
  rec = afterSubmit(rec, { status: 'failed', done: ['asia'], complete: false }, ORDER);
  eq(rec, { solved: true, time: 42.1, sent: true, stats: SUM(30) });
  let offline = OWED;
  for (let i = 0; i < 5; i++) offline = afterSubmit(offline, { status: 'failed', done: [], complete: false }, ORDER);
  ok(offline === OWED, 'prev itself: nothing to save, retried on the next page load');
});
t('afterSubmit: rejected and skipped finish the record without a summary; a legacy pending record works', () => {
  eq(afterSubmit(OWED, { status: 'rejected', done: ['asia'], complete: true }, ORDER), { solved: true, time: 42.1, sent: true, stats: null });
  eq(afterSubmit(OWED, { status: 'skipped', done: [] }, ORDER), { solved: true, time: 42.1, sent: true, stats: null });
  eq(afterSubmit(OWED, { status: 'ok', done: ['supabase'], complete: true, backend: 'supabase', summary: SUM(50) }, ORDER).stats, SUM(50), 'no always-written backend: the backup\'s summary');
});

ta('stats-store: pending GOTD attempt is sent:false; saving stats persists and survives hydrate', async () => {
  const st = fakeStorage(), S = createStore(st, [5]); await S.hydrate('20260929');
  await S.recordGotd(5, '20260929', 42.1, true); eq(S.attempt(), { solved: true, time: 42.1, sent: false });
  await S.saveAttempt('20260929', { solved: true, time: 42.1, sent: true, stats: { n: 3, mean: 30, top: null, pct: 50 } });
  const S2 = createStore(st, [5]); await S2.hydrate('20260929'); eq(S2.attempt(), { solved: true, time: 42.1, sent: true, stats: { n: 3, mean: 30, top: null, pct: 50 } });
  const S3 = createStore(fakeStorage(), [5]); await S3.hydrate('20260929'); await S3.recordGotd(5, '20260929', 42.1); eq(S3.attempt(), { solved: true, time: 42.1 });
});

// ---- Game-of-Day seed players (core/gotd-model.js, stats-merge seeds) ----
const aday = (extra = {}) => ({ d: 20260929, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000], ...extra });
t('stats-merge: parseDays keeps seeds (default [], sorted), rejects malformed ones; mergeDays concatenates them', () => {
  eq(parseDays({ days: [aday()] })[0].seeds, []);
  eq(parseDays({ days: [aday({ seeds: [3000, 2000] })] })[0].seeds, [2000, 3000]);
  for (const bad of [[499], [3600001], [1.5], ['x'], new Array(9).fill(5000), 'x', null]) eq(parseDays({ days: [aday({ seeds: bad })] }), null, JSON.stringify(bad));
  const a = parseDays({ days: [aday({ seeds: [3000] })] }), b = parseDays({ days: [aday({ seeds: [2000] })] }), old = [{ ...parseDays({ days: [aday()] })[0], seeds: undefined }];
  const m = mergeDays([a, b, old])[0]; eq([m.n, m.sum, m.seeds], [9, 27000, [2000, 3000]]);
  eq(mergeDays([a])[0].seeds, [3000]);
});
t('stats-merge: combineDays adds up the days before replicatedFrom and takes the fullest copy from it on', () => {
  const dayOf = (d, n, seeds = []) => parseDays({ days: [aday({ d, n, sum: n * 3000, bins: [[3, n]], best: [2000], seeds })] })[0];
  const results = [
    { name: 'asia', days: [dayOf(20261002, 3), dayOf(20261004, 10, [5000]), dayOf(20261005, 12, [5000])] },
    { name: 'cf', days: [dayOf(20261002, 4), dayOf(20261004, 11, [5000]), dayOf(20261005, 12, [5000])] },
    { name: 'eu', days: [dayOf(20261004, 1)] },
  ];
  const combined = combineDays(results, 20261004);
  eq(combined.map(x => [x.d, x.n, x.sum, x.bins[3], x.src, x.seeds.length]), [
    [20261002, 7, 21000, 7, ['asia', 'cf'], 0],
    [20261004, 11, 33000, 11, ['cf'], 1],
    [20261005, 12, 36000, 12, ['asia'], 1],
  ], 'before: added up; from replicatedFrom: the fullest copy (a tie: the earlier backend), its seeds once');
  eq(combineDays(results).map(x => [x.d, x.n, x.src]), [[20261002, 7, ['asia', 'cf']], [20261004, 22, ['asia', 'cf', 'eu']], [20261005, 24, ['asia', 'cf']]], 'no replicatedFrom: everything added up, like mergeDays');
  eq(combineDays([]), []);
  eq(results[0].days[1].bins[3], 10, 'the inputs are not changed');
});
t('stats-merge: replicatedTo ends the replicated range (both ends included); days after it add up again', () => {
  const dayOf = (d, n) => parseDays({ days: [aday({ d, n, sum: n * 3000, bins: [[3, n]], best: [2000] })] })[0];
  const results = [
    { name: 'asia', days: [20261002, 20261003, 20261004, 20261005, 20261006].map((d, i) => dayOf(d, [3, 10, 12, 8, 6][i])) },
    { name: 'cf', days: [20261002, 20261003, 20261004, 20261005, 20261006].map((d, i) => dayOf(d, [4, 9, 12, 5, 7][i])) },
  ];
  const view = combineDays(results, 20261003, 20261004).map(x => [x.d, x.n, x.src]);
  eq(view, [
    [20261002, 7, ['asia', 'cf']],
    [20261003, 10, ['asia']],
    [20261004, 12, ['asia']],
    [20261005, 13, ['asia', 'cf']],
    [20261006, 13, ['asia', 'cf']],
  ], 'before from and after to: added up; from and to themselves: one copy');
  eq(combineDays(results, 20261003, 20261003).map(x => [x.d, x.src.length]), [[20261002, 2], [20261003, 1], [20261004, 2], [20261005, 2], [20261006, 2]], 'a one-day range');
  eq(combineDays(results, 20261003).map(x => x.src.length), [2, 1, 1, 1, 1], 'no end: replication runs on');
  eq(combineDays(results, undefined, 20261004).map(x => x.src.length), [2, 2, 2, 2, 2], 'no start: nothing is replicated, whatever the end');
  eq(combineDays(results, 20261005, 20261003).map(x => x.src.length), [2, 2, 2, 2, 2], 'an empty range (to before from) replicates nothing');
  eq(combineDays(results, 20261003, null).map(x => x.src.length), [2, 1, 1, 1, 1], 'null = no end, like undefined (a config line `replicatedTo: null`)');
  eq(combineDays(results, null, 20261004).map(x => x.src.length), [2, 2, 2, 2, 2], 'null start = nothing replicated');
  ok(isReplicated(20261003, 20261003, 20261004) && isReplicated(20261004, 20261003, 20261004));
  ok(!isReplicated(20261002, 20261003, 20261004) && !isReplicated(20261005, 20261003, 20261004));
  ok(!isReplicated(20261003) && !isReplicated(20261003, undefined, 20261009), 'no start: never');
  ok(isReplicated(99999999, 20261003), 'no end: any later day');
});
t('gotd-model: withoutSeeds subtracts n, sum and bins exactly; null when the seeds do not fit', () => {
  const seeds = [41000, 9000, 41000], reals = [30000, 5000], all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++;
  const r = withoutSeeds({ d: 1, n: 5, sum: all.reduce((a, x) => a + x, 0), bins, seeds }), exp = new Array(NB).fill(0); for (const x of reals) exp[binOf(x)]++;
  eq([r.n, r.sum, r.bins], [2, 35000, exp]); eq(withoutSeeds({ d: 1, n: 2, sum: 1, bins: new Array(NB).fill(0), seeds: [5000] }), null);
  eq(withoutSeeds({ d: 1, n: 4, sum: 100, bins, seeds }), null); eq(withoutSeeds({ d: 1, n: 3, sum: 5, bins }).n, 3);
});
t('gotd-model: wls and fitCandidate (linear, log, bucket, constant, too few rows)', () => {
  const line = wls([0, 1, 2, 3], [1, 3, 5, 7]); ok(Math.abs(line.a - 1) < 1e-9 && Math.abs(line.b - 2) < 1e-9); eq(wls([2, 2], [1, 3]), { a: 2, b: 0 });
  const xs = Array.from({ length: 40 }, (_, i) => i / 10), ys = xs.map(x => 0.5 + 0.9 * x), ws = xs.map(() => 1);
  const f = fitCandidate(xs, ys, ws); eq(f.model.kind, 'id'); ok(f.mae < 1e-9 && f.skill > 0.99, JSON.stringify(f.model));
  const g = Array.from({ length: 60 }, (_, i) => i % 4), gy = g.map(v => [0.2, 1.1, 2.4, 4.9][v]), b = fitCandidate(g, gy, g.map(() => 1), { bucket: true });
  eq(b.model.kind, 'bucket'); ok(b.mae < 1e-9); eq(predictH(b.model, 3), 4.9); eq(predictH(b.model, 9), b.model.fallback); // unseen grade -> mean
  eq(fitCandidate(xs.map(() => 1), ys, ws), null); eq(fitCandidate(xs.slice(0, 10), ys.slice(0, 10), ws.slice(0, 10)), null);
  eq(predictH({ kind: 'id', a: -3, b: 1 }, 1), 0); eq(predictH({ kind: 'id', a: 3, b: 1 }, 9), 5); // clamped to the 0-5 scale
});
t('gotd-model: dedupe drops same-family and near-identical candidates, keeps the better one', () => {
  const ranked = ['grade:B', 'B/N', 'wideFrac', 'altFrac', 'trapMax'].map(id => ({ id })), fam = id => (id === 'grade:B' ? 'B/N' : id);
  const r = dedupe(ranked, fam, (a, b) => ([a, b].includes('trapMax') && [a, b].includes('altFrac') ? 0.97 : 0));
  eq([r.kept.map(c => c.id), r.dropped], [['grade:B', 'wideFrac', 'altFrac'], [{ id: 'B/N', because: 'grade:B' }, { id: 'trapMax', because: 'altFrac' }]]);
});
t('gotd-model: selectEntries gives 3..8 entries, trims min and max of the next 7, skips undefined, throws below 3', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0, 0.1, 2.2, 9, 9];
  const sel = hs => selectEntries(ranked, id => hs[+id.slice(1)]);
  let e = sel(H); eq(e.length, 8); eq(e.map(x => x.id).sort(), ['c0', 'c1', 'c2', 'c4', 'c5', 'c6', 'c9', 'c3'].sort()); // dropped: c8 (0.1 = min) and c7 (4.0 = max) of ranks 4..10
  eq(e.map(x => x.h), [...e.map(x => x.h)].sort((a, b) => a - b)); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c2']);
  e = sel(H.map((h, i) => (i === 1 || i === 6 ? undefined : h))); eq(e.map(x => x.id).includes('c1') || e.map(x => x.id).includes('c6'), false); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c2', 'c3']);
  for (const [defined, count] of [[3, 3], [4, 4], [5, 5], [6, 4], [7, 5], [8, 6], [9, 7], [10, 8], [11, 8], [12, 8]]) eq(sel(H.map((h, i) => (i < defined ? h : undefined))).length, count, 'defined ' + defined);
  for (const defined of [0, 1, 2]) { let msg = ''; try { sel(H.map((h, i) => (i < defined ? h : undefined))); } catch (err) { msg = err.message; } ok(/need 3/.test(msg), 'defined ' + defined); }
});
t('gotd-model: isMonotone: a grade metric must not be rated lower at a higher grade', () => {
  ok(isMonotone({ kind: 'bucket', table: { 0: 1, 1: 1, 3: 2.5, 4: 2.5 } })); ok(isMonotone({ kind: 'id', a: 0, b: 0.5 })); ok(isMonotone({ kind: 'id', a: 0, b: 0 }));
  ok(!isMonotone({ kind: 'bucket', table: { 0: 1.21, 1: 1.45, 2: 1.41, 3: 0.8, 4: 2 } })); ok(!isMonotone({ kind: 'log', a: 3, b: -0.1 }));
  ok(isMonotone({ kind: 'bucket', table: { 10: 2, 9: 1, 2: 0.5 } }), 'grades are ordered numerically, not as strings');
});
t('gotd-model: the production grade (badge) always plays, in a top place; the count stays 3..8', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0, 0.1, 2.2, 9, 9], hOf = id => H[+id.slice(1)];
  let e = selectEntries(ranked, hOf, { id: 'c1', h: 1.25 }); eq(e.find(x => x.id === 'c1').h, 1.25); eq(e.find(x => x.id === 'c1').role, 'top'); eq(e.length, 8); // in the top 3 already: its own h wins
  e = selectEntries(ranked, hOf, { id: 'c6', h: 1.55 }); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c6']); eq(e.length, 8); eq(e.find(x => x.id === 'c2').role, 'extra'); // c2 gave up its top place, still an extra
  eq(e.filter(x => x.id === 'c6').length, 1, 'not twice');
  e = selectEntries(ranked, hOf, { id: 'zz', h: 3 }); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'zz']); // not ranked at all
  e = selectEntries(ranked, id => (+id.slice(1) < 2 ? hOf(id) : undefined), { id: 'zz', h: 3 }); eq(e.map(x => x.id).sort(), ['c0', 'c1', 'zz']); // 2 defined + badge = 3 entries
  eq(selectEntries(ranked, hOf, null).length, 8);
});
t('gotd-model: selectEntries leaves out candidates behind the top 3 whose skill is below the threshold; the top 3 and the badge are never cut', () => {
  const sk = [0.3, 0.25, 0.01, 0.2, 0.09, 0.15, 0.12, 0.5], ranked = sk.map((skill, i) => ({ id: 'c' + i, skill })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0], hOf = id => H[+id.slice(1)];
  const e = selectEntries(ranked, hOf, null, 0.1); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c2']); // c2 has skill 0.01 and stays: top 3
  eq(e.filter(x => x.role === 'extra').map(x => x.id).sort(), ['c5', 'c6']); // c3, c5, c6, c7 pass (c4 fails); of those 4 the lowest h (c3) and the highest h (c7) go
  eq(selectEntries(ranked, hOf, null, 0).length, 3 + 3); // default 0: nothing is cut by skill (5 extras minus min and max)
  const b = selectEntries(ranked, hOf, { id: 'c4', h: 3.0 }, 0.1); ok(b.some(x => x.id === 'c4' && x.role === 'top')); // a low-skill badge still plays
  eq(selectEntries(ranked.map(c => ({ id: c.id })), hOf, null, 0.1).length, 6, 'candidates without a skill value are not cut (5 extras minus min and max)'); ok(EXTRA_MIN_SKILL > 0);
});
t('gotd-model: drawing floor: 0.5 s per cell, thinking needed above 6x6 or from grade 1, replays left out of the bins', () => {
  eq([floorMs(6), floorMs(7)], [18000, 24500]); eq([needsThinking(5, 0.4), needsThinking(5, 0.5), needsThinking(6, 1.2), needsThinking(7, 0), needsThinking(16, 0)], [false, true, true, true, true]);
  const times = [7101, 8300, 9400, 9701, 10501, 14001, 14491, 14902, 42130, 136101], bins = new Array(NB).fill(0); for (const x of times) bins[binOf(x)]++;
  const r = aboveFloor(bins, 6); eq([r.n, r.cut], [2, 8]); eq(r.bins.reduce((a, c) => a + c, 0), 2); eq(r.bins[binOf(42130)], 1);
  const edge = new Array(NB).fill(0); edge[binOf(18000)] = 3; edge[binOf(18000) - 1] = 2; eq(aboveFloor(edge, 6).n, 3); // the bin that contains the floor stays
  eq(aboveFloor(bins, 3).cut, 0); // 4.5 s floor: nobody is cut
});
t('gotd-model: withoutSeeds also takes the seed times out of best (one entry per seed); best may end up shorter than TOP_K', () => {
  const seeds = [9000, 41000], reals = [5000, 30000, 41000], all = [...reals, ...seeds], bins = new Array(NB).fill(0);
  for (const x of all) bins[binOf(x)]++;
  const day = { d: 1, n: 5, sum: all.reduce((a, x) => a + x, 0), bins, best: [...all].sort((a, b) => a - b), seeds };
  const r = withoutSeeds(day);
  eq(r.best, [5000, 30000, 41000]); eq(r.seeds, []); eq(day.best.length, 5, 'input untouched');
  eq(withoutSeeds({ ...day, seeds: [], best: undefined }).best, []);
});
t('gotd-model: pickEntries reports the extras it cut (lowest / highest h of the puzzle, not of the skill rank) and the ones below the skill threshold', () => {
  const skills = [0.25, 0.24, 0.16, 0.1376, 0.1199, 0.1198, 0.1027, 0.0748];
  const ranked = ['a', 'b', 'c', 'wide', 'max', 'kt', 'alt', 'weak'].map((id, i) => ({ id, skill: skills[i] }));
  const H = { a: 1.2, b: 2.3, c: 1.7, wide: 1.5, max: 2.6, kt: 2.19, alt: 2.09, weak: 1 };
  const r = pickEntries(ranked, id => H[id], { id: 'b', h: 2.3 }, 0.1);
  eq(r.played.map(x => x.id), ['a', 'c', 'alt', 'kt', 'b']);
  eq(r.cut.map(x => [x.id, x.role]), [['wide', 'lowest'], ['max', 'highest']]);
  eq(r.weak.map(x => x.id), ['weak']);
  eq(selectEntries(ranked, id => H[id], { id: 'b', h: 2.3 }, 0.1), r.played);
  eq(pickEntries(ranked.slice(0, 5), id => H[id], null, 0.1).cut, [], 'fewer than 3 extras: nothing is trimmed');
});
t('stats charts: tips are escaped attributes, seed players are drawn and widen the axis', () => {
  const days = [20260930, 20261001];
  const bars = barsSvg(days, [{ name: 'a', cls: 'c-supabase', values: [3, 5] }], 20261001, [['d1', 'x'], ['d2 "q" <b>']]);
  eq((bars.match(/data-tip=/g) || []).length, 2); ok(bars.includes('d2 &quot;q&quot; &lt;b&gt;') && bars.includes('d1&#10;x'), bars);
  const base = { lo: [20, 30], hi: [90, 100] }, lines = [{ name: 'median', cls: 'l-p50', values: [50, null] }];
  const plain = linesSvg(days, lines, base, null);
  ok(!plain.includes('class="seed"') && !plain.includes('>10m<'));
  const withSeeds = linesSvg(days, lines, base, null, { seeds: [[{ ms: 600000, copies: 2 }], []], tips: [['t']] });
  eq((withSeeds.match(/class="seed"/g) || []).length, 1); ok(withSeeds.includes('>10m<'), 'y axis reaches the seed'); ok(withSeeds.includes('seed player 10m ×2'));
  ok(withSeeds.includes('09-30 · median 50s') && withSeeds.includes('data-d="20260930"'));
  const bins = new Array(80).fill(0); bins[20] = 3; bins[25] = 1;
  const seedBins = new Array(80).fill(0); seedBins[20] = 2;
  const hist = histSvg(bins, [{ label: 'p50 20s', ms: 20000, cls: 'm-p50' }], seedBins);
  eq((hist.match(/class="bar-seed"/g) || []).length, 1); eq((hist.match(/class="bar0"/g) || []).length, 2); ok(hist.includes('3 players, 2 of them seed') && hist.includes('p50 20s'));
  eq((histSvg(bins, []).match(/bar-seed/g) || []).length, 0);
  const sc = scatterSvg([{ x: 2, y: 60, n: 9, cls: 'c0', label: 'day "1"', seeds: [{ ms: 300000, label: 'seed 5m' }] }]);
  eq((sc.match(/class="seed"/g) || []).length, 1); ok(sc.includes('day &quot;1&quot;') && sc.includes('>5m<'), 'scatter axis reaches the seed');
});
t('gotd-model: fitTime = prior without data, anchors the level with one day, recovers a known law from many days; predictMs clamps', () => {
  const p0 = fitTime([]); eq(p0.mean.map(v => +v.toFixed(6)), TIME_PRIOR.mean.map(v => +v.toFixed(6))); eq(p0.sd.map(v => +v.toFixed(3)), TIME_PRIOR.sd);
  eq(predictMs(p0, 7, TIME_PRIOR.refH), 100000); eq(predictMs(p0, 7, 2), 141421); // 7x7 grade 2: 141 s
  eq(predictMs(p0, 7, 2.5) / predictMs(p0, 7, 1.5), 2); eq(predictMs(p0, 14, 1.5) / predictMs(p0, 7, 1.5), 4); // x2 per grade, time ~ cells
  const one = fitTime([{ n: 7, h: 1.5, y: Math.log(40000), count: 12 }]); ok(Math.abs(Math.exp(one.mean[0]) - 40000) < 5000, 'level moves to the data'); ok(Math.abs(one.mean[2] - Math.LN2) < 0.05, 'slope stays at the prior with one day');
  let s = 11; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32, pts = Array.from({ length: 80 }, () => { const n = 5 + Math.floor(rnd() * 7), h = rnd() * 4; return { n, h, y: Math.log(40000) + 0.9 * Math.log(n * n / 49) + 0.6 * (h - 1.5) + 0.1 * (rnd() - 0.5), count: 10 }; });
  const m = fitTime(pts); ok(Math.abs(m.mean[1] - 0.9) < 0.1 && Math.abs(m.mean[2] - 0.6) < 0.05 && Math.abs(Math.exp(m.mean[0]) - 40000) < 3000, JSON.stringify(m.mean));
  ok(m.sd[2] < p0.sd[2] / 3, 'posterior is tighter'); eq(predictMs({ mean: [Math.log(1), 0, 0] }, 7, 1.5), 500); eq(predictMs({ mean: [Math.log(1e9), 0, 0] }, 7, 1.5), 3600000);
  const I = invert([[2, 1, 0], [1, 3, 1], [0, 1, 4]]), P = [[2, 1, 0], [1, 3, 1], [0, 1, 4]].map(r => I[0].map((_, j) => r.reduce((a, v, k) => a + v * I[k][j], 0))); ok(P.every((r, i) => r.every((v, j) => Math.abs(v - +(i === j)) < 1e-12)));
});
t('format: commentTimes reads back the times serialize writes, and nothing else', () => {
  const p = makePuzzle(3), text = serialize(p, { times: { generateMs: 12.34, solveMs: 0, playS: 83.26 } });
  eq(commentTimes(text), { generateMs: 12.3, solveMs: 0, playS: 83.3 }); eq(commentTimes(serialize(p)), {}); eq(commentTimes('# play_time_s abc\n# note play_time_s 5\nsize 3'), {});
});
t('gotd-model: timePoints drops seed players, plays below the floor and thin days; the author time counts once above the floor', () => {
  const day = (d, n, reals, seeds) => { const all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++; return { d, n: all.length, sum: all.reduce((a, x) => a + x, 0), bins, best: [], seeds }; };
  const slow = Array.from({ length: 25 }, (_, i) => 60000 + i * 1000), fast = [3000, 4000, 5000]; // 8x8: floor 32 s
  const days = [day(1, 8, [...slow, ...fast], [20000, 70000]), day(2, 8, [...fast, ...slow.slice(0, 10)], []), day(3, 5, [...slow.slice(0, 22), 2000], [])];
  const puzzles = new Map([[1, { n: 8, h: 1.5, authorS: 90 }], [2, { n: 8, h: 1.5, authorS: 20 }], [3, { n: 5, h: 0.2 }], [4, { n: 8, h: 1, authorS: 75 }]]);
  const { points, skipped } = timePoints(days, puzzles);
  const d1 = points.find(p => p.day === 1 && p.src === 'players'); eq([d1.count, d1.seeds, d1.real], [25, 2, 28]); ok(d1.dropped === 3, 'the three plays below the floor are dropped');
  ok(Math.abs(Math.exp(d1.y) / 1000 - 72) < 8, 'median of the 25 valid plays, not of the seeds or the fast ones');
  ok(skipped.some(s => s.day === 2 && /need 20/.test(s.why)), 'day 2: 10 valid players are too few'); ok(skipped.some(s => s.day === 2 && /below the .*floor/.test(s.why)), 'day 2: author time 20 s is under the floor');
  const d3 = points.find(p => p.day === 3); eq(d3.count, 23); eq(d3.dropped, 0); // 5x5 grade 0 needs no thinking: nothing is cut
  eq(points.filter(p => p.src === 'author').map(p => p.day), [1, 4]); eq(timePoints(days, puzzles, { useAuthor: false }).points.filter(p => p.src === 'author').length, 0);
  eq(timePoints([{ ...days[0], seeds: [5000, 5000, 5000] }], new Map([[1, { n: 8, h: 1.5 }]])).skipped[0].day, 1, 'seeds that do not fit into the aggregate: day skipped');
});
t('gotd-model: playPoints keeps thin days, weights them by player count and pools sigma from days with >= 3 plays', () => {
  const day = (d, n, reals, seeds) => { const all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++; return { d, n: all.length, sum: all.reduce((a, x) => a + x, 0), bins, best: [], seeds }; };
  const days = [day(1, 8, [60000, 90000, 120000, 3000], [20000]), day(2, 8, [100000], []), day(3, 8, [3000], [])];
  const puzzles = new Map([[1, { n: 8, h: 1.5 }], [2, { n: 8, h: 1.5 }], [3, { n: 8, h: 1.5 }]]);
  const r = playPoints(days, puzzles, { sigma: 0.5 });
  eq(r.points.map(p => [p.day, p.count]), [[1, 3], [2, 1]]); ok(r.skipped.some(s => s.day === 3 && /no valid player/.test(s.why)), 'a day with only plays below the floor is skipped');
  ok(Math.abs(Math.exp(r.points[0].y) / 1000 - 90) < 9, 'geometric mean of 60, 90, 120 s'); ok(r.points[1].v > r.points[0].v, 'one player weighs less than three');
  eq(r.sigmaFit, null); ok(playPoints(days, puzzles).sigma === TIME_PRIOR.sigma, 'too little data: the prior sigma');
  const m = fitTimeSize(r.points); ok(Number.isFinite(m.mean[1]) && m.size[8], 'the points feed fitTimeSize');
});
t('gotd-model: fitTimeSize = prior without data; recovers the size exponent, the grade slope and a per-size level; global and local difficulty are consistent', () => {
  const p0 = fitTimeSize([]); eq(p0.mean.map(v => +v.toFixed(6)), TIME_PRIOR.mean.map(v => +v.toFixed(6))); eq(p0.size, {}); eq(p0.author, null);
  eq([5, 6, 7, 8, 10, 12].map(n => +sizeShift(n, p0.mean).toFixed(2)), [-0.97, -0.44, 0, 0.39, 1.03, 1.56]); // time ~ cells, x2 per grade
  let s = 5; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32, gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const U = { 6: -0.2, 8: 0.3 }, pts = Array.from({ length: 120 }, (_, i) => { const n = 6 + (i % 5), h = rnd() * 4; return { n, h, count: 30, src: 'players', y: Math.log(100000) + 1.2 * Math.log(n * n / 49) + 0.8 * (h - 1.5) + (U[n] || 0) + 0.15 * gauss() }; });
  const m = fitTimeSize(pts);
  ok(Math.abs(m.mean[1] - 1.2) < 0.12 && Math.abs(m.mean[2] - 0.8) < 0.08, 'gamma and c: ' + m.mean.map(v => v.toFixed(2)));
  ok(m.size[8].u > 0.18 && m.size[8].u < 0.4 && m.size[6].u < -0.1 && m.size[6].u > -0.3 && Math.abs(m.size[9].u) < 0.1, 'levels: ' + JSON.stringify(m.size));
  ok(sizeLevel(m, 8) > 0.2 && sizeLevel(m, 5) === 0, 'level in grades; a size without data has none');
  const one = fitTimeSize(pts.slice(0, 3)); ok(Math.abs(one.size[6].u) < Math.abs(m.size[6].u) + 0.05, 'with little data the per-size correction stays near 0');
  for (const n of [6, 8, 10]) for (const h of [0, 2.5, 5]) { const G = globalDifficulty(m, n, h); ok(Math.abs(localFromGlobal(m, n, G) - localDifficulty(m, n, h)) < 1e-12, 'local = global - shift'); ok(Math.abs(G - localDifficulty(m, n, h) - sizeShift(n, m.mean)) < 1e-12); }
  const withAuthor = fitTimeSize([...pts, { n: 7, h: 1.5, count: 1, src: 'author', y: Math.log(60000) }]); ok(withAuthor.author && Number.isFinite(withAuthor.author.u), 'author times get their own offset');
});

// ---- Replay of missed Games of Day ----
const gotdDay = (clock, k) => dateOfDay(utcDayNumber(clock()) - k); // the date k UTC days before the fake clock
const setup = async (clock = atDay(19), records = {}) => { // records: days back -> attempt record
  const st = fakeStorage(), store = createStore(st, [5]); await store.hydrate(dateOfDay(utcDayNumber(clock())));
  for (const [k, rec] of Object.entries(records)) await store.saveAttempt(gotdDay(clock, +k), rec);
  const R = createReplay(st, store, clock); await R.init(); return { st, store, R };
};
t('i18n: EN and ZH have the same keys and the same {n} placeholders', () => {
  eq(Object.keys(EN).sort(), Object.keys(ZH).sort());
  const ph = v => typeof v === 'string' ? (v.match(/\{\d+\}/g) || []).sort() : 'fn';
  for (const k of Object.keys(EN)) eq(ph(ZH[k]), ph(EN[k]), k);
  for (const k of ['replay.locked', 'replay.progress']) eq([typeof EN[k], typeof ZH[k]], ['function', 'function']);
});
t('daily: dateOfDay inverts utcDayNumber across month and year ends', () => {
  for (const d of [new Date(Date.UTC(2026, 8, 30, 23, 59)), new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2025, 11, 31, 12)), new Date(Date.UTC(2024, 1, 29))]) eq(dateOfDay(utcDayNumber(d)), utcDateString(d));
  eq(dateOfDay(utcDayNumber(new Date(Date.UTC(2026, 0, 1))) - 1), '20251231');
});
ta('daily: fetchGameOfDayFor reads that date\'s file, null when missing; only today\'s file bypasses the cache', async () => {
  const realFetch = globalThis.fetch, calls = [];
  const puzzle = serialize(runSync(generate(5, 1))); // a valid puzzle file
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return url.endsWith('20260918.txt') ? { ok: true, text: async () => puzzle } : { ok: false, text: async () => '' }; };
  try {
    const p = await fetchGameOfDayFor('20260918'); ok(p && p.n === 5 && p.gotdDate === '20260918'); eq(calls[0], ['../demo/GameOfDay/20260918.txt', undefined]);
    eq(await fetchGameOfDayFor('20260917'), null);
    await fetchGameOfDayFor('20260918', { fresh: true }); eq(calls[2][1], { cache: 'no-store' });
  } finally { globalThis.fetch = realFetch; }
});
ta('replay: chances = floor(solved / 5) - used; toNext counts the solves still needed', async () => {
  const { R } = await setup(); eq([R.chances(), R.toNext()], [0, GAMES_PER_CHANCE]);
  for (let i = 1; i <= 12; i++) { await R.addSolved(); eq([R.chances(), R.toNext()], [Math.floor(i / 5), 5 - (i % 5)], 'after ' + i); }
  eq(GAMES_PER_CHANCE, 5);
});
ta('replay: window = yesterday .. REPLAY_DAYS days back (today excluded), newest first; across a year end', async () => {
  const clock = atDay(19), { R } = await setup(clock); eq(R.dates().length, REPLAY_DAYS); eq([R.dates()[0], R.dates().at(-1)], [gotdDay(clock, 1), gotdDay(clock, REPLAY_DAYS)]);
  const ny = () => new Date(Date.UTC(2026, 0, 3, 23, 59)), { R: N } = await setup(ny); eq(N.dates()[0], '20260102'); ok(N.dates().includes('20251231') && !N.dates().includes('20260103'), 'crosses the year end, today left out');
});
ta('replay: missed = window dates without an attempt record; an unsolved (abandoned) record is not missed', async () => {
  ok(REPLAY_DAYS >= 4, 'the fixture needs a window of at least 4 days'); const clock = atDay(19), N = REPLAY_DAYS, g = k => gotdDay(clock, k);
  const { R } = await setup(clock, { 0: { solved: true, time: 30 }, 1: { solved: true, time: 20 }, 3: { solved: false, time: null }, [N]: { solved: true, time: 50 }, [N + 1]: { solved: true, time: 50 } });
  const m = await R.missed(); eq(m.length, N - 3, 'window days minus the 3 that have a record (1, 3 and N days back; 0 and N+1 are outside)');
  eq([g(1), g(3), g(N)].map(d => m.includes(d)), [false, false, false]); eq([g(2), g(4)].map(d => m.includes(d)), [true, true]);
  eq(m[0], g(2), 'newest first');
});
ta('replay: days() = every window date, newest first, with its stored record (null = missed); nothing outside the window', async () => {
  const solved = { solved: true, time: 21.5, sent: true, stats: { n: 4, mean: 30, top: null, pct: 50 } }, abandoned = { solved: false, time: null };
  ok(REPLAY_DAYS >= 4, 'the fixture needs a window of at least 4 days'); const clock = atDay(19), N = REPLAY_DAYS;
  const { R } = await setup(clock, { 0: { solved: true, time: 9 }, 1: solved, 3: abandoned, [N]: solved, [N + 1]: solved });
  const d = await R.days(); eq(d.length, N); eq([d[0].date, d[N - 1].date], [gotdDay(clock, 1), gotdDay(clock, N)]);
  eq(d.map(x => x.attempt === null ? 'missed' : x.attempt.solved ? 'played' : 'abandoned'), Array.from({ length: N }, (_, i) => i === 0 || i === N - 1 ? 'played' : i === 2 ? 'abandoned' : 'missed'));
  eq(d[0].attempt, solved, 'the stored stats come back as they were saved');
  eq((await R.missed()).length, N - 3);
});
ta('replay: begin spends one chance, marks the date played, and refuses without a chance, outside the window, or twice', async () => {
  ok(REPLAY_DAYS >= 3, 'the fixture needs a window of at least 3 days'); const clock = atDay(19), g = k => gotdDay(clock, k), N = REPLAY_DAYS;
  const { R, store } = await setup(clock);
  eq(await R.begin(g(2)), false, 'no chance yet'); for (let i = 0; i < 10; i++) await R.addSolved(); eq(R.chances(), 2);
  eq(await R.begin(g(0)), false, 'today is not a replay'); eq(await R.begin(g(N + 1)), false, 'one day past the window is outside'); eq(R.chances(), 2);
  eq(await R.begin(g(2)), true); eq(R.chances(), 1); eq(store.attemptOn(g(2)), { solved: false, time: null });
  eq(await R.begin(g(2)), false, 'the same date twice'); eq(R.chances(), 1);
  eq(await R.begin(g(N)), true, 'the oldest day of the window'); eq(R.chances(), 0); eq(await R.begin(g(3)), false, 'chances used up');
  eq((await R.missed()).includes(g(2)), false);
});
ta('replay: counters persist; the first init counts the solves recorded before the feature existed, once', async () => {
  const clock = atDay(19), st = fakeStorage(), store = createStore(st, [5]); await store.hydrate('20260919');
  for (const [k, rec] of [[0, { solved: true, time: 9 }], [2, { solved: true, time: 9 }], [5, { solved: false, time: null }], [9, { solved: true, time: 9 }], [BACKFILL_DAYS, { solved: true, time: 9 }], [BACKFILL_DAYS + 1, { solved: true, time: 9 }]]) await store.saveAttempt(dateOfDay(utcDayNumber(clock()) - k), rec);
  const A = createReplay(st, store, clock); await A.init(); eq([A.chances(), A.toNext()], [0, 1], '4 solves counted (the unsolved record and the one past the scan are not)');
  await A.addSolved(); const B = createReplay(st, createStore(st, [5]), clock); await B.init(); eq([B.chances(), B.toNext()], [1, 5], 'reloaded: 5 solved, not recounted');
  await store.saveAttempt('20260918', { solved: true, time: 9 }); const C = createReplay(st, store, clock); await C.init(); eq(C.toNext(), 5, 'a stored counter is never rebuilt from records');
});
ta('replay: a corrupt counter is rebuilt from the records; before init there are no chances', async () => {
  const st = fakeStorage(), store = createStore(st, [5]); await store.hydrate('20260919'); await store.saveAttempt('20260919', { solved: true, time: 9 });
  await st.set('zip_gotd_credit', '{"solved":-1}'); const R = createReplay(st, store, atDay(19)); eq([R.chances(), R.toNext()], [0, 5]); await R.init(); eq(R.toNext(), 4);
});
ta('replay: unsent = solved attempts of today and the window the backend never acknowledged', async () => {
  ok(REPLAY_DAYS >= 6, 'the fixture needs a window of at least 6 days');
  const { R } = await setup(atDay(19), { 0: { solved: true, time: 30, sent: false }, 2: { solved: true, time: 41.5, sent: false }, 4: { solved: true, time: 20, sent: true }, 5: { solved: true, time: 20 }, 6: { solved: false, time: null }, [REPLAY_DAYS + 1]: { solved: true, time: 7, sent: false } });
  eq(await R.unsent(), [{ date: '20260919', time: 30 }, { date: '20260917', time: 41.5 }]);
});
// The share flow of the play app over several page loads: finish (record + first submit), then the retry of replay.unsent() at every boot.
const GOTD_DATE = '20260919';
const finishGotdWith = async (storage, routes) => {
  const store = createStore(storage, [5]);
  await store.hydrate(GOTD_DATE);
  await store.recordGotd(5, GOTD_DATE, 42.1, true);
  const { lb, calls } = three(routes);
  await submitAttempt(lb, store, GOTD_DATE);
  return { calls, record: await store.loadAttempt(GOTD_DATE) };
};
const reloadWith = async (storage, routes) => {
  const store = createStore(storage, [5]);
  await store.hydrate(GOTD_DATE);
  const replay = createReplay(storage, store, atDay(19));
  await replay.init();
  const { lb, calls } = three(routes);
  for (const { date } of await replay.unsent()) await submitAttempt(lb, store, date);
  return { calls: [...calls].sort(), record: await store.loadAttempt(GOTD_DATE), unsent: await replay.unsent() };
};
ta('share flow: backups that stay down are retried MAX_ROUNDS times, always is never written twice', async () => {
  const st = fakeStorage();
  const backupsDown = { ...ALL, 'w.example': down, 's.example': down };
  const first = await finishGotdWith(st, backupsDown);
  eq([...first.calls].sort(), ['asia.example', 's.example', 'w.example']);
  eq(first.record, { solved: true, time: 42.1, sent: false, stats: SUM(30), statsFrom: 'asia', done: ['asia'], rounds: 1 });
  const second = await reloadWith(st, backupsDown);
  eq([second.calls, second.record.rounds, second.record.sent], [['s.example', 'w.example'], 2, false]);
  const third = await reloadWith(st, backupsDown);
  eq([third.calls, third.record, third.unsent], [['s.example', 'w.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []]);
  eq((await reloadWith(st, backupsDown)).calls, [], 'given up: nothing is sent any more');
});
ta('share flow: a backup that comes back completes the record without touching always', async () => {
  const st = fakeStorage();
  await finishGotdWith(st, { ...ALL, 'w.example': down, 's.example': down });
  const later = await reloadWith(st, ALL);
  eq([later.calls, later.record, later.unsent], [['w.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []]);
});
ta('share flow: always was down: the backup\'s summary is shown, then replaced by always\'s on the retry', async () => {
  const st = fakeStorage();
  const first = await finishGotdWith(st, { ...ALL, 'asia.example': down });
  eq(first.record, { solved: true, time: 42.1, sent: false, stats: SUM(40), statsFrom: 'cloudflare', done: ['cloudflare'], rounds: 1 });
  const later = await reloadWith(st, ALL);
  eq([later.calls, later.record, later.unsent], [['asia.example'], { solved: true, time: 42.1, sent: true, stats: SUM(30) }, []]);
});
ta('share flow: offline = nothing stored, every page load tries again without using up rounds', async () => {
  const st = fakeStorage();
  const offline = { 'asia.example': down, 'w.example': down, 's.example': down };
  eq((await finishGotdWith(st, offline)).record, { solved: true, time: 42.1, sent: false });
  for (let i = 0; i < 5; i++) eq((await reloadWith(st, offline)).record, { solved: true, time: 42.1, sent: false });
  const online = await reloadWith(st, ALL);
  eq([online.calls, online.record.sent, online.record.stats], [['asia.example', 'w.example'], true, SUM(30)]);
});
ta('stats-store: a replay keeps today\'s record and the per-size Game-of-Day time; attemptOn reads any loaded date', async () => {
  const st = fakeStorage(), S = createStore(st, [5]); await S.hydrate('20260929');
  await S.recordGotd(5, '20260929', 42.1, true); eq(S.gotdBest(5), { date: '20260929', time: 42.1 });
  await S.recordGotd(5, '20260920', 9.5, true, true);
  eq(S.gotdBest(5), { date: '20260929', time: 42.1 }); eq(S.attempt(), { solved: true, time: 42.1, sent: false }); eq(S.attemptDate(), '20260929');
  eq(S.attemptOn('20260920'), { solved: true, time: 9.5, sent: false });
  const S2 = createStore(st, [5]); await S2.hydrate('20260929'); eq(S2.attemptOn('20260920'), null, 'not loaded yet'); eq(await S2.loadAttempt('20260920'), { solved: true, time: 9.5, sent: false });
});

// ---- Share link: codec, color strip, receiver status, shared replay ----
const GOTD_REC = { kind: 'gotd', n: 7, grade: 3, timeS: 72.4, day: dayOfDate('20261007'), pct: 83, levels: [0, 0, 1, 0, 3, 2, 0] };
const LOCAL_REC = { kind: 'local', n: 12, grade: null, timeS: 1234.5, day: dayOfDate('20261007'), index: 41, algo: ALGO_VERSION, levels: [] };
t('share-code: Game of Day and local records round-trip; codes are URL-safe and short', () => {
  for (const rec of [GOTD_REC, LOCAL_REC, { ...GOTD_REC, pct: null, grade: null }, { ...GOTD_REC, pct: 0, grade: 0, n: 31 }, { ...LOCAL_REC, index: 1023, levels: Array(MAX_LEGS).fill(3) }]) {
    const code = encodeShare(rec);
    ok(/^[A-Za-z0-9_-]+$/.test(code), code);
    eq(decodeShare(code), rec);
  }
  ok(encodeShare(GOTD_REC).length <= 14, 'a Game of Day with 7 legs is at most 14 characters');
  ok(encodeShare(LOCAL_REC).length <= 16, 'a local game without strip is at most 16 characters');
  ok(ALGO_VERSION <= 15 && SHARE_VERSION === 1, 'algo version must fit 4 bits: widen the field (and SHARE_VERSION) before bumping past 15');
});
t('share-code: time is kept in tenths, clamped at 13107.1 s; a strip longer than 63 legs is dropped', () => {
  eq(decodeShare(encodeShare({ ...GOTD_REC, timeS: 72.44 })).timeS, 72.4);
  eq(decodeShare(encodeShare({ ...GOTD_REC, timeS: 1e6 })).timeS, 13107.1);
  eq(decodeShare(encodeShare({ ...GOTD_REC, levels: Array(MAX_LEGS + 1).fill(1) })).levels, []);
});
t('share-code: out-of-range fields are not encoded', () => {
  for (const bad of [{ n: 1 }, { n: 32 }, { grade: 6 }, { timeS: 0 }, { timeS: NaN }, { day: -1 }, { day: 65536 }, { pct: 101 }, { levels: [4] }, { kind: 'x' }]) eq(encodeShare({ ...GOTD_REC, ...bad }), null, JSON.stringify(bad));
  for (const bad of [{ index: 1024 }, { algo: 16 }, { algo: -1 }]) eq(encodeShare({ ...LOCAL_REC, ...bad }), null, JSON.stringify(bad));
  eq(encodeShare(null), null);
});
t('share-code: damaged codes are rejected (empty, truncated, extended, foreign characters, mistyped character)', () => {
  const code = encodeShare(GOTD_REC);
  for (const bad of ['', null, undefined, 42, code.slice(0, -1), code + 'A', code + 'AA', code.slice(0, 5), code + '=', ' ' + code, 'AAAAAAAAAAAAAA']) eq(decodeShare(bad), null, String(bad));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let tried = 0, accepted = 0;
  for (let i = 0; i < code.length; i++) for (const ch of alphabet) {
    if (ch === code[i]) continue;
    tried++;
    if (decodeShare(code.slice(0, i) + ch + code.slice(i + 1))) accepted++;
  }
  ok(accepted / tried < 0.02, `an 8-bit check lets ~0.4% of single-character mistakes through, got ${accepted}/${tried}`);
});
t('share: levelOf thresholds and legLevels (K-1 legs; extra legs merge into the last; none for K<2 or too many)', () => {
  eq([0, 1, 2, 3, 6, 7, 99].map(levelOf), [0, 1, 1, 2, 2, 3, 3]);
  eq(legLevels([2, , 9], 3), [1, 3]);          // leg 2 (index 2) is beyond K-1 = 2 legs: merged into the last
  eq(legLevels([], 4), [0, 0, 0]);
  eq([legLevels([1], 1), legLevels([1], 0), legLevels([], MAX_LEGS + 2)], [[], [], []]);
  eq(legLevels([], MAX_LEGS + 1).length, MAX_LEGS);
  eq(stripText([0, 1, 2, 3]), LEVEL_EMOJI.join(''));
});
t('share: legsUndo credits every removed cell to the leg it was drawn in (the cell that is checkpoint k+1 closes leg k)', () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[2] = 2; p.cp[8] = 3;
  const reset = [], a = [0, 1, 2, 5];
  legsUndo(reset, p, a, 1);                              // cells 1 and 2 are leg 0 (2 closes it), cell 5 is leg 1
  eq([reset[0], reset[1]], [2, 1]);
  const legs = []; legsUndo(legs, p, [0, 1, 4], 2); legsUndo(legs, p, [0, 1], 1);   // two one-step undos inside leg 0
  eq([legs[0], legs[1]], [2, undefined]);
  const trunc = []; legsUndo(trunc, p, [0, 1, 2, 5, 4], 3);                          // cut back to the checkpoint: 5 and 4 are leg 1
  eq([trunc[0], trunc[1]], [undefined, 2]);
  const none = []; legsUndo(none, p, [0, 1, 2], 3); legsUndo(none, p, [], 0);
  eq(none.length, 0, 'nothing removed, nothing counted');
});
t('share: legsUndo agrees with the play trace (same moves through rules.step: total credited = cells undone)', () => {
  const p = makePuzzle(3); p.cp[0] = 1; p.cp[2] = 2; p.cp[8] = 3;
  const path = [], tr = newTrace(), legs = [];
  for (const c of [0, 1, 4, 1, 0, 3, 6, 7, 4, 1, 2, 5, 4, 5]) {
    const before = path.length, prev = path.slice(), k = step(p, path, c, { truncate: true });
    traceStep(tr, k, before, path.length);
    if (k && k !== 'push') legsUndo(legs, p, prev, path.length);
  }
  const credited = legs.reduce((a, v) => a + (v || 0), 0);
  ok(tr.backtracks === 2 && tr.undone === 5, 'the moves include a run of two undos and a cut back of three cells');
  eq(credited, tr.undone, 'every cell taken back is credited to some leg (this sequence has no reset, which would also count the start cell)');
});
t('share: makeShareRecord -> shareUrl -> parseShareLink round trip; the text carries head, time, percent, strip and the link', () => {
  const legs = [0, 1, 7];
  const sorted = o => Object.fromEntries(Object.entries(o).sort()); // key order is not part of the contract
  const g = makeShareRecord({ gotdDate: '20261007', n: 7, grade: 3, timeS: 72.44, pct: 83, day: null, index: 0, algo: ALGO_VERSION, legs, K: 4 });
  eq(sorted(g), sorted({ kind: 'gotd', n: 7, grade: 3, timeS: 72.4, levels: [0, 1, 3], day: dayOfDate('20261007'), pct: 83 }));
  const url = shareUrl('https://x.example/zip/', g);
  ok(url.startsWith('https://x.example/zip/?s=') && !url.includes('%'), url);
  const parsed = parseShareLink(new URL(url).search);
  eq([sorted(parsed.rec), parsed.bad], [sorted(g), false]);
  eq(shareText(g, url, tr), `Zip · Game of Day 2026-10-07 · 7x7 · Hard 3/5\n⏱ 72.4s · beat 83%\n🟩🟨🟥\n${url}`);
  const l = makeShareRecord({ gotdDate: null, n: 8, grade: null, timeS: 40, pct: null, day: 20700, index: 2, algo: ALGO_VERSION, legs: [], K: 1 });
  eq(sorted(l), sorted({ kind: 'local', n: 8, grade: null, timeS: 40, levels: [], day: 20700, index: 2, algo: ALGO_VERSION }));
  eq(shareText(l, 'U', tr), 'Zip · 8x8 · game #3\n⏱ 40.0s\nU');
  eq(parseShareLink(''), { rec: null, bad: false });
  eq(parseShareLink('?s=garbage'), { rec: null, bad: true });
  eq(sorted(parseShareLink('?lb=x&s=' + encodeShare(l)).rec), sorted(l));
  eq(dayOfDate(dateOfDay(20733)), 20733);
});
t('share: shareStatus = what the receiver may do (live / replay / ok) or why not', () => {
  const clock = atDay(19), today = utcDayNumber(clock()), window = Array.from({ length: REPLAY_DAYS }, (_, i) => dateOfDay(today - 1 - i));
  const ctx = (attempt = null) => ({ today, replayDates: window, attempt, algo: ALGO_VERSION, sizes: PLAY_SIZES });
  const day = k => ({ ...GOTD_REC, day: today - k });
  eq(shareStatus(day(0), ctx()).status, 'live');
  eq(shareStatus(day(1), ctx()).status, 'replay');
  eq(shareStatus(day(REPLAY_DAYS), ctx()).status, 'replay');
  eq(shareStatus(day(REPLAY_DAYS + 1), ctx()).status, 'old');
  eq(shareStatus(day(-1), ctx()).status, 'future');
  eq(shareStatus(day(0), ctx({ solved: true, time: 30 })).status, 'played');
  eq(shareStatus(day(3), ctx({ solved: false, time: null })).status, 'played');
  eq(shareStatus(day(-1), ctx({ solved: true, time: 30 })).status, 'future', 'a future date is refused before anything else');
  eq(shareStatus({ ...LOCAL_REC, n: 7 }, ctx()).status, 'ok');
  eq(shareStatus({ ...LOCAL_REC, n: 7, algo: ALGO_VERSION - 1 }, ctx()).status, 'version');
  eq(shareStatus({ ...LOCAL_REC, n: 3 }, ctx()).status, 'invalid', 'a size the generator does not serve');
  eq(['live', 'replay', 'ok', 'played', 'old', 'future', 'version', 'invalid'].map(status => isPlayable({ status })), [true, true, true, false, false, false, false, false]);
});
t('share: the local seed a link names is the seed the game was made with (day, size, index, version -> same puzzle)', () => {
  const day = 20733, n = 5, index = 3, seed = dailySeed(day, n, index, ALGO_VERSION);
  const g = generate(n, seed), h = generate(n, dailySeed(day, n, index, ALGO_VERSION));
  eq(serialize(runSync(g)), serialize(runSync(h)));
  ok(dailySeed(day - 1, n, index, ALGO_VERSION) !== seed && dailySeed(day, n, index + 1, ALGO_VERSION) !== seed);
});
ta('replay: beginShared opens a missed window day without spending a chance; same window / once rules; refuses before init()', async () => {
  const clock = atDay(19), { R, store } = await setup(clock, { 2: { solved: true, time: 30 } }), g = k => gotdDay(clock, k);
  const solved0 = R.toNext();
  eq(await R.beginShared(g(3)), true);
  eq(store.attemptOn(g(3)), { solved: false, time: null }, 'the date is spent, like begin()');
  eq(R.chances(), 0);
  eq(await R.beginShared(g(3)), false, 'once per date');
  eq(await R.beginShared(g(2)), false, 'already has a record');
  eq(await R.beginShared(g(REPLAY_DAYS + 1)), false, 'outside the window');
  eq(await R.beginShared(g(0)), false, 'today is the live game, not a replay');
  await R.addSolved();
  eq(R.toNext(), solved0 - 1, 'solving it counts towards the next replay chance');
  while (R.chances() < 1) await R.addSolved();
  const chances = R.chances();
  eq(await R.beginShared(g(4)), true);
  eq(R.chances(), chances, 'a shared replay costs no chance');
  const st = fakeStorage(), cold = createReplay(st, createStore(st, [5]), clock);
  eq(await cold.beginShared(g(5)), false, 'before init() there is no credit to count the solve in');
});

for (const [name, fn] of pending) { const t0 = Date.now(); try { await fn(); pass++; out.push(`ok    ${name} (${Date.now() - t0}ms)`); } catch (e) { fail++; out.push(`FAIL  ${name}: ${e.message}`); } }
const text = out.join('\n') + `\n\n${pass} passed, ${fail} failed`;
if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; } else { console.log(text); if (fail) process.exit(1); }
