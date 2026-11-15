// Unit tests of the solver: pruning, propagation, forced edges, leg collisions, connectivity.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import {
  makePuzzle, clonePuzzle, maxNumber, endCell, checkpointCells,
} from '../../src/core/model.js';
import { edgeId, edgeCells, allEdges, setWallId, hasWallId } from '../../src/core/edges.js';
import { parse } from '../../src/core/format.js';
import { makeRng } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { step } from '../../src/core/rules.js';
import { boardConnectivity, boardLegCollide } from '../../src/core/connectivity.js';
import {
  buildNeighbors, makeNoDeadEnd, forcedEdges, legsCollide, legConflicts, segBlocker,
} from '../../src/core/solver/prune.js';
import { makePropagator } from '../../src/core/solver/propagate.js';
import { makeIncremental } from '../../src/core/solver/incremental.js';
import { randomPathPuzzle } from '../../src/core/gen/generate.js';
import { refNodeCap, REF_FLAGS } from '../../src/core/difficulty.js';
import { solutionPath, trapProfile, TRAP_CFG } from '../../src/core/trap.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { cachedSamples, randPuzzle, sampleUniquePuzzles } from './helpers.js';

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

// The pruning options (prune2, prop, seg, parity, pocket, legCollide) only prune: with any of them on, in any combination, the
// solver finds the same solutions in the same order, and visits no more nodes than without.
const PRUNE_OPTIONS = { prune2: [true], prop: [true], seg: [true, 'all'], parity: [true], pocket: [true], legCollide: [true] };

const ALL_PRUNES = { prune2: true, prop: true, seg: 'all', parity: true, pocket: true, legCollide: true };

t('solver: plain and with every pruning option (alone, all together) match brute force (n=3,4; random walls/checkpoints)', () => {
  const sets = [{}, ALL_PRUNES, ...Object.entries(PRUNE_OPTIONS).flatMap(([name, levels]) => levels.map(level => ({ [name]: level })))];
  for (let s = 1; s <= 120; s++) {
    const n = 3 + (s % 2), p = randPuzzle(s, n, 2 + (s % 4), 0.15 * (s % 4)), expected = brute(p);
    for (const extra of sets) {
      const r = solve(p, { limit: 1e9, nodeCap: 1e7, ...extra });
      ok(!r.exceeded);
      eq(r.count, expected, `case ${s} ${JSON.stringify(extra)}`);
    }
  }
});

t.slow('solver: every pruning option alone, all together, and random combinations keep count, paths and DFS order, and never cost a node', () => {
  const rnd = makeRng(2024), names = Object.keys(PRUNE_OPTIONS), pick = list => list[Math.floor(rnd() * list.length)];
  const singles = names.flatMap(name => PRUNE_OPTIONS[name].map(level => ({ [name]: level })));
  let toggles = 0;
  for (let s = 1; s <= 150; s++) {
    const n = 3 + (s % 4), p = randPuzzle(s, n, 2 + (s % 5), 0.05 * (s % 9));
    for (const limit of [2, 1e9]) {
      const run = extra => { const r = solve(p, { ...extra, limit, nodeCap: 3e6, capture: true }); ok(!r.exceeded, `case ${s}`); return r; };
      const plain = run({});
      // `extra` finds what plain finds and costs no more than `than` (plain, or the same set without one option)
      const check = (extra, than = plain) => {
        const r = run(extra), what = `case ${s} limit ${limit} ${JSON.stringify(extra)}`;
        eq(r.count, plain.count, `count ${what}`);
        eq(r.paths, plain.paths, `paths ${what}`);
        ok(r.nodes <= than.nodes, `nodes ${what}`);
        return r;
      };
      check(singles[(s + (limit === 2 ? 0 : 3)) % singles.length]); // the option under test rotates: each meets every kind of puzzle
      check(ALL_PRUNES);
      const on = {};
      for (const name of names) if (rnd() < 0.4) on[name] = pick(PRUNE_OPTIONS[name]);
      const base = check(on), off = names.filter(name => !(name in on));
      if (off.length) { // one more option on top of a random set
        const name = pick(off);
        check({ ...on, [name]: pick(PRUNE_OPTIONS[name]) }, base);
        toggles++;
      }
    }
  }
  ok(toggles > 250, `${toggles} toggles checked`);
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

t.slow('solver: incremental prop, fast path and local connectivity change nothing but speed (nodes, count, paths, DFS order, decision counters)', () => {
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

registerAsyncTests();
