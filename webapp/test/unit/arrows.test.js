// Tests of the One way arrows puzzle: the core (arrow edges, the rules, the directed solver), the
// generator (gen/arrows.js), the variant in the play app in what is pure in it (variants.js,
// icons.js, board.js, the share link) and what the design app needs for One way arrows,
// Wrap-around, Exact and Loop puzzles: the text format, the minimize helper, arrow and seam
// geometry, board previews, the designer helpers (wrap-aware scatter, seam walls), the play-mode
// overlays (connectivity, forced edges, leg collisions) and the A/B compare on a torus.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  makePuzzle,
  clonePuzzle,
  validate,
  endCell,
  maxNumber,
  labelCount,
} from '../../src/core/model.js';
import {
  edgeId,
  allEdges,
  setWallId,
  setArrowId,
  arrowDirId,
  arrowAllows,
  arrowMove,
  arrowIds,
  arrowCount,
  arrowProblem,
  pathEdgeIds,
  wallCount,
  hasWallId,
  wallIds,
  clearSeamWalls,
} from '../../src/core/edges.js';
import { canStep, step } from '../../src/core/rules.js';
import { FAST, SLOW, sampled } from '../harness.js';
import { solutionKeys } from '../oracle.js';
import { solve } from '../../src/core/solver/solve.js';
import { buildMoves } from '../../src/core/solver/solve-dir.js';
import { makeDirPropagator } from '../../src/core/solver/propagate-dir.js';
import { makeDirIncremental } from '../../src/core/solver/incremental-dir.js';
import { startMemo } from '../../src/core/solver/memo-dir.js';
import {
  generateArrows,
  makeUniqueArrows,
  tryRemoveArrow,
  ARROW_MIN_ARROWS,
  ARROW_SIZES,
  minimizeArrowsFully,
} from '../../src/core/gen/arrows.js';
import { runSync } from '../../src/core/run.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { backbite } from '../../src/core/gen/hampath.js';
import { randomCheckpoints, gapCheckpoints, scatter } from '../../src/core/gen/checkpoints.js';
import { variantOf, sizesFor, nearestSize, PLAY_VARIANTS } from '../../src/apps/play/variants.js';
import { variantIcon } from '../../src/apps/play/icons.js';
import { boardSvg } from '../../src/apps/play/board.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { encodeShare, decodeShare } from '../../src/core/share-code.js';
import { makeShareRecord, shareStatus, shareText, shareUrl } from '../../src/features/share.js';
import { serialize, parse } from '../../src/core/format.js';
import { arrowMarkPoints, arrowMarks, chordSegments } from '../../src/view/geometry.js';
import { miniPreviewSvg } from '../../src/apps/design/board.js';
import { generateExact } from '../../src/core/gen/exact.js';
import { randomPathPuzzle, generateUnique } from '../../src/core/gen/generate.js';
import {
  boardConnectivity,
  boardPropagation,
  boardLegCollide,
} from '../../src/core/connectivity.js';
import { generateLoop } from '../../src/core/gen/loop.js';
import { buildNeighbors, segBlocker, segBlockerDir } from '../../src/core/solver/prune.js';
import { neighbourCell } from '../../src/core/geom.js';
import { runCompare } from '../../src/apps/design/compare.js';
import { decodeFlags, DEFAULT_FLAGS_INT } from '../../src/core/gen/flags.js';

// ---- the core: edges, rules, directed solver

// Random puzzle with arrows (and optionally walls and holes): K numbered cells at random,
// arrowFrac / wallFrac of the edges carry an arrow (random direction) / a wall.
function randomArrowPuzzle(seed, n, K, arrowFrac, wallFrac = 0, holeCount = 0) {
  const rnd = makeRng(seed);
  const p = makePuzzle(n);
  p.arrows = new Uint8Array(n * n);
  if (holeCount) {
    p.holes = new Uint8Array(n * n);
    shuffle([...Array(n * n).keys()], rnd)
      .slice(0, holeCount)
      .forEach(c => {
        p.holes[c] = 1;
      });
  }
  const cells = [...Array(n * n).keys()].filter(c => !p.holes?.[c]);
  shuffle(cells, rnd)
    .slice(0, K)
    .forEach((c, i) => {
      p.cp[c] = i + 1;
    });
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
  randomCheckpoints(path.length, K, rnd).forEach((at, i) => {
    p.cp[path[at]] = i + 1;
  });
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
// "a,b,c" strings (test/oracle.js).
const brute = solutionKeys;

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

test('arrows: the edge codec sets, reads, flips and clears one direction per edge', FAST, () => {
  const n = 4;
  const a = new Uint8Array(n * n);
  const right = edgeId(n, 5, 6);
  const down = edgeId(n, 5, 9);
  assert.deepStrictEqual([arrowDirId(a, right), arrowDirId(a, down)], [0, 0]);
  setArrowId(a, right, 1);
  setArrowId(a, down, -1);
  assert.deepStrictEqual([arrowDirId(a, right), arrowDirId(a, down)], [1, -1]);
  assert.ok(arrowAllows(a, n, 5, 6) && !arrowAllows(a, n, 6, 5), 'right arrow: 5 -> 6 only');
  assert.ok(arrowAllows(a, n, 9, 5) && !arrowAllows(a, n, 5, 9), 'up arrow: 9 -> 5 only');
  assert.ok(
    arrowAllows(a, n, 0, 1) && arrowAllows(a, n, 1, 0),
    'an edge without an arrow is two-way',
  );
  setArrowId(a, right, -1);
  assert.ok(arrowAllows(a, n, 6, 5) && !arrowAllows(a, n, 5, 6), 'flipped');
  assert.deepStrictEqual(arrowMove(n, right, -1), [6, 5]);
  assert.deepStrictEqual(arrowMove(n, down, 1), [5, 9]);
  setArrowId(a, right, 0);
  assert.deepStrictEqual(arrowDirId(a, right), 0);
  assert.deepStrictEqual(
    a[5],
    (1 << 1) | (1 << 3),
    'clearing leaves only the down arrow bits of that cell',
  );
  assert.deepStrictEqual(arrowDirId(a, down), -1, 'the other edge is untouched');
  const p = { n, arrows: a };
  assert.deepStrictEqual([arrowCount(p), arrowIds(p)], [1, [down]]);
  assert.deepStrictEqual(arrowIds({ n, cp: new Uint16Array(16), walls: new Uint8Array(16) }), []);
});

test(
  'arrows: validate (size, bits, border, hole, wall) and clonePuzzle know the field',
  FAST,
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    p.arrows = new Uint8Array(9);
    setArrowId(p.arrows, edgeId(3, 4, 5), 1);
    assert.deepStrictEqual(validate(p).ok, true);
    const q = clonePuzzle(p);
    q.arrows[0] = 1;
    assert.deepStrictEqual(p.arrows[0], 0, 'the clone has its own array');
    assert.deepStrictEqual(clonePuzzle(makePuzzle(3)).arrows, undefined);
    const bad = fn => {
      const c = clonePuzzle(p);
      fn(c);
      return validate(c);
    };
    assert.ok(
      !bad(c => {
        c.arrows = new Uint8Array(8);
      }).ok,
      'wrong size',
    );
    assert.ok(
      !bad(c => {
        c.arrows[2] = 1;
      }).ok,
      'right arrow on the last column',
    );
    assert.ok(
      !bad(c => {
        c.arrows[6] = 2;
      }).ok,
      'down arrow on the last row',
    );
    assert.ok(
      !bad(c => {
        c.arrows[0] = 4;
      }).ok,
      'direction bit without an arrow',
    );
    assert.ok(
      !bad(c => {
        c.holes = new Uint8Array(9);
        c.holes[5] = 1;
      }).ok,
      'arrow next to a hole',
    );
    assert.ok(
      !bad(c => {
        setWallId(c.walls, edgeId(3, 4, 5), true);
      }).ok,
      'arrow and wall on one edge',
    );
    assert.deepStrictEqual(arrowProblem(p), null);
  },
);

test('rules: an arrow lets canStep go one way only; undoing a step is still free', FAST, () => {
  const p = makePuzzle(3);
  p.cp[0] = 1;
  p.cp[8] = 2;
  p.arrows = new Uint8Array(9);
  setArrowId(p.arrows, edgeId(3, 0, 1), 1);
  assert.ok(canStep(p, 0, 1) && !canStep(p, 1, 0) && canStep(p, 0, 3) && canStep(p, 3, 0));
  const path = [];
  for (const c of [0, 1]) assert.deepStrictEqual(step(p, path, c), 'push');
  assert.deepStrictEqual(step(p, path, 0), 'pop', 'undo across the one-way edge');
  assert.deepStrictEqual(step(p, path, 3), 'push');
  assert.deepStrictEqual(step(p, path, 0), 'pop');
  assert.deepStrictEqual(step(p, path, 1), 'push', 'with the arrow');
});

test(
  'solve: 3x3, two snakes; an arrow kills the one walking it backwards, none must cross',
  FAST,
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    p.arrows = new Uint8Array(9);
    const paths = () => joined(solved(p));
    assert.deepStrictEqual(paths(), ['0,1,2,5,4,3,6,7,8', '0,3,6,7,4,1,2,5,8']);
    setArrowId(p.arrows, edgeId(3, 4, 5), 1);
    assert.deepStrictEqual(paths(), ['0,3,6,7,4,1,2,5,8'], '4 -> 5: the row snake walks 5 -> 4');
    setArrowId(p.arrows, edgeId(3, 4, 5), -1);
    assert.deepStrictEqual(
      paths(),
      ['0,1,2,5,4,3,6,7,8', '0,3,6,7,4,1,2,5,8'],
      '5 -> 4: column snake skips it',
    );
    const r = solve(p);
    assert.deepStrictEqual([r.count, r.exceeded], [2, false]);
    assert.deepStrictEqual(solve(p, { limit: 1 }).count, 1, 'limit stops the search');
  },
);

test("solve: an all-zero arrows array gives the standard solver's solutions", FAST, () => {
  for (let seed = 1; seed <= 24; seed++) {
    const n = 4 + (seed % 2);
    const std = randomArrowPuzzle(seed, n, 3 + (seed % 3), 0, 0.3);
    delete std.arrows;
    const withZeros = clonePuzzle(std);
    withZeros.arrows = new Uint8Array(n * n);
    assert.deepStrictEqual(joined(solved(withZeros)), joined(solved(std)), `seed ${seed}`);
  }
});

test('solve-dir: buildMoves gives consistent out- and in-neighbours', FAST, () => {
  const p = randomArrowPuzzle(7, 5, 3, 0.3, 0.1, 2);
  const { out, pre, T } = buildMoves(p);
  let moves = 0;
  for (let u = 0; u < T; u++) {
    for (let d = 0; d < 4; d++) {
      const v = out[u * 4 + d];
      if (v < 0) continue;
      moves++;
      assert.ok(canStep(p, u, v), `move ${u} -> ${v} is a legal step`);
      assert.ok(
        [0, 1, 2, 3].some(k => pre[v * 4 + k] === u),
        `${u} is a predecessor of ${v}`,
      );
    }
  }
  let preds = 0;
  for (let i = 0; i < T * 4; i++) if (pre[i] >= 0) preds++;
  assert.deepStrictEqual(preds, moves);
  for (let u = 0; u < T; u++) {
    for (let v = 0; v < T; v++) {
      const listed = [0, 1, 2, 3].some(d => out[u * 4 + d] === v);
      assert.deepStrictEqual(listed, canStep(p, u, v), `${u} -> ${v}`);
    }
  }
});

// The solver against plain enumeration: same solution set for random arrows, walls and holes.
const differential = (name, allCases, make) =>
  test(`solve-dir: ${name} match brute force`, FAST, () => {
    const cases = sampled(allCases);
    let total = 0;
    let multi = 0;
    for (const [seed, n, K, arrowFrac, wallFrac, holes] of cases) {
      const p = make(seed, n, K, arrowFrac, wallFrac, holes);
      const want = brute(p);
      total += want.length;
      if (want.length > 1) multi++;
      const cells = want.length ? want[0].split(',').map(Number) : [];
      const rnd = makeRng(seed * 31 + 5);
      const picks = [
        [cells[2], cells[3]],
        [cells[3], cells[2]],
      ];
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
        assert.ok(!got.exceeded, `${tag}: not capped`);
        assert.deepStrictEqual(joined(got), want, tag);
        const lim = solve(p, { nodeCap: 5e6, ...mode });
        assert.deepStrictEqual(lim.count, Math.min(2, want.length), `${tag}: default limit 2`);
        if (!want.length) continue;
        for (const [a, b] of picks) {
          const using = want.filter(x => usesMove(x, a, b));
          const r = solved(p, { mustUse: [a, b], ...mode });
          assert.deepStrictEqual(joined(r), using, `${tag}: mustUse ${a}->${b}`);
        }
        assert.deepStrictEqual(
          solved(p, { forced: prefix, ...mode }).count,
          below.length,
          `${tag}: forced ${prefix}`,
        );
      }
    }
    const enough = total >= cases.length / 2 && multi >= cases.length / 10;
    assert.ok(
      enough || make === randomArrowPuzzle,
      `weak coverage: ${total} solutions, ${multi} multi`,
    );
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

test(
  'propagate-dir: along every solution the position stays feasible and keeps its moves',
  FAST,
  () => {
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
          assert.ok(
            prop.deduce(head, sol.length - m + 1),
            `seed ${seed}: position ${m} of ${sol}`,
          );
          for (let i = m - 1; i < sol.length - 1; i++) {
            const d = [0, 1, 2, 3].find(e => moves.out[sol[i] * 4 + e] === sol[i + 1]);
            const kept = (prop.av[sol[i]] >> d) & 1;
            assert.ok(kept, `seed ${seed}: ${sol[i]}->${sol[i + 1]} dropped at ${m}`);
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
    assert.ok(positions > 300, `${positions} positions`);
    assert.ok(
      forcedSomething > 10,
      `only ${forcedSomething} positions where the head loses a move`,
    );
  },
);

test(
  'solve-dir: propagation visits far fewer nodes than the plain search, same solutions',
  FAST,
  () => {
    let on = 0;
    let off = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const p = plantedArrowPuzzle(1000 + seed, 6, 6, 0.15);
      const a = solved(p);
      const b = solved(p, { prop: false });
      assert.deepStrictEqual(joined(a), joined(b), `seed ${seed}`);
      on += a.nodes;
      off += b.nodes;
    }
    assert.ok(on * 3 < off, `${on} nodes with propagation, ${off} without`);
  },
);

test(
  'incremental-dir: the same position as the recomputed propagation, move by move',
  FAST,
  () => {
    let positions = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = 4 + (seed % 3);
      const p = plantedArrowPuzzle(900 + seed, n, 3 + (seed % 4), 0.1 + (seed % 5) * 0.07);
      const sol = solve(p, { limit: 1, capture: true, prop: false, nodeCap: 5e6 }).paths[0];
      const moves = buildMoves(p);
      const start = sol[0];
      const end = sol[sol.length - 1];
      const inc = makeDirIncremental(moves, start, end, n * n);
      assert.ok(inc.init(), `seed ${seed}: the root fails`);
      const vis = new Uint8Array(n * n);
      const scratch = makeDirPropagator(moves, end, vis);
      const root = Array.from(inc.av);
      const marks = [];
      vis[start] = 1;
      for (let m = 1; m < sol.length; m++) {
        const head = sol[m - 1];
        marks.push(inc.mark());
        assert.ok(inc.move(head, sol[m]), `seed ${seed}: move ${m} of ${sol}`);
        const next = sol[m];
        vis[next] = 1;
        if (next === end) break;
        assert.ok(scratch.deduce(next, sol.length - m), `seed ${seed}: recomputed position ${m}`);
        assert.deepStrictEqual(
          inc.av[next],
          scratch.av[next],
          `seed ${seed} move ${m}: the head's moves`,
        );
        positions++;
      }
      while (marks.length) inc.undo(marks.pop());
      assert.deepStrictEqual(Array.from(inc.av), root, `seed ${seed}: undo restores the root`);
    }
    assert.ok(positions > 200, `${positions} positions compared`);
  },
);

test('incremental-dir: a move that is a contradiction fails and undoes cleanly', FAST, () => {
  const p = plantedArrowPuzzle(950, 5, 4, 0.2);
  const sol = solve(p, { limit: 1, capture: true, prop: false, nodeCap: 5e6 }).paths[0];
  const moves = buildMoves(p);
  const inc = makeDirIncremental(moves, sol[0], sol[sol.length - 1], 25);
  assert.ok(inc.init());
  const root = Array.from(inc.av);
  let refused = 0;
  for (let d = 0; d < 4; d++) {
    const to = moves.out[sol[0] * 4 + d];
    if (to < 0 || to === sol[1]) continue;
    const token = inc.mark();
    if (!inc.move(sol[0], to)) refused++;
    inc.undo(token);
    assert.deepStrictEqual(Array.from(inc.av), root, `after a move to ${to} and its undo`);
  }
  assert.ok(refused >= 0);
  const token = inc.mark();
  assert.deepStrictEqual(
    inc.move(sol[0], 24 === sol[0] ? 23 : 24),
    false,
    'a non-neighbour is no move',
  );
  inc.undo(token);
  assert.deepStrictEqual(Array.from(inc.av), root);
});

test('solve-dir: on the checks of minimizing, the leg bound visits far fewer nodes', FAST, () => {
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
      assert.deepStrictEqual(
        [a.count, a.exceeded],
        [b.count, b.exceeded],
        `seed ${seed} edge ${e}`,
      );
      setArrowId(p.arrows, e, was);
      withLegs += a.nodes;
      without += b.nodes;
      checks++;
    }
  }
  assert.ok(checks >= 12, `${checks} checks`);
  assert.ok(withLegs * 3 < without, `${withLegs} nodes with the leg bound, ${without} without`);
});

test('solve-dir: incremental and recomputed propagation prune alike (same nodes)', FAST, () => {
  for (let seed = 1; seed <= 15; seed++) {
    const p = plantedArrowPuzzle(1200 + seed, 6, 6, 0.15);
    const a = solved(p, { legs: false });
    const b = solved(p, { incr: false });
    assert.deepStrictEqual([a.count, a.nodes], [b.count, b.nodes], `seed ${seed}`);
  }
});

test('memo-dir: remembers positions within a search, forgets them in the next', FAST, () => {
  const first = startMemo();
  assert.ok(!first.has(1, 2, 3));
  first.add(1, 2, 3);
  assert.ok(
    first.has(1, 2, 3) && !first.has(1, 2, 4) && !first.has(2, 2, 3) && !first.has(1, 3, 3),
  );
  first.add(1, 2, 3); // twice is fine
  const second = startMemo();
  assert.ok(!second.has(1, 2, 3), 'a new search starts empty');
  second.add(7, 8, 9);
  assert.ok(second.has(7, 8, 9));
});

test('memo-dir: a full row overwrites; random positions are never mistaken', FAST, () => {
  const memo = startMemo();
  // five keys that land in the same row (the row index depends on a ^ (b << 5) ^ (c >>> 3))
  const row = [];
  for (let k = 0; k < 5; k++) row.push([k * (1 << 20), 11, 5]);
  for (const [a, b, c] of row) memo.add(a, b, c);
  assert.ok(memo.has(...row[4]), 'the newest of a full row is kept');
  assert.ok(
    row.filter(([a, b, c]) => memo.has(a, b, c)).length >= 4,
    'at most one was overwritten',
  );
  const rnd = makeRng(3);
  const keys = [];
  const word = () => (rnd() * 2 ** 32) | 0;
  for (let i = 0; i < 2000; i++) keys.push([word(), word(), word()]);
  for (const [a, b, c] of keys) memo.add(a, b, c);
  const hits = keys.filter(([a, b, c]) => memo.has(a, b, c)).length;
  assert.ok(hits >= 1990, `${hits} of 2000 kept`);
  let strangers = 0;
  for (let i = 0; i < 20000; i++) {
    if (memo.has(word(), word(), word())) strangers++;
  }
  assert.deepStrictEqual(strangers, 0, 'no position that was never added');
});

test(
  'solve-dir: the table of dead positions saves nodes; no search sees an earlier one',
  SLOW,
  () => {
    let withMemo = 0;
    let without = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = plantedArrowPuzzle(1300 + seed, 7, 7, 0.12);
      const a = solved(p);
      const b = solved(p, { memo: false });
      assert.deepStrictEqual(joined(a), joined(b), `seed ${seed}`);
      assert.deepStrictEqual(a.count, solved(p).count, `seed ${seed}: the same again`);
      withMemo += a.nodes;
      without += b.nodes;
    }
    assert.ok(withMemo < without, `${withMemo} nodes with the table, ${without} without`);
  },
);

test('solve-dir: decisions are counted; hopeless puzzles give 0 solutions at once', FAST, () => {
  const p = plantedArrowPuzzle(11, 5, 4, 0.1);
  const r = solve(p, { decisions: true, limit: 1e9 });
  assert.ok(
    r.count >= 1 && r.decisionNodes >= 1,
    `${r.count} solutions, ${r.decisionNodes} decisions`,
  );
  assert.ok(
    Number.isInteger(r.decisionNodes) && r.maxDecisionDepth >= 0 && r.maxDecisionDepth < 1,
  );
  const q = makePuzzle(3);
  q.cp[0] = 1;
  q.cp[8] = 2;
  q.arrows = new Uint8Array(9);
  for (const c of [1, 3]) setArrowId(q.arrows, edgeId(3, 0, c), -1); // nothing leaves the start
  const dead = solve(q, { limit: 1e9 });
  assert.deepStrictEqual([dead.count, dead.exceeded], [0, false]);
  assert.ok(dead.nodes <= 2, `${dead.nodes} nodes`);
  const odd = makePuzzle(3); // corner to its neighbour: 8 steps cannot have the parity of 1
  odd.cp[0] = 1;
  odd.cp[1] = 2;
  odd.arrows = new Uint8Array(9);
  const none = { count: 0, exceeded: false, nodes: 0, subNodes: 0, paths: undefined };
  assert.deepStrictEqual(solve(odd, { limit: 1e9 }), none);
});

// ---- the generator

const make = (n, seed, o = {}) => runSync(generateArrows(n, seed, { candidates: 3, ...o }));
const solutions = (p, opts = {}) => solve(p, { limit: 2, capture: true, nodeCap: 5e6, ...opts });

test(
  'generateArrows: valid, wall-free, one solution = p.path (propagation on and off)',
  FAST,
  () => {
    for (const [n, seed] of [
      [5, 1],
      [5, 2],
      [6, 3],
      [6, 4],
      [7, 5],
    ]) {
      const p = make(n, seed);
      const tag = `n ${n} seed ${seed}`;
      assert.ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
      assert.deepStrictEqual(wallCount(p), 0, `${tag}: walls`);
      assert.ok(arrowIds(p).length >= ARROW_MIN_ARROWS, `${tag}: arrows`);
      const k = maxNumber(p);
      assert.ok(k >= 3 && k <= Math.round(0.2 * n * n), `${tag}: K ${k}`);
      for (const prop of n <= 6 ? [true, false] : [true]) {
        const r = solutions(p, { prop });
        assert.deepStrictEqual(r.count, 1, `${tag} prop ${prop}: solutions`);
        assert.deepStrictEqual(r.paths[0], p.path, `${tag} prop ${prop}: the planted path`);
      }
    }
  },
);

test(
  'generateArrows: every arrow is necessary (removing any gives a second solution)',
  FAST,
  () => {
    let checked = 0;
    for (const [n, seed] of [
      [5, 11],
      [6, 12],
      [6, 13],
      [7, 14],
      [7, 15],
    ]) {
      const p = make(n, seed);
      for (const e of arrowIds(p)) {
        const dir = arrowDirId(p.arrows, e);
        setArrowId(p.arrows, e, 0);
        const r = solutions(p);
        setArrowId(p.arrows, e, dir);
        assert.ok(r.count >= 2, `n ${n} seed ${seed}: arrow on edge ${e} is redundant`);
        checked++;
      }
    }
    assert.ok(checked >= 15, `${checked} arrows checked`);
  },
);

test("generateArrows: pathArrows = false keeps the solution's edges free of arrows", FAST, () => {
  for (const [n, seed] of [
    [5, 21],
    [6, 22],
    [7, 23],
  ]) {
    const p = make(n, seed, { pathArrows: false });
    const onPath = new Set(pathEdgeIds(n, p.path));
    for (const e of arrowIds(p))
      assert.ok(!onPath.has(e), `n ${n} seed ${seed}: arrow on a path edge`);
    assert.deepStrictEqual(solutions(p).count, 1, `n ${n} seed ${seed}`);
  }
  const withPath = [31, 32, 33, 34].some(seed => {
    const p = make(6, seed);
    const onPath = new Set(pathEdgeIds(6, p.path));
    return arrowIds(p).some(e => onPath.has(e));
  });
  assert.ok(withPath, 'by default some arrow sits on the solution (and points along it)');
});

test(
  'generateArrows: seedFraction is an option; any share of seeded edges ends unique',
  FAST,
  () => {
    for (const [seedFraction, seed] of [
      [0, 91],
      [0.1, 92],
      [0.25, 93],
      [0.6, 94],
    ]) {
      const p = make(6, seed, { seedFraction });
      const tag = `seedFraction ${seedFraction}`;
      assert.deepStrictEqual(solutions(p).count, 1, tag);
      assert.ok(arrowIds(p).length >= ARROW_MIN_ARROWS, `${tag}: arrows`);
    }
  },
);

test('generateArrows: same seed, same puzzle; progress events behave', FAST, () => {
  const a = make(6, 41);
  const b = make(6, 41);
  assert.deepStrictEqual(Array.from(a.cp), Array.from(b.cp));
  assert.deepStrictEqual(Array.from(a.arrows), Array.from(b.arrows));
  const events = [];
  const p = runSync(generateArrows(5, 42, { candidates: 3 }), ev => events.push(ev));
  assert.ok(events.length > 3);
  const counts = events.map(ev => ev.arrows).filter(x => x !== null && x !== undefined);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `arrows rose at event ${i}`);
  }
  const fracs = events.map(ev => ev.frac).filter(x => x !== null && x !== undefined);
  assert.ok(
    fracs.every(x => x >= 0 && x <= 1),
    'frac in [0, 1]',
  );
  assert.deepStrictEqual(events[events.length - 1], {
    frac: 1,
    arrows: arrowIds(p).length,
    K: maxNumber(p),
  });
});

test('tryRemoveArrow: both checks keep a needed arrow, accept a spare one', FAST, () => {
  for (const [n, seed] of [
    [5, 51],
    [6, 52],
    [6, 53],
  ]) {
    const p = make(n, seed);
    const before = Array.from(p.arrows);
    for (const e of arrowIds(p)) {
      for (const freedEdge of [true, false]) {
        const r = tryRemoveArrow(p, e, 5e6, freedEdge);
        const tag = `n ${n} seed ${seed} edge ${e} ${freedEdge}`;
        assert.deepStrictEqual([r.removable, r.capped], [false, false], tag);
        assert.deepStrictEqual(
          Array.from(p.arrows),
          before,
          'a refused removal puts the arrow back',
        );
      }
    }
    // an arrow on an edge the solution does not use cannot hurt it: spare, and removable again
    const onPath = new Set(pathEdgeIds(n, p.path));
    const spare = [...Array(2 * n * n).keys()].find(e => {
      const exists = e & 1 ? (e >> 1) + n < n * n : ((e >> 1) % n) + 1 < n;
      return exists && !onPath.has(e) && arrowDirId(p.arrows, e) === 0;
    });
    setArrowId(p.arrows, spare, -1);
    assert.deepStrictEqual(solutions(p).count, 1, 'still unique with the extra arrow');
    for (const freedEdge of [true, false]) {
      const r = tryRemoveArrow(p, spare, 5e6, freedEdge);
      assert.deepStrictEqual(r.removable, true, `n ${n} seed ${seed} spare ${spare} ${freedEdge}`);
      assert.deepStrictEqual(arrowDirId(p.arrows, spare), 0);
      setArrowId(p.arrows, spare, -1);
    }
  }
});

test('makeUniqueArrows: unique with the anchor path as the only solution, or null', FAST, () => {
  let built = 0;
  for (let seed = 61; seed <= 70; seed++) {
    const n = 5;
    const rnd = makeRng(seed);
    const path = backbite(n, rnd);
    const p = makePuzzle(n);
    gapCheckpoints(n, path, 4).forEach((q, i) => {
      p.cp[path[q]] = i + 1;
    });
    p.arrows = new Uint8Array(n * n);
    const cfg = { nodeCap: 200000, seedFraction: 0.4, K: 4, pathArrows: seed % 2 === 0 };
    const order = runSync(makeUniqueArrows(p, path, rnd, cfg));
    if (order === null) continue;
    built++;
    const r = solutions(p);
    assert.deepStrictEqual([r.count, r.paths[0]], [1, path], `seed ${seed}`);
    assert.deepStrictEqual(
      arrowIds(p).length,
      order.length,
      `seed ${seed}: the order lists every arrow`,
    );
  }
  assert.ok(built >= 6, `${built} of 10 attempts built a puzzle`);
});

// ---- the variant in the play app

// A 3x3 puzzle: 1 at the top left, 2 at the bottom right, an arrow 4 -> 5 (right) and an arrow
// 7 -> 4 (up), so the marks point two ways.
function hand() {
  const p = makePuzzle(3);
  p.cp[0] = 1;
  p.cp[8] = 2;
  p.arrows = new Uint8Array(9);
  setArrowId(p.arrows, edgeId(3, 4, 5), 1);
  setArrowId(p.arrows, edgeId(3, 4, 7), -1);
  return p;
}

const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: 'arrows',
    puzzle: p,
    ...extra,
  });

test('play variants: variantOf, the sizes on offer, the nearest size', FAST, () => {
  const arrows = hand();
  assert.deepStrictEqual([variantOf(arrows), variantOf(makePuzzle(5))], ['arrows', null]);
  assert.deepStrictEqual(variantOf({ ...makePuzzle(5), holes: new Uint8Array(25) }), 'cutout');
  const all = [5, 6, 7, 8, 9, 10, 11, 12, 16];
  assert.deepStrictEqual(sizesFor('standard', all), all);
  assert.deepStrictEqual(sizesFor('cutout', all), all);
  assert.deepStrictEqual(sizesFor('arrows', all), ARROW_SIZES);
  assert.ok(
    ARROW_SIZES.every(n => all.includes(n)),
    'every arrows size is a play size',
  );
  const near = size => nearestSize(size, ARROW_SIZES);
  assert.deepStrictEqual([near(16), near(7), near(4)], [11, 7, 5]);
  assert.deepStrictEqual(nearestSize(6.5, [5, 6, 7]), 6, 'the smaller one on a tie');
});

test(
  'play icons: the arrows variant is in the registry; its icon has 16 tiles and three arrowheads',
  FAST,
  () => {
    assert.deepStrictEqual(PLAY_VARIANTS.map(v => v.id).slice(0, 3), [
      'cutout',
      'arrows',
      'exact',
    ]); // later ones append
    const icon = variantIcon('arrows');
    assert.deepStrictEqual((icon.match(/rx="1\.6"/g) || []).length, 16);
    assert.deepStrictEqual((icon.match(/<polygon class="vi-arrow"/g) || []).length, 3);
    assert.ok(icon.includes('vi-arrows') && icon !== variantIcon('standard'));
    assert.ok(!variantIcon('standard').includes('vi-arrow"'));
    for (const dict of [EN, ZH]) {
      for (const key of [
        'mode.arrows',
        'mode.arrowsTag',
        'gen.subArrows',
        'game.arrowsTitle',
        'game.sharedArrowsTitle',
        'share.arrows',
        'share.headArrows',
      ])
        assert.ok(dict[key], key);
      assert.deepStrictEqual(typeof dict['gen.arrows'], 'function');
      assert.ok(dict['gen.arrows'](3).includes('3'));
    }
  },
);

test('play board: one mark per arrow, rotated to its direction; none without arrows', FAST, () => {
  const p = hand();
  const svg = boardSvg({ puzzle: p, path: [], hintCell: null, hintWrongCell: null });
  assert.ok(svg.includes('zip-svg arrows'));
  const at = 'translate\\(([\\d.]+) ([\\d.]+)\\) rotate\\((-?\\d+)\\)';
  const mark = new RegExp(`data-arrow="(\\d+)" transform="${at}"`, 'g');
  const marks = [...svg.matchAll(mark)];
  assert.deepStrictEqual(marks.length, 2);
  const byEdge = Object.fromEntries(marks.map(m => [m[1], m.slice(2).map(Number)]));
  // the cells are 60 wide: cell 4 is centred at (90, 90), 5 at (150, 90), 7 at (90, 150)
  assert.deepStrictEqual(byEdge[edgeId(3, 4, 5)], [120, 90, 0], '4 -> 5 points right');
  assert.deepStrictEqual(byEdge[edgeId(3, 4, 7)], [90, 120, -90], '7 -> 4 points up');
  const bare = { puzzle: makePuzzle(3), path: [], hintCell: null, hintWrongCell: null };
  const plain = boardSvg(bare);
  assert.ok(!plain.includes('arrow-mark') && !plain.includes('zip-svg arrows'));
});

test('share-code: an arrows record is refused when its puzzle is unsound', FAST, () => {
  const refused = fn => {
    const p = hand();
    fn(p);
    return encodeShare(record(p, { puzzle: p }));
  };
  assert.ok(refused(() => {}) !== null, 'the sound one is encoded');
  assert.deepStrictEqual(
    refused(p => {
      p.arrows[2] = 1;
    }),
    null,
    'an arrow leaving the board',
  );
  assert.deepStrictEqual(
    refused(p => {
      p.arrows[0] = 4;
    }),
    null,
    'a direction bit without an arrow',
  );
  assert.deepStrictEqual(
    refused(p => {
      setWallId(p.walls, edgeId(3, 0, 1), true);
    }),
    null,
    'a wall',
  );
  assert.deepStrictEqual(
    refused(p => {
      p.cp[4] = 3;
      p.cp[5] = 5;
    }),
    null,
    'a gap in the numbers',
  );
  assert.deepStrictEqual(
    refused(p => {
      p.cp[8] = 0;
    }),
    null,
    'a single checkpoint',
  );
  assert.deepStrictEqual(
    refused(p => {
      p.arrows = p.arrows.slice(0, 8);
    }),
    null,
    'arrows of the wrong size',
  );
  assert.deepStrictEqual(encodeShare({ ...record(hand()), variant: 'unknown' }), null);
});

test(
  'share: an arrows game has its own head text and is playable without an app version',
  FAST,
  () => {
    const rec = record(hand());
    const text = shareText(rec, 'https://x/?s=abc', (key, ...args) => key + args.join(','));
    assert.ok(text.startsWith('share.headArrows3'), text);
    assert.deepStrictEqual(
      shareStatus(rec, { sizes: [5, 6, 7] }),
      { status: 'invalid' },
      'a size not played',
    );
    assert.deepStrictEqual(shareStatus({ ...rec, n: 7 }, { sizes: [5, 6, 7] }), { status: 'ok' });
    const url = shareUrl('https://x/', rec);
    assert.ok(
      url.startsWith('https://x/?s=') && decodeShare(url.split('?s=')[1]).variant === 'arrows',
    );
  },
);

// ---- the design app: format, geometry, previews

const text = lines => lines.join('\n');

test('format: an arrows puzzle serializes as "r,c>r,c" moves and parses back', FAST, () => {
  const p = hand();
  const out = serialize(p);
  assert.ok(out.includes('arrows 1,1>1,2 2,1>1,1'), out);
  assert.ok(
    out.split('\n').some(l => l.startsWith('# arrows ')),
    'a header comment explains the line',
  );
  const q = parse(out);
  assert.deepStrictEqual(
    [[...q.arrows], [...q.cp], [...q.walls]],
    [[...p.arrows], [...p.cp], [...p.walls]],
  );
  assert.deepStrictEqual(serialize(q), out);
  assert.ok(validate(q).ok);
  assert.deepStrictEqual(arrowCount(q), 2);
});

test('format: no arrows line for a standard puzzle; an empty one keeps the variant', FAST, () => {
  const plain = makePuzzle(3);
  plain.cp[0] = 1;
  plain.cp[8] = 2;
  assert.ok(!/^arrows/m.test(serialize(plain)) && parse(serialize(plain)).arrows === undefined);
  const empty = parse(text(['size 3', 'checkpoints 0,0=1 2,2=2', 'walls', 'arrows']));
  assert.ok(empty.arrows instanceof Uint8Array && arrowCount(empty) === 0);
  assert.ok(/^arrows$/m.test(serialize(empty)));
  assert.deepStrictEqual(parse(serialize(empty)).arrows.length, 9);
});

test('format: arrows go either way on the page; bad ones are refused with a message', FAST, () => {
  const base = ['size 3', 'checkpoints 0,0=1 2,2=2'];
  const withArrows = tokens => parse(text([...base, 'arrows ' + tokens]));
  assert.deepStrictEqual(
    arrowDirId(withArrows('1,2>1,1').arrows, edgeId(3, 4, 5)),
    -1,
    'left = to the lower cell',
  );
  assert.deepStrictEqual(
    arrowDirId(withArrows('1,1>2,1').arrows, edgeId(3, 4, 7)),
    1,
    'down = to the higher cell',
  );
  const refused = (tokens, pattern, extra = []) => {
    let message = '';
    try {
      parse(text([...base, ...extra, 'arrows ' + tokens]));
    } catch (e) {
      message = e.message;
    }
    assert.ok(pattern.test(message), `"${tokens}" -> "${message}"`);
  };
  refused('1,1-1,2', /Invalid arrow/);
  refused('1,1>1', /Invalid arrow/);
  refused('3,0>2,0', /out of range/);
  refused('0,0>1,1', /not neighbours/);
  refused('1,1>1,2 1,2>1,1', /Two arrows on one edge/);
  refused('1,1>1,2 1,1>1,2', /Two arrows on one edge/);
  refused('0,0>0,1', /on a wall/, ['walls V,0,0']);
  refused('1,1>1,2', /hole/, ['holes 1,2']);
});

test(
  'format: a path that walks against an arrow is refused, one that follows it is kept',
  FAST,
  () => {
    const lines = ['size 3', 'checkpoints 0,0=1 2,2=2', 'arrows 0,1>0,0'];
    let message = '';
    try {
      parse(text([...lines, 'path 0,0 0,1']));
    } catch (e) {
      message = e.message;
    }
    assert.ok(/crosses a wall/.test(message) || /step/.test(message), message);
    const follows = ['size 3', 'checkpoints 0,0=1 2,2=2', 'arrows 0,0>0,1', 'path 0,0 0,1'];
    const good = parse(text(follows));
    assert.deepStrictEqual(good.path, [0, 1]);
  },
);

test('format: a generated arrows puzzle survives export and import', FAST, () => {
  const p = runSync(generateArrows(6, 71, { candidates: 2, refineNodes: 0 }));
  const q = parse(serialize(p, { times: { generateMs: 12.5 } }));
  assert.deepStrictEqual([[...q.arrows], [...q.cp]], [[...p.arrows], [...p.cp]]);
  assert.deepStrictEqual(solve(q, { limit: 2, nodeCap: 5e6 }).count, 1);
});

test('minimizeArrowsFully: drops spare arrows, keeps the needed ones, stays unique', FAST, () => {
  const p = runSync(generateArrows(6, 72, { candidates: 2, refineNodes: 0 }));
  const needed = arrowIds(p);
  const rnd = makeRng(5);
  // add spare arrows on edges the solution does not use (they keep it unique)
  const onPath = new Set();
  for (let i = 1; i < p.path.length; i++) onPath.add(edgeId(6, p.path[i - 1], p.path[i]));
  let added = 0;
  for (let e = 0; e < 2 * 36 && added < 5; e++) {
    const exists = e & 1 ? (e >> 1) + 6 < 36 : ((e >> 1) % 6) + 1 < 6;
    if (!exists || onPath.has(e) || arrowDirId(p.arrows, e) !== 0) continue;
    setArrowId(p.arrows, e, rnd() < 0.5 ? 1 : -1);
    added++;
  }
  assert.deepStrictEqual(solve(p, { limit: 2, nodeCap: 5e6 }).count, 1);
  const events = [];
  const r = runSync(
    minimizeArrowsFully(p, arrowIds(p), rnd, 200000, 4, { refineBudget: 1e6 }),
    ev => events.push(ev),
  );
  assert.deepStrictEqual(r.uncertain, []);
  assert.ok(r.removed >= 1 && r.kept === arrowCount(p), `${r.removed} removed, ${r.kept} kept`);
  assert.deepStrictEqual(solve(p, { limit: 2, nodeCap: 5e6 }).count, 1);
  for (const e of needed) assert.ok(arrowDirId(p.arrows, e) !== 0, 'a needed arrow was removed');
  assert.ok(events.length >= added, 'one event per checked arrow');
});

test('geometry: the arrow triangle sits mid-edge, pointing the allowed way', FAST, () => {
  const point = s => s.split(' ').map(q => q.split(',').map(Number));
  const [tip] = point(arrowMarkPoints(3, 4, 5));
  assert.deepStrictEqual(
    tip,
    [2 + 0.2, 1.5],
    'cell 4 -> 5 points right, from the middle (2, 1.5)',
  );
  const [up] = point(arrowMarkPoints(3, 7, 4));
  assert.deepStrictEqual(up, [1.5, 2 - 0.2], '7 -> 4 points up');
  const back = point(arrowMarkPoints(3, 4, 5)).slice(1);
  assert.ok(
    back.every(([x]) => x < 2),
    'the base is behind the middle',
  );
  assert.deepStrictEqual(point(arrowMarkPoints(3, 4, 5, 10))[0], [22, 15], 'scaled');
  const marks = arrowMarks(hand());
  assert.deepStrictEqual(
    marks.map(m => [m.from, m.to]),
    [
      [4, 5],
      [7, 4],
    ],
  );
  assert.deepStrictEqual(arrowMarks(makePuzzle(3)), []);
});

test('design board: the compare preview draws the arrows of a puzzle', FAST, () => {
  const withArrows = miniPreviewSvg(hand(), null, '#fff');
  assert.deepStrictEqual((withArrows.match(/<polygon /g) || []).length, 2);
  const plain = makePuzzle(3);
  plain.cp[0] = 1;
  plain.cp[8] = 2;
  assert.ok(!miniPreviewSvg(plain, null, '#fff').includes('<polygon'));
  setWallId(plain.walls, edgeId(3, 0, 1), true);
  assert.ok(miniPreviewSvg(plain, null, '#fff').includes('<line'));
});

// ---- the design app: the other puzzle types

test('chordSegments: one straight piece on a grid, two across a seam on a torus', FAST, () => {
  assert.deepStrictEqual(
    chordSegments(5, false, 0, 4),
    [[0.5, 0.5, 4.5, 0.5]],
    'a grid never wraps',
  );
  assert.deepStrictEqual(
    chordSegments(5, true, 0, 2),
    [[0.5, 0.5, 2.5, 0.5]],
    'no seam on the short way',
  );
  // 0 -> 4 on a row of 5: one step left over the seam, so a stub out of 0 and a stub into 4
  assert.deepStrictEqual(chordSegments(5, true, 0, 4), [
    [0.5, 0.5, -0.5, 0.5],
    [5.5, 0.5, 4.5, 0.5],
  ]);
  // down over the bottom seam: cell 20 (last row, column 0) -> cell 0
  assert.deepStrictEqual(chordSegments(5, true, 20, 0), [
    [0.5, 4.5, 0.5, 5.5],
    [0.5, -0.5, 0.5, 0.5],
  ]);
  // both axes at once (diagonal): 0 -> 24
  const diag = chordSegments(5, true, 0, 24);
  assert.deepStrictEqual(diag.length, 2);
  assert.deepStrictEqual(diag[0], [0.5, 0.5, -0.5, -0.5]);
  assert.deepStrictEqual(diag[1], [5.5, 5.5, 4.5, 4.5]);
});

test('clearSeamWalls: drops only the walls a grid does not have, and counts them', FAST, () => {
  const p = makePuzzle(4);
  setWallId(p.walls, 5 * 2, true); // V next to cell 5, inside the board
  setWallId(p.walls, 5 * 2 + 1, true); // H below cell 5, inside the board
  setWallId(p.walls, 7 * 2, true); // V of the last column: a seam
  setWallId(p.walls, 13 * 2 + 1, true); // H of the last row: a seam
  assert.deepStrictEqual(clearSeamWalls(p), 2);
  assert.deepStrictEqual(wallIds(p), [10, 11]);
  assert.deepStrictEqual(clearSeamWalls(p), 0);
  assert.ok(hasWallId(p.walls, 10) && hasWallId(p.walls, 11));
});

test('scatter: on a wrap-around board it numbers K cells 1..K and is deterministic', FAST, () => {
  const w = randomPathPuzzle(6, 5, makeRng(9), true);
  const a = scatter(w, 5, makeRng(10)),
    b = scatter(w, 5, makeRng(10));
  assert.deepStrictEqual([...a], [...b]);
  assert.deepStrictEqual([...a].filter(Boolean).sort(), [1, 2, 3, 4, 5]);
  // the nearest-next order walks across a seam: the cells 0 and 5 are neighbours on a torus only
  const p = makePuzzle(6);
  p.wrap = true;
  const tight = scatter(p, 6, makeRng(1));
  assert.deepStrictEqual([...tight].filter(Boolean).length, 6);
});

test(
  'boardLegCollide: never calls a prefix of the real solution stuck, on Exact and wrap-around boards',
  FAST,
  () => {
    const exact = runSync(generateExact(5, 7, { candidates: 3, refineNodes: 0 }));
    const wrap = runSync(
      generateUnique(5, 6, makeRng(3), { maxWalls: 8, tries: 40, wrap: true }),
    ).puzzle;
    for (const p of [exact, wrap]) {
      const path = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true }).paths[0];
      for (let len = 1; len < path.length; len++) {
        const r = boardLegCollide(p, path.slice(0, len));
        assert.ok(
          !r.infeasible,
          `${p.exact ? 'exact' : 'wrap'} prefix ${len}: ${JSON.stringify(r.conflicts)}`,
        );
      }
    }
  },
);

test(
  'boardLegCollide: an Exact board reports the same collision as the standard one with the same order',
  FAST,
  () => {
    // The position of the standard test in unit/solver.test.js (7x7, path cut at 13 cells), but with the numbers
    // 5, 10, 15... instead of 1, 2, 3...: Exact numbers are steps, the legs run by their order.
    const n = 7,
      rc = (r, c) => r * n + c;
    const make = scale => {
      const q = makePuzzle(n);
      for (const [r, c, k] of [
        [0, 0, 6],
        [0, 5, 5],
        [1, 5, 7],
        [3, 2, 4],
        [3, 6, 3],
        [5, 1, 1],
        [6, 5, 2],
      ]) {
        q.cp[rc(r, c)] = k * scale;
      }
      for (const [type, r, c] of [
        ['V', 3, 0],
        ['V', 3, 4],
        ['H', 4, 1],
        ['V', 5, 0],
        ['V', 5, 1],
        ['V', 6, 4],
      ]) {
        const other = type === 'V' ? rc(r, c + 1) : rc(r + 1, c);
        setWallId(q.walls, edgeId(n, rc(r, c), other), true);
      }
      return q;
    };
    const path = [
      [5, 1],
      [6, 1],
      [6, 0],
      [5, 0],
      [4, 0],
      [3, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 4],
      [4, 4],
    ].map(([r, c]) => rc(r, c));
    const standard = boardLegCollide(make(1), path);
    assert.ok(standard.infeasible, 'the standard position is stuck');
    const exact = make(5);
    exact.exact = true;
    assert.deepStrictEqual(boardLegCollide(exact, path), standard);
  },
);

// 3x3, cells 0..8 row by row; arrows: [a, b] = the one move a -> b that the edge allows
const arrowBoard = (moves, cps = {}) => {
  const p = makePuzzle(3);
  p.arrows = new Uint8Array(9);
  for (const [a, b] of moves) setArrowId(p.arrows, edgeId(3, a, b), a < b ? 1 : -1);
  for (const [cell, k] of Object.entries(cps)) p.cp[cell] = k;
  return p;
};

test(
  'arrows overlays: a head that every arrow points at has nowhere to go (connectivity)',
  FAST,
  () => {
    const p = arrowBoard(
      [
        [1, 0],
        [3, 0],
      ],
      { 0: 1, 8: 2 },
    );
    const r = boardConnectivity(p, [0]);
    assert.deepStrictEqual(r.reachable.size, 0);
    assert.deepStrictEqual(
      [...r.unreachable].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepStrictEqual(r.connOk, false);
    const open = makePuzzle(3);
    open.cp[0] = 1;
    open.cp[8] = 2;
    assert.deepStrictEqual(
      boardConnectivity(open, [0]).connOk,
      true,
      'the same board without arrows is connected',
    );
  },
);

test(
  'arrows overlays: a cell that cannot be left is a dead end and is cut off from the end',
  FAST,
  () => {
    // arrows 2 -> 1 and 4 -> 1: cell 1 can be entered from 0, 2 and 4 but only left back onto the head
    const p = arrowBoard(
      [
        [2, 1],
        [4, 1],
      ],
      { 0: 1, 8: 2 },
    );
    const r = boardConnectivity(p, [0]);
    assert.deepStrictEqual([...r.deadEnd], [1]);
    assert.deepStrictEqual([...r.unreachable], [1], 'the others still reach the end');
    assert.deepStrictEqual(r.connOk, false);
  },
);

test('arrows overlays: a one-way move that is the only one left is forced', FAST, () => {
  const p = arrowBoard([[3, 0]], { 0: 1, 8: 2 }); // 3 -> 0 only: the head on 0 cannot go down
  const r = boardPropagation(p, [0]);
  assert.deepStrictEqual(r.infeasible, false);
  assert.ok((r.dirs[0] & 1) !== 0 && (r.dirs[1] & 2) !== 0, 'the head must step right: 0 -> 1');
  assert.ok(r.forced.has(1));
});

test(
  'segBlockerDir: arrows make a cell a bottleneck that a two-way board does not have',
  FAST,
  () => {
    // only 1 -> 4 / 3 -> 4 can leave the top-left corner area: moves 1 -> 2 and 3 -> 6 are not allowed
    const p = arrowBoard(
      [
        [2, 1],
        [6, 3],
      ],
      { 0: 1, 8: 2 },
    );
    const { out } = buildMoves(p),
      { nb } = buildNeighbors(p),
      vis = new Uint8Array(9);
    vis[0] = 1;
    assert.deepStrictEqual([...segBlockerDir(out, 9, vis, 0, 8)], [4]);
    assert.deepStrictEqual([...segBlocker(nb, 9, vis, 0, 8)], [], 'two-way: other routes exist');
    assert.deepStrictEqual(
      [...segBlockerDir(out, 9, new Uint8Array(9).fill(1), 0, 8)],
      [],
      'nothing to pass when everything is visited',
    );
    const r = boardLegCollide(p, [0]);
    assert.deepStrictEqual(r.infeasible, false);
  },
);

test('arrows overlays: nothing is flagged on any prefix of the real solution', FAST, () => {
  for (const seed of [1, 2, 3]) {
    const p = runSync(generateArrows(5, seed));
    const path = solve(p, { limit: 2, nodeCap: 5e6, capture: true }).paths[0];
    const next = new Map(path.map((c, i) => [c, path[i + 1]]));
    const consecutive = (a, b) => next.get(a) === b || next.get(b) === a;
    for (let len = 1; len < path.length; len++) {
      const prefix = path.slice(0, len),
        at = `seed ${seed}, prefix ${len}`;
      const conn = boardConnectivity(p, prefix);
      assert.ok(
        conn.connOk && conn.unreachable.size === 0 && conn.deadEnd.size === 0,
        `connectivity, ${at}`,
      );
      const prop = boardPropagation(p, prefix);
      assert.ok(!prop.infeasible, `propagation, ${at}`);
      for (let u = 0; u < 25; u++) {
        for (let d = 0; d < 4; d++) {
          if (!((prop.dirs[u] >> d) & 1)) continue;
          const v = neighbourCell(5, false, u, d);
          assert.ok(
            v >= 0 && consecutive(u, v),
            `forced edge ${u}-${v} is on the solution, ${at}`,
          );
        }
      }
      assert.ok(!boardLegCollide(p, prefix).infeasible, `leg collision, ${at}`);
    }
  }
});

const adjacent = (n, a, b) =>
  Math.abs(((a / n) | 0) - ((b / n) | 0)) + Math.abs((a % n) - (b % n)) === 1;

test(
  'randomPathPuzzle with loop: a ring cut at cell 1, at least 3 numbers in order, solvable',
  FAST,
  () => {
    for (const [n, K, seed] of [
      [4, 4, 1],
      [6, 5, 2],
      [6, 2, 3],
    ]) {
      const p = randomPathPuzzle(n, K, makeRng(seed), false, true);
      assert.ok(p.loop && !p.wrap, 'a Loop puzzle');
      assert.deepStrictEqual(p.path.length, n * n);
      assert.ok(
        adjacent(n, p.path[0], p.path[n * n - 1]),
        'the last cell touches the first: a ring',
      );
      assert.deepStrictEqual(p.cp[p.path[0]], 1);
      assert.deepStrictEqual(labelCount(p), Math.max(3, Math.min(K, n * n)), 'K is at least 3');
      const numbers = p.path.map(c => p.cp[c]).filter(Boolean);
      assert.deepStrictEqual(
        numbers,
        [...numbers].sort((a, b) => a - b),
        'in order along the ring',
      );
      assert.ok(validate(p).ok, validate(p).msg);
      assert.ok(solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count >= 1, 'the ring solves it');
    }
  },
);

test('generateUnique with loop: a unique ring puzzle; an odd board is refused', FAST, () => {
  const r = runSync(generateUnique(6, 6, makeRng(3), { maxWalls: 10, tries: 40, loop: true }));
  assert.ok(r.unique && r.puzzle.loop && validate(r.puzzle).ok);
  assert.deepStrictEqual(solve(r.puzzle, { limit: 2, nodeCap: 5e6, prop: true }).count, 1);
  let thrown = false;
  try {
    runSync(generateUnique(5, 5, makeRng(3), { loop: true }));
  } catch {
    thrown = true;
  }
  assert.ok(thrown, 'no ring on an odd board');
});

test('loop overlays: nothing is flagged on any prefix of the real ring', FAST, () => {
  for (const [n, seed] of [
    [4, 1],
    [6, 2],
  ]) {
    const p = runSync(generateLoop(n, seed));
    const path = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true }).paths[0];
    const T = n * n,
      onRing = new Set();
    path.forEach((c, i) => {
      const d = path[(i + 1) % T];
      onRing.add(`${c}-${d}`);
      onRing.add(`${d}-${c}`);
    });
    for (let len = 2; len < T; len++) {
      const prefix = path.slice(0, len),
        at = `${n}x${n} seed ${seed}, prefix ${len}`;
      const conn = boardConnectivity(p, prefix);
      assert.ok(
        conn.connOk && !conn.unreachable.size && !conn.deadEnd.size,
        `connectivity, ${at}`,
      );
      const prop = boardPropagation(p, prefix);
      assert.ok(!prop.infeasible, `propagation, ${at}`);
      for (let u = 0; u < T; u++) {
        for (let d = 0; d < 4; d++) {
          if (!((prop.dirs[u] >> d) & 1)) continue;
          const v = neighbourCell(n, false, u, d);
          assert.ok(
            v >= 0 && onRing.has(`${u}-${v}`),
            `forced edge ${u}-${v} is on the ring, ${at}`,
          );
        }
      }
      assert.ok(!boardLegCollide(p, prefix).infeasible, `leg collision, ${at}`);
    }
  }
});

test(
  'loop overlays: a ring that can no longer close is reported (cell 1 has no free neighbour)',
  FAST,
  () => {
    const p = makePuzzle(4);
    p.loop = true;
    p.cp[0] = 1;
    p.cp[10] = 2;
    p.cp[15] = 3;
    // cell 1's neighbours, 4 and 1, are both on the path in the middle: nothing can ever close the ring
    const stuck = boardConnectivity(p, [0, 4, 8, 9, 5, 1, 2]);
    assert.ok(!stuck.connOk && stuck.unreachable.has(0), 'cell 1 is cut off');
    assert.ok(boardConnectivity(p, [0, 4, 8]).connOk, 'a healthy start');
    assert.deepStrictEqual(
      boardConnectivity(p, [0]).connOk,
      true,
      'only cell 1 so far: nothing to say',
    );
  },
);

test('miniPreviewSvg: a Loop route is drawn closed', FAST, () => {
  const p = makePuzzle(4);
  p.loop = true;
  p.cp[0] = 1;
  p.cp[3] = 2;
  p.cp[15] = 3;
  const points = svg => svg.match(/<polyline points="([^"]*)"/)[1].split(' ');
  const closed = points(miniPreviewSvg(p, [0, 1, 2, 3], '#fff'));
  assert.deepStrictEqual(closed.length, 5);
  assert.deepStrictEqual(closed[0], closed[4], 'back to the first cell');
  p.loop = false;
  assert.deepStrictEqual(points(miniPreviewSvg(p, [0, 1, 2, 3], '#fff')).length, 4);
});

test('compare A / B with loop: both runs build ring puzzles', FAST, async () => {
  const flags = decodeFlags(DEFAULT_FLAGS_INT);
  const r = await runCompare({
    n: 6,
    K: 6,
    maxWalls: 10,
    tries: 40,
    hardest: false,
    seed: 3,
    flagsA: flags,
    flagsB: flags,
    loop: true,
  });
  assert.ok(r.a.unique && r.b.unique && r.a.puzzle.loop && r.b.puzzle.loop);
});

test(
  'miniPreviewSvg: a wrap-around board draws its path as a path with seam stubs and a margin',
  FAST,
  () => {
    const p = runSync(
      generateUnique(5, 6, makeRng(3), { maxWalls: 8, tries: 40, wrap: true }),
    ).puzzle;
    const svg = miniPreviewSvg(p, p.path, '#fff');
    assert.ok(svg.includes('<path d="M') && !svg.includes('<polyline'), 'a path, not a polyline');
    assert.ok(svg.includes('viewBox="-0.3 -0.3 5.6 5.6"'), 'margin for the stubs');
    const grid = makePuzzle(5);
    grid.cp[0] = 1;
    grid.cp[24] = 2;
    assert.ok(
      miniPreviewSvg(grid, [0, 1, 2], '#fff').includes('<polyline'),
      'a grid keeps the polyline',
    );
  },
);

test('compare A / B on a torus: both runs build wrap-around puzzles', FAST, async () => {
  const flags = decodeFlags(DEFAULT_FLAGS_INT);
  const r = await runCompare({
    n: 5,
    K: 6,
    maxWalls: 10,
    tries: 40,
    hardest: false,
    seed: 3,
    flagsA: flags,
    flagsB: flags,
    wrap: true,
  });
  assert.ok(r.a.unique && r.b.unique, 'both found a puzzle');
  assert.ok(r.a.puzzle.wrap && r.b.puzzle.wrap, 'both are wrap-around');
  assert.deepStrictEqual(
    [...r.a.puzzle.cp],
    [...r.b.puzzle.cp],
    'same flags, same seed, same puzzle',
  );
  const plain = await runCompare({
    n: 5,
    K: 6,
    maxWalls: 10,
    tries: 40,
    hardest: false,
    seed: 3,
    flagsA: flags,
    flagsB: flags,
  });
  assert.ok(!plain.a.puzzle.wrap, 'without wrap it is a grid puzzle');
});
