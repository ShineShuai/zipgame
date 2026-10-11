// Tests of the "One way arrows" core: arrow edges (core/edges.js), the rules (core/rules.js) and
// the directed solver (core/solver/solve-dir.js). Registered by tests.js: directedTests(t, ok,
// eq).
import {
  makePuzzle, clonePuzzle, validate, cellCount, startCell, endCell, maxNumber,
} from '../src/core/model.js';
import {
  edgeId, allEdges, setWallId, setArrowId, arrowDirId, arrowAllows, arrowMove, arrowIds,
  arrowCount, arrowProblem,
} from '../src/core/edges.js';
import { canStep, step } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { buildMoves } from '../src/core/solver/solve-dir.js';
import { makeDirPropagator } from '../src/core/solver/propagate-dir.js';
import { makeDirIncremental } from '../src/core/solver/incremental-dir.js';
import { startMemo } from '../src/core/solver/memo-dir.js';
import { generateArrows } from '../src/core/gen/arrows.js';
import { runSync } from '../src/core/run.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { backbite } from '../src/core/gen/hampath.js';
import { randomCheckpoints } from '../src/core/gen/checkpoints.js';

// Random puzzle with arrows (and optionally walls and holes): K numbered cells at random,
// arrowFrac / wallFrac of the edges carry an arrow (random direction) / a wall.
function randomArrowPuzzle(seed, n, K, arrowFrac, wallFrac = 0, holeCount = 0) {
  const rnd = makeRng(seed);
  const p = makePuzzle(n);
  p.arrows = new Uint8Array(n * n);
  if (holeCount) {
    p.holes = new Uint8Array(n * n);
    shuffle([...Array(n * n).keys()], rnd).slice(0, holeCount).forEach(c => { p.holes[c] = 1; });
  }
  const cells = [...Array(n * n).keys()].filter(c => !(p.holes && p.holes[c]));
  shuffle(cells, rnd).slice(0, K).forEach((c, i) => { p.cp[c] = i + 1; });
  for (const e of allEdges(n, p.holes)) {
    const r = rnd();
    if (r < wallFrac) setWallId(p.walls, e, true);
    else if (r < wallFrac + arrowFrac) setArrowId(p.arrows, e, rnd() < 0.5 ? 1 : -1);
  }
  return p;
}

// Puzzle that has a solution: a random Hamiltonian path with K checkpoints along it, arrows on
// arrowFrac of the edges (an arrow on a path edge points along the path; the others point
// anywhere), so there are one or several solutions.
function plantedArrowPuzzle(seed, n, K, arrowFrac) {
  const rnd = makeRng(seed);
  const path = backbite(n, rnd);
  const p = makePuzzle(n);
  p.arrows = new Uint8Array(n * n);
  randomCheckpoints(path.length, K, rnd).forEach((at, i) => { p.cp[path[at]] = i + 1; });
  const along = new Map();
  for (let i = 1; i < path.length; i++) {
    along.set(edgeId(n, path[i - 1], path[i]), path[i - 1] < path[i] ? 1 : -1);
  }
  for (const e of allEdges(n)) {
    if (rnd() >= arrowFrac) continue;
    setArrowId(p.arrows, e, along.get(e) ?? (rnd() < 0.5 ? 1 : -1));
  }
  return p;
}

// Every solution by plain enumeration over the rules (canStep) and the checkpoint order, as sorted
// "a,b,c" strings.
function brute(p) {
  const T = p.n * p.n;
  const K = maxNumber(p);
  const total = cellCount(p);
  const end = endCell(p);
  const vis = new Uint8Array(T);
  const path = [];
  const found = [];
  const go = (cell, need) => {
    vis[cell] = 1;
    path.push(cell);
    const mark = p.cp[cell];
    if (!mark || mark === need) {
      const next = mark ? need + 1 : need;
      if (path.length < total) {
        for (let v = 0; v < T; v++) if (!vis[v] && canStep(p, cell, v)) go(v, next);
      } else if (cell === end && next === K + 1) {
        found.push(path.join(','));
      }
    }
    vis[cell] = 0;
    path.pop();
  };
  go(startCell(p), 1);
  return found.sort();
}

// The ways to run the directed solver: incremental propagation with the leg bound and the table of
// dead positions (the default), without the table, without the leg bound, propagation recomputed
// at every node, plain DFS.
const MODES = [{}, { memo: false }, { legs: false }, { incr: false }, { prop: false }];

const solved = (p, opts = {}) => solve(p, { limit: 1e9, capture: true, nodeCap: 5e6, ...opts });
const joined = r => r.paths.map(x => x.join(',')).sort();
const usesMove = (path, a, b) => {
  const cells = path.split(',').map(Number);
  for (let i = 1; i < cells.length; i++) if (cells[i - 1] === a && cells[i] === b) return true;
  return false;
};

export function directedTests(t, ok, eq) {
  t('arrows: the edge codec sets, reads, flips and clears one direction per edge', () => {
    const n = 4;
    const a = new Uint8Array(n * n);
    const right = edgeId(n, 5, 6);
    const down = edgeId(n, 5, 9);
    eq([arrowDirId(a, right), arrowDirId(a, down)], [0, 0]);
    setArrowId(a, right, 1);
    setArrowId(a, down, -1);
    eq([arrowDirId(a, right), arrowDirId(a, down)], [1, -1]);
    ok(arrowAllows(a, n, 5, 6) && !arrowAllows(a, n, 6, 5), 'right arrow: 5 -> 6 only');
    ok(arrowAllows(a, n, 9, 5) && !arrowAllows(a, n, 5, 9), 'up arrow: 9 -> 5 only');
    ok(arrowAllows(a, n, 0, 1) && arrowAllows(a, n, 1, 0), 'an edge without an arrow is two-way');
    setArrowId(a, right, -1);
    ok(arrowAllows(a, n, 6, 5) && !arrowAllows(a, n, 5, 6), 'flipped');
    eq(arrowMove(n, right, -1), [6, 5]);
    eq(arrowMove(n, down, 1), [5, 9]);
    setArrowId(a, right, 0);
    eq(arrowDirId(a, right), 0);
    eq(a[5], (1 << 1) | (1 << 3), 'clearing leaves only the down arrow bits of that cell');
    eq(arrowDirId(a, down), -1, 'the other edge is untouched');
    const p = { n, arrows: a };
    eq([arrowCount(p), arrowIds(p)], [1, [down]]);
    eq(arrowIds({ n, cp: new Uint16Array(16), walls: new Uint8Array(16) }), []);
  });

  t('arrows: validate (size, bits, border, hole, wall) and clonePuzzle know the field', () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    p.arrows = new Uint8Array(9);
    setArrowId(p.arrows, edgeId(3, 4, 5), 1);
    eq(validate(p).ok, true);
    const q = clonePuzzle(p);
    q.arrows[0] = 1;
    eq(p.arrows[0], 0, 'the clone has its own array');
    eq(clonePuzzle(makePuzzle(3)).arrows, undefined);
    const bad = fn => {
      const c = clonePuzzle(p);
      fn(c);
      return validate(c);
    };
    ok(!bad(c => { c.arrows = new Uint8Array(8); }).ok, 'wrong size');
    ok(!bad(c => { c.arrows[2] = 1; }).ok, 'right arrow on the last column');
    ok(!bad(c => { c.arrows[6] = 2; }).ok, 'down arrow on the last row');
    ok(!bad(c => { c.arrows[0] = 4; }).ok, 'direction bit without an arrow');
    ok(!bad(c => { c.holes = new Uint8Array(9); c.holes[5] = 1; }).ok, 'arrow next to a hole');
    ok(!bad(c => { setWallId(c.walls, edgeId(3, 4, 5), true); }).ok, 'arrow and wall on one edge');
    eq(arrowProblem(p), null);
  });

  t('rules: an arrow lets canStep go one way only; undoing a step is still free', () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    p.arrows = new Uint8Array(9);
    setArrowId(p.arrows, edgeId(3, 0, 1), 1);
    ok(canStep(p, 0, 1) && !canStep(p, 1, 0) && canStep(p, 0, 3) && canStep(p, 3, 0));
    const path = [];
    for (const c of [0, 1]) eq(step(p, path, c), 'push');
    eq(step(p, path, 0), 'pop', 'undo across the one-way edge');
    eq(step(p, path, 3), 'push');
    eq(step(p, path, 0), 'pop');
    eq(step(p, path, 1), 'push', 'with the arrow');
  });

  t('solve: 3x3, two snakes; an arrow kills the one walking it backwards, none must cross', () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    p.arrows = new Uint8Array(9);
    const paths = () => joined(solved(p));
    eq(paths(), ['0,1,2,5,4,3,6,7,8', '0,3,6,7,4,1,2,5,8']);
    setArrowId(p.arrows, edgeId(3, 4, 5), 1);
    eq(paths(), ['0,3,6,7,4,1,2,5,8'], '4 -> 5: the row snake walks 5 -> 4');
    setArrowId(p.arrows, edgeId(3, 4, 5), -1);
    eq(paths(), ['0,1,2,5,4,3,6,7,8', '0,3,6,7,4,1,2,5,8'], '5 -> 4: column snake skips it');
    const r = solve(p);
    eq([r.count, r.exceeded], [2, false]);
    eq(solve(p, { limit: 1 }).count, 1, 'limit stops the search');
  });

  t('solve: an all-zero arrows array gives the standard solver\'s solutions', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const n = 4 + (seed % 2);
      const std = randomArrowPuzzle(seed, n, 3 + (seed % 3), 0, 0.3);
      delete std.arrows;
      const withZeros = clonePuzzle(std);
      withZeros.arrows = new Uint8Array(n * n);
      eq(joined(solved(withZeros)), joined(solved(std)), `seed ${seed}`);
    }
  });

  t('solve-dir: buildMoves gives consistent out- and in-neighbours', () => {
    const p = randomArrowPuzzle(7, 5, 3, 0.3, 0.1, 2);
    const { out, pre, T } = buildMoves(p);
    let moves = 0;
    for (let u = 0; u < T; u++) {
      for (let d = 0; d < 4; d++) {
        const v = out[u * 4 + d];
        if (v < 0) continue;
        moves++;
        ok(canStep(p, u, v), `move ${u} -> ${v} is a legal step`);
        ok([0, 1, 2, 3].some(k => pre[v * 4 + k] === u), `${u} is a predecessor of ${v}`);
      }
    }
    let preds = 0;
    for (let i = 0; i < T * 4; i++) if (pre[i] >= 0) preds++;
    eq(preds, moves);
    for (let u = 0; u < T; u++) {
      for (let v = 0; v < T; v++) {
        const listed = [0, 1, 2, 3].some(d => out[u * 4 + d] === v);
        eq(listed, canStep(p, u, v), `${u} -> ${v}`);
      }
    }
  });

  // The solver against plain enumeration: same solution set for random arrows, walls and holes.
  const differential = (name, cases, make) => t(`solve-dir: ${name} match brute force`, () => {
    let total = 0;
    let multi = 0;
    for (const [seed, n, K, arrowFrac, wallFrac, holes] of cases) {
      const p = make(seed, n, K, arrowFrac, wallFrac, holes);
      const want = brute(p);
      total += want.length;
      if (want.length > 1) multi++;
      const cells = want.length ? want[0].split(',').map(Number) : [];
      const rnd = makeRng(seed * 31 + 5);
      const picks = [[cells[2], cells[3]], [cells[3], cells[2]]];
      for (let i = 0; i < 2; i++) {
        const a = (rnd() * n * n) | 0;
        const b = canStep(p, a, a + 1) ? a + 1 : a + n;
        if (b < n * n) picks.push([a, b]);
      }
      const prefix = cells.slice(0, 4);
      const below = want.filter(x => x.startsWith(prefix.join(',') + ','));
      for (const mode of MODES) {
        const tag = `seed ${seed} n ${n} K ${K} ${JSON.stringify(mode)}`;
        const got = solved(p, mode);
        ok(!got.exceeded, `${tag}: not capped`);
        eq(joined(got), want, tag);
        const lim = solve(p, { nodeCap: 5e6, ...mode });
        eq(lim.count, Math.min(2, want.length), `${tag}: default limit 2`);
        if (!want.length) continue;
        for (const [a, b] of picks) {
          const using = want.filter(x => usesMove(x, a, b));
          const r = solved(p, { mustUse: [a, b], ...mode });
          eq(joined(r), using, `${tag}: mustUse ${a}->${b}`);
        }
        eq(solved(p, { forced: prefix, ...mode }).count, below.length, `${tag}: forced ${prefix}`);
      }
    }
    const enough = total >= cases.length / 2 && multi >= cases.length / 10;
    ok(enough || make === randomArrowPuzzle, `weak coverage: ${total} solutions, ${multi} multi`);
  });
  const cases3 = [];
  for (let s = 1; s <= 50; s++) cases3.push([s, 3, 2 + (s % 3), 0.1 + (s % 5) * 0.1]);
  const cases4 = [];
  for (let s = 1; s <= 50; s++) cases4.push([100 + s, 4, 2 + (s % 4), 0.05 + (s % 6) * 0.07]);
  const cases5 = [];
  for (let s = 1; s <= 30; s++) cases5.push([300 + s, 5, 3 + (s % 4), 0.05 + (s % 4) * 0.06]);
  const mixed = [];
  for (let s = 1; s <= 60; s++) {
    mixed.push([500 + s, 4, 2 + (s % 3), (s % 4) * 0.12, s % 3 === 0 ? 0.1 : 0, s % 2 ? 2 : 0]);
  }
  differential('3x3 planted puzzles', cases3, plantedArrowPuzzle);
  differential('4x4 planted puzzles', cases4, plantedArrowPuzzle);
  differential('5x5 planted puzzles', cases5, plantedArrowPuzzle);
  differential('4x4 random puzzles with walls and holes', mixed, randomArrowPuzzle);

  t('propagate-dir: along every solution the position stays feasible and keeps its moves', () => {
    let positions = 0;
    let forcedSomething = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = 4 + (seed % 3);
      const p = plantedArrowPuzzle(700 + seed, n, 3 + (seed % 4), 0.1 + (seed % 5) * 0.07);
      const sols = solve(p, { limit: 4, capture: true, prop: false, nodeCap: 5e6 }).paths;
      const moves = buildMoves(p);
      const vis = new Uint8Array(n * n);
      const prop = makeDirPropagator(moves, endCell(p), vis);
      for (const sol of sols) {
        vis.fill(0);
        for (let m = 1; m < sol.length; m++) {
          const head = sol[m - 1];
          vis[head] = 1;
          ok(prop.deduce(head, sol.length - m + 1), `seed ${seed}: position ${m} of ${sol}`);
          for (let i = m - 1; i < sol.length - 1; i++) {
            const d = [0, 1, 2, 3].find(e => moves.out[sol[i] * 4 + e] === sol[i + 1]);
            const kept = (prop.av[sol[i]] >> d) & 1;
            ok(kept, `seed ${seed}: ${sol[i]}->${sol[i + 1]} dropped at ${m}`);
          }
          positions++;
          const open = [0, 1, 2, 3].filter(e => {
            const v = moves.out[head * 4 + e];
            return v >= 0 && !vis[v];
          });
          if (open.some(e => !((prop.av[head] >> e) & 1))) forcedSomething++;
        }
      }
    }
    ok(positions > 300, `${positions} positions`);
    ok(forcedSomething > 10, `only ${forcedSomething} positions where the head loses a move`);
  });

  t('solve-dir: propagation visits far fewer nodes than the plain search, same solutions', () => {
    let on = 0;
    let off = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const p = plantedArrowPuzzle(1000 + seed, 6, 6, 0.15);
      const a = solved(p);
      const b = solved(p, { prop: false });
      eq(joined(a), joined(b), `seed ${seed}`);
      on += a.nodes;
      off += b.nodes;
    }
    ok(on * 3 < off, `${on} nodes with propagation, ${off} without`);
  });

  t('incremental-dir: the same position as the recomputed propagation, move by move', () => {
    let positions = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = 4 + (seed % 3);
      const p = plantedArrowPuzzle(900 + seed, n, 3 + (seed % 4), 0.1 + (seed % 5) * 0.07);
      const sol = solve(p, { limit: 1, capture: true, prop: false, nodeCap: 5e6 }).paths[0];
      const moves = buildMoves(p);
      const start = sol[0];
      const end = sol[sol.length - 1];
      const inc = makeDirIncremental(moves, start, end, n * n);
      ok(inc.init(), `seed ${seed}: the root fails`);
      const vis = new Uint8Array(n * n);
      const scratch = makeDirPropagator(moves, end, vis);
      const root = Array.from(inc.av);
      const marks = [];
      vis[start] = 1;
      for (let m = 1; m < sol.length; m++) {
        const head = sol[m - 1];
        marks.push(inc.mark());
        ok(inc.move(head, sol[m]), `seed ${seed}: move ${m} of ${sol}`);
        const next = sol[m];
        vis[next] = 1;
        if (next === end) break;
        ok(scratch.deduce(next, sol.length - m), `seed ${seed}: recomputed position ${m}`);
        eq(inc.av[next], scratch.av[next], `seed ${seed} move ${m}: the head's moves`);
        positions++;
      }
      while (marks.length) inc.undo(marks.pop());
      eq(Array.from(inc.av), root, `seed ${seed}: undo restores the root`);
    }
    ok(positions > 200, `${positions} positions compared`);
  });

  t('incremental-dir: a move that is a contradiction fails and undoes cleanly', () => {
    const p = plantedArrowPuzzle(950, 5, 4, 0.2);
    const sol = solve(p, { limit: 1, capture: true, prop: false, nodeCap: 5e6 }).paths[0];
    const moves = buildMoves(p);
    const inc = makeDirIncremental(moves, sol[0], sol[sol.length - 1], 25);
    ok(inc.init());
    const root = Array.from(inc.av);
    let refused = 0;
    for (let d = 0; d < 4; d++) {
      const to = moves.out[sol[0] * 4 + d];
      if (to < 0 || to === sol[1]) continue;
      const token = inc.mark();
      if (!inc.move(sol[0], to)) refused++;
      inc.undo(token);
      eq(Array.from(inc.av), root, `after a move to ${to} and its undo`);
    }
    ok(refused >= 0);
    const token = inc.mark();
    eq(inc.move(sol[0], 24 === sol[0] ? 23 : 24), false, 'a non-neighbour is no move');
    inc.undo(token);
    eq(Array.from(inc.av), root);
  });

  t('solve-dir: on the checks of minimizing, the leg bound visits far fewer nodes', () => {
    let withLegs = 0;
    let without = 0;
    let checks = 0;
    for (const seed of [81, 82]) {
      const p = runSync(generateArrows(8, seed, { candidates: 1, refineNodes: 0 }));
      for (const e of arrowIds(p)) {
        const was = arrowDirId(p.arrows, e);
        setArrowId(p.arrows, e, 0);
        const freed = { limit: 1, nodeCap: 5e6, mustUse: arrowMove(8, e, -was) };
        const a = solve(p, freed);
        const b = solve(p, { ...freed, legs: false });
        eq([a.count, a.exceeded], [b.count, b.exceeded], `seed ${seed} edge ${e}`);
        setArrowId(p.arrows, e, was);
        withLegs += a.nodes;
        without += b.nodes;
        checks++;
      }
    }
    ok(checks >= 12, `${checks} checks`);
    ok(withLegs * 3 < without, `${withLegs} nodes with the leg bound, ${without} without`);
  });

  t('solve-dir: incremental and recomputed propagation prune alike (same nodes)', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const p = plantedArrowPuzzle(1200 + seed, 6, 6, 0.15);
      const a = solved(p, { legs: false });
      const b = solved(p, { incr: false });
      eq([a.count, a.nodes], [b.count, b.nodes], `seed ${seed}`);
    }
  });

  t('memo-dir: remembers positions within a search, forgets them in the next', () => {
    const first = startMemo();
    ok(!first.has(1, 2, 3));
    first.add(1, 2, 3);
    ok(first.has(1, 2, 3) && !first.has(1, 2, 4) && !first.has(2, 2, 3) && !first.has(1, 3, 3));
    first.add(1, 2, 3); // twice is fine
    const second = startMemo();
    ok(!second.has(1, 2, 3), 'a new search starts empty');
    second.add(7, 8, 9);
    ok(second.has(7, 8, 9));
  });

  t('memo-dir: a full row overwrites; random positions are never mistaken', () => {
    const memo = startMemo();
    // five keys that land in the same row (the row index depends on a ^ (b << 5) ^ (c >>> 3))
    const row = [];
    for (let k = 0; k < 5; k++) row.push([k * (1 << 20), 11, 5]);
    for (const [a, b, c] of row) memo.add(a, b, c);
    ok(memo.has(...row[4]), 'the newest of a full row is kept');
    ok(row.filter(([a, b, c]) => memo.has(a, b, c)).length >= 4, 'at most one was overwritten');
    const rnd = makeRng(3);
    const keys = [];
    const word = () => (rnd() * 2 ** 32) | 0;
    for (let i = 0; i < 2000; i++) keys.push([word(), word(), word()]);
    for (const [a, b, c] of keys) memo.add(a, b, c);
    const hits = keys.filter(([a, b, c]) => memo.has(a, b, c)).length;
    ok(hits >= 1990, `${hits} of 2000 kept`);
    let strangers = 0;
    for (let i = 0; i < 20000; i++) {
      if (memo.has(word(), word(), word())) strangers++;
    }
    eq(strangers, 0, 'no position that was never added');
  });

  t('solve-dir: the table of dead positions saves nodes; no search sees an earlier one', () => {
    let withMemo = 0;
    let without = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = plantedArrowPuzzle(1300 + seed, 7, 7, 0.12);
      const a = solved(p);
      const b = solved(p, { memo: false });
      eq(joined(a), joined(b), `seed ${seed}`);
      eq(a.count, solved(p).count, `seed ${seed}: the same again`);
      withMemo += a.nodes;
      without += b.nodes;
    }
    ok(withMemo < without, `${withMemo} nodes with the table, ${without} without`);
  });

  t('solve-dir: decisions are counted; hopeless puzzles give 0 solutions at once', () => {
    const p = plantedArrowPuzzle(11, 5, 4, 0.1);
    const r = solve(p, { decisions: true, limit: 1e9 });
    ok(r.count >= 1 && r.decisionNodes >= 1, `${r.count} solutions, ${r.decisionNodes} decisions`);
    ok(Number.isInteger(r.decisionNodes) && r.maxDecisionDepth >= 0 && r.maxDecisionDepth < 1);
    const q = makePuzzle(3);
    q.cp[0] = 1;
    q.cp[8] = 2;
    q.arrows = new Uint8Array(9);
    for (const c of [1, 3]) setArrowId(q.arrows, edgeId(3, 0, c), -1); // nothing leaves the start
    const dead = solve(q, { limit: 1e9 });
    eq([dead.count, dead.exceeded], [0, false]);
    ok(dead.nodes <= 2, `${dead.nodes} nodes`);
    const odd = makePuzzle(3); // corner to its neighbour: 8 steps cannot have the parity of 1
    odd.cp[0] = 1;
    odd.cp[1] = 2;
    odd.arrows = new Uint8Array(9);
    const none = { count: 0, exceeded: false, nodes: 0, subNodes: 0, paths: undefined };
    eq(solve(odd, { limit: 1e9 }), none);
  });
}
