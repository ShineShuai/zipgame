// Tests of the Cutout puzzle (boards with holes): the variant (layout, share, generator) and what
// the design app needs for it: the hole tool (apps/design/holes.js), the board drawing
// (apps/design/board.js, on a recording stand-in for the page), the random path / unique generator
// on a board of the designer's own (gen/generate.js o.holes), scatter on such a board, the
// play-mode overlays (core/connectivity.js) and the text format.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { makePuzzle, clonePuzzle, validate, cellCount, maxNumber } from '../../src/core/model.js';
import {
  edgeId,
  edgeCells,
  allEdges,
  setWallId,
  hasWallId,
  wallCount,
  wallIds,
} from '../../src/core/edges.js';
import { serialize, parse } from '../../src/core/format.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { isSolved, step, canStep } from '../../src/core/rules.js';
import { PLAY_SIZES, randomPathPuzzle, generateUnique } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { segmentCrossCount, segmentOverlapCount } from '../../src/core/spatial.js';
import { trapMetrics, SIZE_GRADE_CAP, TRAP_MODEL, withoutAltFrac } from '../../src/core/trap.js';
import { generateTargeted, targetBand } from '../../src/core/gen/target.js';
import {
  generateCutout,
  shapeIsViable,
  isBalanced,
  colourCounts,
  costOf,
  COST,
  CUTOUT_MODEL,
  CUTOUT_GRADE,
  SILHOUETTES,
  LABELS,
  CUTOUT_BOARDS,
} from '../../src/core/gen/cutout.js';
import { proposeBoard, adjacency, shapeProblem } from '../../src/core/gen/shapes.js';
import {
  backbiteHoles,
  pathCrossings,
  interleavedPath,
  layoutFor,
  placeCheckpoints,
  placementScore,
  LAYOUT,
} from '../../src/core/gen/layout.js';
import { ladder } from '../../src/core/ladder.js';
import { boardSvg } from '../../src/apps/play/board.js';
import { FAST, SLOW } from '../harness.js';
import { oracle, ruleMoves } from '../oracle.js';
import { randPuzzle } from './helpers.js';
import { scatter } from '../../src/core/gen/checkpoints.js';
import {
  boardConnectivity,
  boardPropagation,
  boardLegCollide,
} from '../../src/core/connectivity.js';
import { toggleHole, holeCount, boardProblem } from '../../src/apps/design/holes.js';
import { renderBoard } from '../../src/apps/design/board.js';
import { REFUSED } from '../errors.js';

// ---- the variant: holes, layout, share, generator

// every Hamiltonian path of the cells that are left, in checkpoint order (test/oracle.js)
const holesBrute = p => oracle(p, { moves: ruleMoves(p), keep: false }).count;

const holesBoard = (seed, n) => {
  // random board with holes, checkpoints along a random path, random walls off that path
  const rnd = makeRng(seed),
    p = makePuzzle(n);
  p.holes = new Uint8Array(n * n);
  for (let i = 0, h = 1 + Math.floor(rnd() * 5); i < h; i++)
    p.holes[Math.floor(rnd() * n * n)] = 1;
  const TC = cellCount(p),
    vis = new Uint8Array(n * n),
    path = [];
  let budget = 100000;
  const go = c => {
    if (budget-- < 0) return false;
    vis[c] = 1;
    path.push(c);
    if (path.length === TC) return true;
    for (const v of shuffle([c + 1, c - 1, c + n, c - n], rnd))
      if (v >= 0 && v < n * n && !vis[v] && canStep(p, c, v) && go(v)) return true;
    vis[c] = 0;
    path.pop();
    return false;
  };
  for (const s of shuffle(
    [...Array(n * n).keys()].filter(i => !p.holes[i]),
    rnd,
  )) {
    path.length = 0;
    vis.fill(0);
    if (go(s)) break;
  }
  if (path.length !== TC) return null;
  const pos = new Set([0, TC - 1]);
  while (pos.size < Math.min(4, TC)) pos.add(Math.floor(rnd() * TC));
  [...pos]
    .sort((a, b) => a - b)
    .forEach((q, i) => {
      p.cp[path[q]] = i + 1;
    });
  const on = new Set(path.slice(1).map((c, i) => edgeId(n, path[i], c)));
  for (const e of allEdges(n, p.holes)) if (!on.has(e) && rnd() < 0.2) setWallId(p.walls, e, true);
  return p;
};

test(
  'holes: allEdges leaves out the edges that touch a hole; without holes it is unchanged',
  FAST,
  () => {
    const n = 4,
      holes = new Uint8Array(16);
    holes[5] = 1;
    assert.deepStrictEqual(allEdges(n).length, 24);
    assert.deepStrictEqual(allEdges(n, holes).length, 20);
    assert.ok(allEdges(n, holes).every(e => !holes[e >> 1] && !holes[edgeCells(n, e)[1]]));
    assert.deepStrictEqual(allEdges(n, null), allEdges(n));
  },
);

test(
  'holes: the solver finds exactly the solutions a brute-force search finds, with every prune on or off',
  SLOW,
  () => {
    const flags = [
      {},
      { prop: true },
      { prop: true, incr: false },
      { prop: true, lconn: false },
      { prop: true, pocket: true, parity: true, prune2: true, seg: 'all', legCollide: true },
      { pocket: true, parity: true, prune2: true, seg: true },
    ];
    let checked = 0,
      unique = 0;
    for (let seed = 1; checked < 80 && seed < 400; seed++) {
      const p = holesBoard(seed * 31, 3 + (seed % 4));
      if (!p) continue;
      const want = holesBrute(p);
      checked++;
      if (want === 1) unique++;
      assert.ok(want >= 1, 'the board was built from a solution');
      for (const f of flags) {
        const r = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true, ...f });
        assert.deepStrictEqual(r.count, want, `seed ${seed} ${JSON.stringify(f)}`);
        assert.ok(
          r.paths.every(path => path.length === cellCount(p) && isSolved(p, path)),
          'a captured solution has exactly the cells that are left',
        );
      }
    }
    assert.ok(checked >= 80 && unique > 10, `checked ${checked}, unique ${unique}`);
  },
);

test(
  'holes: canStep refuses a hole, isSolved needs every cell that is left, a checkpoint on a hole is invalid',
  FAST,
  () => {
    const p = makePuzzle(3);
    p.holes = new Uint8Array(9);
    p.holes[4] = 1;
    p.cp[0] = 1;
    p.cp[1] = 2;
    assert.ok(!canStep(p, 1, 4) && !canStep(p, 3, 4) && canStep(p, 0, 1));
    assert.deepStrictEqual(cellCount(p), 8);
    p.cp[1] = 0;
    p.cp[3] = 2;
    const ring = [0, 1, 2, 5, 8, 7, 6, 3];
    assert.ok(isSolved(p, ring) && !isSolved(p, ring.slice(0, 7)));
    const q = clonePuzzle(p);
    assert.ok(q.holes && q.holes[4] === 1 && q.holes !== p.holes);
    assert.deepStrictEqual(Object.keys(clonePuzzle(makePuzzle(3))).sort(), ['cp', 'n', 'walls']);
    const path = [];
    step(p, path, 0);
    step(p, path, 1);
    assert.deepStrictEqual(step(p, path, 4), null); // walking into a hole does nothing
    p.cp[4] = 3;
    assert.ok(!validate(p).ok);
  },
);

test('holes: the text format round-trips holes; a standard puzzle has no holes line', FAST, () => {
  const p = holesBoard(5, 5);
  const text = serialize(p),
    back = parse(text);
  assert.ok(/^holes /m.test(text));
  assert.deepStrictEqual([...back.holes], [...p.holes]);
  assert.deepStrictEqual([...back.cp], [...p.cp]);
  assert.deepStrictEqual(serialize(back), text);
  assert.ok(!/holes/.test(serialize(randPuzzle(1, 5, 4, 0.1))));
  let msg = '';
  try {
    parse('size 3\ncheckpoints 1,1=1 0,0=2\nwalls\nholes 1,1');
  } catch (e) {
    msg = e.message;
  }
  assert.ok(/hole/.test(msg), msg);
});

test(
  'cutout: the checkerboard rule — colour counts differ by at most 1, so 5x5 minus its four corners has no path',
  FAST,
  () => {
    const corners = new Uint8Array(25);
    for (const c of [0, 4, 20, 24]) corners[c] = 1;
    assert.deepStrictEqual(colourCounts(5, corners), [9, 12]);
    assert.ok(!isBalanced(5, corners) && !shapeIsViable(5, corners));
    const centre = new Uint8Array(25);
    centre[12] = 1;
    assert.deepStrictEqual(colourCounts(5, centre), [12, 12]);
    assert.ok(isBalanced(5, centre) && shapeIsViable(5, centre));
    assert.deepStrictEqual(colourCounts(4, new Uint8Array(16)), [8, 8]);
    assert.ok(
      !shapeIsViable(
        5,
        Uint8Array.from({ length: 25 }, (_, i) => (i % 5 === 2 ? 1 : 0)),
      ),
    ); // a full column cut away splits the board
  },
);

test(
  'cutout: every outline is offered; boards obey the rule, have a path, no edge hole',
  FAST,
  () => {
    const seen = new Set();
    for (const n of PLAY_SIZES) {
      for (const silhouette of SILHOUETTES) {
        const rnd = makeRng(n * 131 + silhouette.length);
        const interior = silhouette === 'square' ? 2 : 1;
        const board = proposeBoard(n, rnd, { silhouettes: [silhouette], interior });
        if (!board) {
          continue;
        }
        seen.add(silhouette);
        const { holes, path } = board;
        assert.ok(
          board.silhouette === silhouette && LABELS.includes(board.label),
          `${n} ${silhouette}`,
        );
        assert.ok(isBalanced(n, holes) && shapeIsViable(n, holes) && holes.some(Boolean));
        assert.deepStrictEqual(path.length, cellCount({ n, holes }));
        assert.ok(new Set(path).size === path.length, 'every cell once');
        assert.ok(
          path.every(c => !holes[c]),
          'no hole',
        );
        const adj = adjacency(n, holes);
        assert.ok(
          path.every((c, i) => i === 0 || adj[path[i - 1]].includes(c)),
          'neighbour steps',
        );
        if (silhouette === 'square') {
          assert.ok(board.interior >= 1 && ['donut', 'pillars'].includes(board.label));
          for (let i = 0; i < n * n; i++) {
            const edge = i < n || i >= n * (n - 1) || i % n === 0 || i % n === n - 1;
            assert.ok(!(edge && holes[i]), 'an interior hole never touches the edge');
          }
        }
      }
    }
    assert.deepStrictEqual([...seen].sort(), [...SILHOUETTES].sort());
  },
);

test(
  'cutout: boards with several interior holes exist and keep the checkerboard rule',
  FAST,
  () => {
    const counts = new Set();
    const kinds = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const board = proposeBoard(12, makeRng(seed), { silhouettes: ['square'], interior: 4 });
      assert.ok(board && isBalanced(12, board.holes) && shapeIsViable(12, board.holes));
      counts.add(board.interior);
      kinds.add(board.label);
      const holeCells = board.holes.reduce((sum, v) => sum + v, 0);
      assert.ok(holeCells >= board.interior, 'at least one cell per hole');
    }
    assert.ok(counts.has(4) && [...counts].every(c => c >= 3), `hole counts ${[...counts]}`);
    assert.deepStrictEqual([...kinds].sort(), ['donut', 'pillars']);
    const odd = proposeBoard(9, makeRng(5), { silhouettes: ['square'], interior: 3 });
    assert.ok(
      isBalanced(9, odd.holes),
      'odd size: single holes sit on the colour that keeps the rule',
    );
  },
);

test(
  'cutout: generateCutout: unique, balanced, no wall at a hole, deterministic, the cheapest board that reaches the target wins',
  SLOW,
  () => {
    const cases = [
      [5, 11, null],
      [6, 12, ['ell']],
      [7, 13, ['cross']],
      [8, 14, null],
    ];
    cases.push([9, 15, null], [10, 16, ['square']]);
    for (const [n, seed, silhouettes] of cases) {
      const seen = [];
      const base = { silhouettes: silhouettes || undefined, boards: 3, effort: 0.15 };
      const p = runSync(generateCutout(n, seed, { ...base, onCandidate: c => seen.push(c) }));
      const again = runSync(generateCutout(n, seed, base));
      assert.deepStrictEqual(serialize(p), serialize(again), 'deterministic');
      const wanted = silhouettes ? silhouettes[0] : null;
      assert.ok(
        LABELS.includes(p.shape) && (!wanted || wanted === 'square' || p.shape === wanted),
      );
      assert.ok(isBalanced(n, p.holes) && validate(p).ok && p.holes.some(Boolean));
      const r = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true });
      assert.deepStrictEqual([r.count, r.exceeded], [1, false], `${n}x${n} seed ${seed}: unique`);
      assert.ok(isSolved(p, r.paths[0]) && isSolved(p, p.path), 'the stored solution solves it');
      assert.ok(p.path.every((c, i) => i === 0 || canStep(p, p.path[i - 1], c)));
      for (const e of allEdges(n))
        if (hasWallId(p.walls, e))
          assert.ok(!p.holes[e >> 1] && !p.holes[edgeCells(n, e)[1]], 'a wall next to a hole');
      assert.ok(p.cp.every((v, i) => !v || !p.holes[i]));
      assert.ok(
        seen.length >= 1 && seen.length <= 3 + 2,
        'every board tried was reported (3 boards, 2 more in a second look)',
      );
      const hits = seen.filter(c => c.hit);
      assert.deepStrictEqual(p.score.hit, hits.length > 0);
      if (hits.length)
        assert.ok(
          p.score.cost <= Math.min(...hits.map(c => c.cost)) + 1e-9,
          'the winner is the cheapest of the boards that got there',
        );
      else
        assert.ok(
          seen.every(c => c.miss >= p.score.miss - 1e-9),
          'short of the target, the closest board wins',
        );
      assert.deepStrictEqual(p.score.walls, wallCount(p));
      assert.deepStrictEqual(p.score.cost, costOf(p.score.walls, p.score.interior));
      assert.deepStrictEqual(p.score.target, Math.min(CUTOUT_GRADE, SIZE_GRADE_CAP[n] ?? 5));
      const m = trapMetrics(p, undefined, p.path, CUTOUT_MODEL);
      assert.deepStrictEqual(
        [m.grade, +m.predicted.toFixed(9)],
        [p.score.grade, +p.score.difficulty.toFixed(9)],
        'the score is the grade under the Cutout model',
      );
    }
    assert.deepStrictEqual(costOf(4, 2), COST.wall * 4 + COST.hole * 2);
    assert.ok(
      COST.hole < COST.wall,
      'a hole is cheaper than a wall: it pays for itself when it makes a wall unnecessary',
    );
    assert.ok(PLAY_SIZES.every(n => CUTOUT_BOARDS[n] >= 2));
  },
);

test(
  'cutout: the grade model is the trap model without altFrac; a clock ends the search early and still gives a unique puzzle',
  FAST,
  () => {
    const p = runSync(generateCutout(7, 5, { boards: 1, effort: 0.1 }));
    const full = trapMetrics(p, undefined, p.path),
      flat = trapMetrics(p, undefined, p.path, withoutAltFrac());
    const term =
      (TRAP_MODEL.w.altFrac * (full.altFrac - TRAP_MODEL.mean.altFrac)) / TRAP_MODEL.sd.altFrac;
    assert.ok(
      Math.abs(full.predicted - term - flat.predicted) < 1e-9,
      'only the altFrac term goes',
    );
    assert.deepStrictEqual(withoutAltFrac().cuts, TRAP_MODEL.cuts);
    assert.deepStrictEqual(withoutAltFrac(TRAP_MODEL).w.altFrac, 0);
    assert.ok(TRAP_MODEL.w.altFrac !== 0, 'the original model is not touched');
    const b = targetBand(3, 9, TRAP_MODEL, 0.15, true),
      c = targetBand(3, 9, TRAP_MODEL, 0.15, false);
    assert.deepStrictEqual([b.lo, b.hi, b.b], [c.lo, Infinity, Infinity]);
    const t0 = performance.now();
    const q = runSync(generateCutout(9, 3, { maxMs: 1 }));
    assert.ok(
      performance.now() - t0 < 20000,
      'a 1 ms clock ends it after the first board (a start puzzle is always scored)',
    );
    const r = solve(q, { limit: 2, nodeCap: 5e6, prop: true });
    assert.deepStrictEqual([r.count, r.exceeded], [1, false]);
  },
);

test(
  'layout: backbite keeps a Hamiltonian path of the board with holes; crossings of the middle line; the interleaved path crosses at least as often',
  FAST,
  () => {
    for (const [n, seed] of [
      [6, 1],
      [8, 2],
      [10, 3],
    ]) {
      const rnd = makeRng(seed),
        board = proposeBoard(n, rnd, {}),
        adj = adjacency(n, board.holes),
        before = board.path.slice();
      const moved = backbiteHoles(board.path, adj, makeRng(seed + 1), 20 * before.length),
        again = backbiteHoles(board.path, adj, makeRng(seed + 1), 20 * before.length);
      assert.deepStrictEqual(board.path, before, 'the path given is not changed');
      assert.deepStrictEqual(moved, again, 'deterministic');
      assert.deepStrictEqual(
        [...moved].sort((a, b) => a - b),
        [...before].sort((a, b) => a - b),
        'the same cells',
      );
      assert.ok(
        moved.every((c, i) => i === 0 || adj[moved[i - 1]].includes(c)),
        'every step is a move to a neighbour',
      );
      const best = interleavedPath(n, board, makeRng(seed + 2), adj);
      assert.ok(pathCrossings(n, best) >= pathCrossings(n, board.path), 'at least the board path');
      assert.deepStrictEqual(
        [...best].sort((a, b) => a - b),
        [...before].sort((a, b) => a - b),
      );
    }
    const serpentine = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12]; // 4x4, rows in turn: 4 vertical-line crossings, 1 horizontal
    assert.deepStrictEqual(pathCrossings(4, serpentine), 1);
  },
);

test(
  'layout: placeCheckpoints puts K checkpoints with near-even legs; its detour is at least that of the even spacing; stats count what they say',
  FAST,
  () => {
    for (const [n, seed, K] of [
      [7, 4, 6],
      [8, 5, 9],
      [9, 6, 10],
    ]) {
      const board = proposeBoard(n, makeRng(seed), {}),
        adj = adjacency(n, board.holes),
        lay = layoutFor(n, adj, board.path),
        P = board.path.length;
      const pos = placeCheckpoints(lay, K, { quadrant: 0 });
      assert.ok(
        pos && pos.length === K && pos[0] === 0 && pos[K - 1] === P - 1,
        'K positions, both ends',
      );
      const mean = (P - 1) / (K - 1);
      for (let i = 1; i < K; i++) {
        const leg = pos[i] - pos[i - 1];
        assert.ok(
          leg >= Math.floor(LAYOUT.minLeg * mean) && leg <= Math.ceil(LAYOUT.maxLeg * mean),
          `leg ${leg} of mean ${mean.toFixed(1)}`,
        );
      }
      const even = Array.from({ length: K }, (_, i) => Math.round((i * (P - 1)) / (K - 1)));
      assert.ok(
        lay.stats(pos).detour >= lay.stats(even).detour - 1e-9,
        'the optimum is not worse than the even spacing',
      );
      assert.ok(placeCheckpoints(lay, P + 1) === null && placeCheckpoints(lay, 1) === null);
      const cp = new Uint16Array(n * n);
      pos.forEach((q, i) => {
        cp[board.path[q]] = i + 1;
      });
      assert.deepStrictEqual(lay.positionsOf(cp), pos, 'positionsOf reads the numbers back');
    }
    const lay = layoutFor(
      4,
      adjacency(4, new Uint8Array(16)),
      [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12],
    );
    assert.deepStrictEqual(lay.dist(0, 5), 3, 'cell 0 to cell 6 (row 1, column 2): 3 steps');
    assert.deepStrictEqual(
      lay.stats([0, 15]).detour,
      (15 - 3) / 15,
      'one leg from cell 0 to cell 12: 15 steps walked, 3 needed',
    );
  },
);

test(
  'layout: the polish of the placement is deterministic, keeps the legs inside the bounds, never lowers the score, and stats count the overlap of legs the way spatial.js does',
  FAST,
  () => {
    for (const [n, seed, K] of [
      [8, 5, 9],
      [10, 7, 14],
    ]) {
      const board = proposeBoard(n, makeRng(seed), {}),
        adj = adjacency(n, board.holes),
        lay = layoutFor(n, adj, board.path),
        P = board.path.length;
      const dp = placeCheckpoints(lay, K),
        a = placeCheckpoints(lay, K, { rnd: makeRng(3) }),
        b = placeCheckpoints(lay, K, { rnd: makeRng(3) });
      assert.deepStrictEqual(a, b, 'deterministic for a seed');
      assert.deepStrictEqual(a.length, K);
      assert.ok(a[0] === 0 && a[K - 1] === P - 1);
      const mean = (P - 1) / (K - 1);
      for (let i = 1; i < K; i++) {
        const leg = a[i] - a[i - 1];
        assert.ok(
          leg >= Math.floor(LAYOUT.minLeg * mean) && leg <= Math.ceil(LAYOUT.maxLeg * mean),
        );
      }
      assert.ok(
        placementScore(lay, a) >= placementScore(lay, dp) - 1e-9,
        'the local search only keeps what does not lower the score',
      );
      assert.deepStrictEqual(
        placeCheckpoints(lay, K, { rnd: makeRng(3), polish: 0 }),
        dp,
        'polish 0 = the programme alone',
      );
      assert.deepStrictEqual(
        placeCheckpoints(lay, K, { rnd: makeRng(3), overlap: 0, cross: 0 }),
        dp,
        'no weight on overlap: nothing to polish',
      );
      const s = lay.stats(a),
        pts = a.map(q => [(board.path[q] / n) | 0, board.path[q] % n]);
      assert.deepStrictEqual(
        [s.overlap, s.cross],
        [segmentOverlapCount(pts) / (K - 1), segmentCrossCount(pts) / (K - 1)],
      );
    }
  },
);

test(
  'cutout: the layout (interleaved path, checkpoints that change quadrant) is on by default and can be switched off; o.valid in the targeted search',
  SLOW,
  () => {
    const base = { boards: 2, effort: 0.15 };
    for (const [n, seed] of [
      [8, 21],
      [9, 22],
    ]) {
      const on = runSync(generateCutout(n, seed, base)),
        off = runSync(generateCutout(n, seed, { ...base, layout: false })),
        path = runSync(generateCutout(n, seed, { ...base, place: false }));
      for (const p of [on, off, path]) {
        const r = solve(p, { limit: 2, nodeCap: 5e6, prop: true });
        assert.deepStrictEqual([r.count, r.exceeded], [1, false], `${n}x${n}: unique`);
      }
      assert.deepStrictEqual(
        serialize(on),
        serialize(runSync(generateCutout(n, seed, base))),
        'deterministic',
      );
      assert.ok(
        pathCrossings(n, on.path) >= 2 &&
          pathCrossings(n, path.path) === pathCrossings(n, on.path),
        'place: false keeps the interleaved path',
      );
    }
    const none = runSync(generateTargeted(7, 3, 4, { valid: () => false })),
      all = runSync(generateTargeted(7, 3, 4, { valid: () => true })),
      plain = runSync(generateTargeted(7, 3, 4));
    assert.ok(none.puzzle && none.unique, 'every change refused: the start puzzle comes back');
    assert.deepStrictEqual(
      serialize(all.puzzle),
      serialize(plain.puzzle),
      'valid = always true changes nothing',
    );
  },
);

test(
  'target: o.stop ends the search once a start puzzle is scored; the same seed gives the same puzzle; counts-only runs are unchanged',
  SLOW,
  () => {
    const a = runSync(generateTargeted(7, 3, 4, { stop: () => true })),
      b = runSync(generateTargeted(7, 3, 4, { stop: () => true }));
    assert.ok(
      a.puzzle && a.unique && a.proposals <= 2,
      `stopped after the start (${a.proposals} proposals)`,
    );
    assert.deepStrictEqual(serialize(a.puzzle), serialize(b.puzzle));
    const free = runSync(generateTargeted(7, 3, 4, { stop: () => false })),
      plain = runSync(generateTargeted(7, 3, 4));
    assert.deepStrictEqual(serialize(free.puzzle), serialize(plain.puzzle));
  },
);

test('holes: the difficulty grader (ladder, trap) is sound on boards with holes', SLOW, () => {
  for (const [n, seed] of [
    [6, 1],
    [7, 2],
    [8, 3],
    [9, 4],
    [10, 5],
  ]) {
    const p = runSync(generateCutout(n, seed, { boards: 2, effort: 0.1 }));
    const lad = ladder(p);
    const state = JSON.stringify([lad.error, lad.contradiction, lad.solved]);
    assert.ok(!lad.error && !lad.contradiction && lad.solved, `${n}x${n}: ladder ${state}`);
    assert.ok(isSolved(p, lad.path), 'the ladder path is a solution');
    const m = trapMetrics(p);
    assert.ok(m.ok && !m.nonUnique && Number.isFinite(m.predicted), `${n}x${n}: trap`);
    assert.deepStrictEqual(m.T, cellCount(p));
    assert.ok(m.altFrac > 0 && m.altFrac <= 1);
    assert.deepStrictEqual(m.path.length, cellCount(p));
  }
});

test(
  'cutout: boardSvg draws one tile per cell that is left, an outline, and nothing for holes; the standard board is unchanged',
  FAST,
  () => {
    const p = runSync(generateCutout(6, 3, { boards: 1, effort: 0.1 })),
      svg = boardSvg({ puzzle: p, path: [], hintCell: null, hintWrongCell: null });
    assert.ok(svg.includes('class="zip-svg cutout"'));
    assert.deepStrictEqual((svg.match(/<rect /g) || []).length, cellCount(p));
    assert.ok(svg.includes('data-role="outline"'));
    const std = boardSvg({
      puzzle: randPuzzle(2, 5, 4, 0.1),
      path: [],
      hintCell: null,
      hintWrongCell: null,
    });
    assert.ok(!std.includes('cutout') && !std.includes('<rect '));
  },
);

// ---- the design app

// A board of n x n with these [row, col] cells cut out.
function holed(n, cells) {
  const p = makePuzzle(n);
  p.holes = new Uint8Array(n * n);
  for (const [r, c] of cells) p.holes[r * n + c] = 1;
  return p;
}
const DONUT6 = [
  [2, 2],
  [2, 3],
  [3, 2],
  [3, 3],
];
const wallsAtHoles = p => wallIds(p).filter(e => edgeCells(p.n, e).some(c => p.holes[c]));

// What renderBoard asks of the page, recorded: elements with a class name, style, data and children.
function fakePage() {
  const el = () => {
    const classes = new Set();
    const node = {
      className: '',
      style: { setProperty() {} },
      dataset: {},
      children: [],
      attrs: {},
      textContent: '',
      appendChild(child) {
        node.children.push(child);
        return child;
      },
      setAttribute(k, v) {
        node.attrs[k] = v;
      },
      classList: {
        toggle(name, on) {
          if (on === undefined ? !classes.has(name) : on) classes.add(name);
          else classes.delete(name);
        },
        has: name => classes.has(name),
      },
    };
    Object.defineProperty(node, 'innerHTML', {
      set() {
        node.children = [];
      },
      get: () => '',
    });
    return node;
  };
  return { createElement: el, createElementNS: el };
}
function draw(p, mode) {
  const saved = globalThis.document;
  globalThis.document = fakePage();
  try {
    const board = globalThis.document.createElement('div'),
      stage = globalThis.document.createElement('div');
    renderBoard(board, stage, {
      P: p,
      cellSize: 40,
      mode,
      selected: -1,
      pending: -1,
      buffer: '',
      numColour: 0,
      playMode: false,
      playPath: [],
      preview: null,
      previewVisible: true,
      solutions: [],
      solVisible: [],
      dragSrc: -1,
    });
    return board;
  } finally {
    globalThis.document = saved;
  }
}

test(
  "design-cutout: toggleHole cuts and fills, takes the walls on the cell's four sides with it, refuses a numbered cell",
  FAST,
  () => {
    const p = holed(5, []);
    const mid = 2 * 5 + 2;
    for (const e of [mid * 2, mid * 2 + 1, (mid - 1) * 2, (mid - 5) * 2 + 1, (mid + 1) * 2])
      setWallId(p.walls, e, true);
    assert.deepStrictEqual(toggleHole(p, mid), { hole: true, walls: 4 });
    assert.deepStrictEqual(
      wallIds(p),
      [(mid + 1) * 2],
      'the wall between the two cells on the right stays',
    );
    assert.deepStrictEqual(holeCount(p), 1);
    assert.deepStrictEqual(toggleHole(p, mid), { hole: false, walls: 0 });
    assert.deepStrictEqual(holeCount(p), 0);
    p.cp[0] = 1;
    assert.deepStrictEqual(toggleHole(p, 0), null, 'a checkpoint stays');
    assert.deepStrictEqual(holeCount(p), 0);
    // a corner and an edge cell have fewer sides: nothing to take outside the board
    assert.deepStrictEqual(toggleHole(p, 24), { hole: true, walls: 0 });
    assert.deepStrictEqual(holeCount(makePuzzle(5)), 0, 'no holes array: none');
  },
);

test(
  'design-cutout: shapeProblem says why a board has no path; shapeIsViable is its yes / no',
  FAST,
  () => {
    assert.deepStrictEqual(shapeProblem(6, holed(6, DONUT6).holes), null);
    assert.deepStrictEqual(
      shapeProblem(
        6,
        holed(6, [
          [0, 0],
          [1, 1],
        ]).holes,
      ) !== null,
      true,
    );
    assert.ok(
      /Checkerboard rule: 16 cells of one colour against 18/.test(
        shapeProblem(
          6,
          holed(6, [
            [0, 0],
            [1, 1],
          ]).holes,
        ),
      ),
      shapeProblem(
        6,
        holed(6, [
          [0, 0],
          [1, 1],
        ]).holes,
      ),
    );
    // a column of holes cuts the board in two pieces (balanced: 3 + 3 of each colour per piece)
    assert.ok(
      /one piece/.test(
        shapeProblem(
          6,
          holed(
            6,
            [0, 1, 2, 3, 4, 5].map(r => [r, 2]),
          ).holes,
        ),
      ),
    );
    // a cell whose three neighbours are holes
    assert.ok(
      /no neighbour/.test(
        shapeProblem(
          4,
          holed(4, [
            [0, 1],
            [1, 0],
            [2, 2],
            [3, 3],
          ]).holes,
        ),
      ),
    );
    assert.ok(
      /Fewer than 4/.test(
        shapeProblem(
          2,
          holed(2, [
            [0, 0],
            [0, 1],
          ]).holes,
        ),
      ),
    );
    assert.deepStrictEqual(
      boardProblem(makePuzzle(5)),
      null,
      'a board without holes is not checked',
    );
    // the old yes / no, written out again: balanced, every cell has a neighbour, at most two cells hang on one,
    // at least 4 cells, one piece
    const reference = (n, holes) => {
      if (!isBalanced(n, holes)) return false;
      const adj = adjacency(n, holes);
      const cells = [...holes.keys()].filter(i => !holes[i]);
      if (
        cells.length < 4 ||
        cells.some(i => adj[i].length === 0) ||
        cells.filter(i => adj[i].length === 1).length > 2
      )
        return false;
      const seen = new Set([cells[0]]),
        stack = [cells[0]];
      while (stack.length)
        for (const v of adj[stack.pop()])
          if (!seen.has(v)) {
            seen.add(v);
            stack.push(v);
          }
      return seen.size === cells.length;
    };
    const rnd = makeRng(5);
    let yes = 0;
    for (let k = 0; k < 400; k++) {
      const holes = new Uint8Array(25);
      for (let i = 0; i < 25; i++) holes[i] = rnd() < 0.18 ? 1 : 0;
      assert.deepStrictEqual(
        shapeIsViable(5, holes),
        reference(5, holes),
        `mask ${[...holes].join('')}`,
      );
      yes += shapeIsViable(5, holes) ? 1 : 0;
    }
    assert.ok(yes > 20 && yes < 380, `the masks cover both answers (${yes} yes)`);
  },
);

test(
  'design-cutout: scatter on a board with holes numbers cells that are left only; without holes it is as before',
  FAST,
  () => {
    const p = holed(6, DONUT6);
    for (let seed = 1; seed <= 10; seed++) {
      const cp = scatter(p, 9, makeRng(seed));
      const numbered = [...cp].map((v, i) => [v, i]).filter(([v]) => v);
      assert.deepStrictEqual(numbered.length, 9);
      assert.deepStrictEqual(
        numbered.map(([v]) => v).sort((a, b) => a - b),
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
      );
      assert.ok(
        numbered.every(([, i]) => !p.holes[i]),
        `seed ${seed}: a number on a hole`,
      );
    }
    assert.deepStrictEqual(
      [...scatter(p, 99, makeRng(1))].filter(Boolean).length,
      cellCount(p),
      'at most one number per cell that is left',
    );
    // the same call on a puzzle with no holes array gives the shuffle it always gave
    const plain = makePuzzle(6);
    assert.deepStrictEqual(
      [...scatter(plain, 7, makeRng(3))],
      [...scatter({ ...plain, holes: new Uint8Array(36) }, 7, makeRng(3))],
    );
  },
);

test(
  'design-cutout: randomPathPuzzle on a holed board — a path over the cells left, the holes kept; the reason when there is none',
  FAST,
  () => {
    for (const [n, cells] of [
      [6, DONUT6],
      [7, [[3, 3]]],
      [5, [[2, 2]]],
      [
        6,
        [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ],
      ],
    ]) {
      const board = holed(n, cells);
      for (let seed = 1; seed <= 4; seed++) {
        const p = randomPathPuzzle(n, 6, makeRng(seed), false, false, 0, false, board.holes);
        const tag = `n=${n} seed=${seed}`;
        assert.deepStrictEqual(p.path.length, cellCount(board), tag);
        assert.ok(
          p.path.every(c => !board.holes[c]),
          `${tag}: the path keeps off the holes`,
        );
        assert.deepStrictEqual([...p.holes], [...board.holes], tag);
        assert.ok(p.holes !== board.holes, 'a copy');
        assert.ok(validate(p).ok && isSolved(p, p.path), `${tag}: ${validate(p).msg}`);
        assert.deepStrictEqual(maxNumber(p), 6);
      }
    }
    let message = '';
    try {
      randomPathPuzzle(
        6,
        6,
        makeRng(1),
        false,
        false,
        0,
        false,
        holed(6, [
          [0, 0],
          [1, 1],
        ]).holes,
      );
    } catch (e) {
      message = e.message;
    }
    assert.ok(/Checkerboard rule/.test(message), message);
    // K counts the cells left, not n * n
    assert.deepStrictEqual(
      maxNumber(
        randomPathPuzzle(
          4,
          99,
          makeRng(2),
          false,
          false,
          0,
          false,
          holed(4, [
            [1, 1],
            [1, 2],
          ]).holes,
        ),
      ),
      14,
    );
  },
);

test(
  'design-cutout: generateUnique on a holed board — one solution, holes kept, no wall at a hole; refused where there is no path',
  FAST,
  () => {
    for (const [n, cells] of [
      [6, DONUT6],
      [7, [[3, 3]]],
      [5, [[2, 2]]],
    ]) {
      const board = holed(n, cells);
      const r = runSync(
        generateUnique(n, n, makeRng(n * 7), { maxWalls: 12, tries: 30, holes: board.holes }),
      );
      assert.ok(r.unique, `n=${n}: unique`);
      assert.deepStrictEqual([...r.puzzle.holes], [...board.holes]);
      assert.deepStrictEqual(wallsAtHoles(r.puzzle), [], `n=${n}: no wall touches a hole`);
      assert.deepStrictEqual(
        solve(r.puzzle, { limit: 2, nodeCap: 1e6, prop: true }).count,
        1,
        `n=${n}: one solution`,
      );
      assert.ok(r.walls <= 12, `n=${n}: ${r.walls} walls`);
    }
    // the hardest-of-all-tries mode and the build / minimize / score flags work as on a plain board
    const board = holed(6, DONUT6);
    const hard = runSync(
      generateUnique(6, 6, makeRng(4), {
        maxWalls: 12,
        tries: 4,
        hardest: true,
        holes: board.holes,
      }),
    );
    assert.ok(hard.unique && hard.nodes > 0);
    for (const bad of [
      {
        holes: holed(6, [
          [0, 0],
          [1, 1],
        ]).holes,
      },
      { holes: board.holes, wrap: true },
      { holes: board.holes, loop: true },
    ]) {
      assert.throws(() => runSync(generateUnique(6, 6, makeRng(1), bad)), REFUSED, 'refused');
    }
    // without o.holes nothing changes: the same puzzle for the same seed
    const a = runSync(generateUnique(5, 5, makeRng(9), { maxWalls: 8, tries: 10 }));
    const b = runSync(generateUnique(5, 5, makeRng(9), { maxWalls: 8, tries: 10, holes: null }));
    assert.deepStrictEqual(serialize(a.puzzle), serialize(b.puzzle));
    assert.ok(!('holes' in a.puzzle));
  },
);

test('design-cutout: the solver flags the design app offers agree on a holed board', FAST, () => {
  const flags = [
    {},
    { prop: true },
    { prop: true, pocket: true, parity: true, prune2: true, seg: 'all', legCollide: true },
  ];
  for (const [n, cells] of [
    [6, DONUT6],
    [
      7,
      [
        [3, 3],
        [0, 0],
      ],
    ],
  ]) {
    const p = randomPathPuzzle(n, 5, makeRng(n), false, false, 0, false, holed(n, cells).holes);
    const runs = flags.map(f => solve(p, { limit: 3, nodeCap: 5e6, capture: true, ...f }));
    for (const r of runs)
      assert.deepStrictEqual([r.count, r.paths], [runs[0].count, runs[0].paths], `n=${n}`);
    assert.ok(runs[0].count >= 1, 'the generated path solves it');
  }
});

test(
  'design-cutout: play-mode overlays on a holed board — holes are neither unreachable nor dead, no prefix of the solution is stuck',
  FAST,
  () => {
    const board = holed(6, DONUT6);
    const q = runSync(
      generateUnique(6, 6, makeRng(3), { maxWalls: 10, tries: 30, holes: board.holes }),
    ).puzzle;
    const path = solve(q, { limit: 2, nodeCap: 1e6, capture: true, prop: true }).paths[0];
    const holes = new Set([...q.holes.keys()].filter(i => q.holes[i]));
    assert.deepStrictEqual(holes.size, 4);
    for (let len = 1; len < path.length; len++) {
      const prefix = path.slice(0, len);
      const conn = boardConnectivity(q, prefix);
      assert.ok(conn.connOk, `prefix ${len}: connected`);
      assert.deepStrictEqual(
        conn.reachable.size,
        cellCount(q) - len,
        `prefix ${len}: every cell left can be reached`,
      );
      for (const h of holes)
        assert.ok(
          !conn.unreachable.has(h) && !conn.deadEnd.has(h) && !conn.reachable.has(h),
          `prefix ${len}: hole ${h}`,
        );
      assert.ok(!boardPropagation(q, prefix).infeasible, `prefix ${len}: propagation`);
      assert.ok(!boardLegCollide(q, prefix).infeasible, `prefix ${len}: legs`);
    }
  },
);

test(
  'design-cutout: export and import keep the holes, the walls, the numbers and a path; a checkpoint on a hole is refused',
  FAST,
  () => {
    const board = holed(6, DONUT6);
    const q = runSync(
      generateUnique(6, 6, makeRng(8), { maxWalls: 10, tries: 30, holes: board.holes }),
    ).puzzle;
    const path = solve(q, { limit: 2, nodeCap: 1e6, capture: true, prop: true }).paths[0];
    const text = serialize(q, { path });
    assert.ok(/^holes 2,2 2,3 3,2 3,3$/m.test(text), text);
    const back = parse(text);
    assert.deepStrictEqual([...back.holes], [...q.holes]);
    assert.deepStrictEqual([...back.cp], [...q.cp]);
    assert.deepStrictEqual(wallIds(back), wallIds(q));
    assert.deepStrictEqual(back.path, path);
    let msg = '';
    try {
      parse('size 4\ncheckpoints 1,1=1 0,0=2\nwalls\nholes 1,1');
    } catch (e) {
      msg = e.message;
    }
    assert.ok(/hole/.test(msg), msg);
    // a design board with no hole yet exports as a plain puzzle
    const empty = holed(5, []);
    assert.ok(!/^holes/m.test(serialize(empty)));
    assert.deepStrictEqual(colourCounts(5, empty.holes), [13, 12]);
  },
);

test(
  'design-cutout: renderBoard draws a hole as a cell of its own kind, without wall handles; the Holes tool shows it',
  FAST,
  () => {
    const p = holed(4, [[1, 1]]); // cell 5
    p.cp[0] = 1;
    const board = draw(p, 'number');
    const cells = board.children.filter(c => c.className.startsWith('cell'));
    assert.deepStrictEqual(cells.length, 16);
    assert.deepStrictEqual(
      cells.filter(c => c.className.includes('hole')).map(c => +c.dataset.idx),
      [5],
    );
    assert.ok(
      cells.every(c => c.className.includes('hole') !== c.className.includes('editable')),
      'a hole is not editable',
    );
    const handles = board.children.filter(c => c.className.startsWith('wallhit'));
    assert.deepStrictEqual(handles.length, 24 - 4, 'the four edges of the hole have no handle');
    const edges = handles.map(h => +h.dataset.edge);
    for (const gone of [3, 8, 10, 11]) assert.ok(!edges.includes(gone), `edge ${gone}`);
    assert.ok(!board.classList.has('holemode'));
    assert.ok(draw(p, 'hole').classList.has('holemode'));
    // a board without holes draws what it always drew
    const plain = draw(makePuzzle(4), 'number');
    assert.deepStrictEqual(
      plain.children.filter(c => c.className.startsWith('wallhit')).length,
      24,
    );
    assert.ok(
      plain.children
        .filter(c => c.className.startsWith('cell'))
        .every(c => c.className.includes('editable')),
    );
  },
);
