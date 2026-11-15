// Unit tests of the Cutout variant: boards with holes, layout, share, design app.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle, clonePuzzle, validate, cellCount } from '../../src/core/model.js';
import {
  edgeId, edgeCells, allEdges, setWallId, hasWallId, wallCount,
} from '../../src/core/edges.js';
import { serialize, parse } from '../../src/core/format.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { isSolved, step, canStep } from '../../src/core/rules.js';
import { PLAY_SIZES } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { segmentCrossCount, segmentOverlapCount } from '../../src/core/spatial.js';
import { trapMetrics, SIZE_GRADE_CAP, TRAP_MODEL, withoutAltFrac } from '../../src/core/trap.js';
import { generateTargeted, targetBand } from '../../src/core/gen/target.js';
import {
  generateCutout, shapeIsViable, isBalanced, colourCounts, costOf, COST, CUTOUT_MODEL,
  CUTOUT_GRADE, SILHOUETTES, LABELS, CUTOUT_BOARDS,
} from '../../src/core/gen/cutout.js';
import { proposeBoard, adjacency } from '../../src/core/gen/shapes.js';
import {
  backbiteHoles, pathCrossings, interleavedPath, layoutFor, placeCheckpoints, placementScore,
  LAYOUT,
} from '../../src/core/gen/layout.js';
import { ladder } from '../../src/core/ladder.js';
import { boardSvg } from '../../src/apps/play/board.js';
import { designCutoutTests } from '../design-cutout.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { randPuzzle } from './helpers.js';

const holesBrute = p => { // every Hamiltonian path of the cells that are left, in checkpoint order
  const n = p.n, T = n * n, K = Math.max(...p.cp), start = p.cp.indexOf(1), end = p.cp.indexOf(K), TC = cellCount(p), vis = new Uint8Array(T); let count = 0;
  const go = (c, len, need) => {
    if (p.cp[c]) { if (p.cp[c] !== need) return; need++; }
    if (len === TC) { if (c === end && need === K + 1) count++; return; }
    vis[c] = 1;
    for (const v of [c + 1, c - 1, c + n, c - n]) if (v >= 0 && v < T && !vis[v] && canStep(p, c, v)) go(v, len + 1, need);
    vis[c] = 0;
  };
  go(start, 1, 1);
  return count;
};

const holesBoard = (seed, n) => { // random board with holes, checkpoints along a random path, random walls off that path
  const rnd = makeRng(seed), p = makePuzzle(n); p.holes = new Uint8Array(n * n);
  for (let i = 0, h = 1 + Math.floor(rnd() * 5); i < h; i++) p.holes[Math.floor(rnd() * n * n)] = 1;
  const TC = cellCount(p), vis = new Uint8Array(n * n), path = []; let budget = 100000;
  const go = c => {
    if (budget-- < 0) return false;
    vis[c] = 1; path.push(c);
    if (path.length === TC) return true;
    for (const v of shuffle([c + 1, c - 1, c + n, c - n], rnd)) if (v >= 0 && v < n * n && !vis[v] && canStep(p, c, v) && go(v)) return true;
    vis[c] = 0; path.pop(); return false;
  };
  for (const s of shuffle([...Array(n * n).keys()].filter(i => !p.holes[i]), rnd)) { path.length = 0; vis.fill(0); if (go(s)) break; }
  if (path.length !== TC) return null;
  const pos = new Set([0, TC - 1]); while (pos.size < Math.min(4, TC)) pos.add(Math.floor(rnd() * TC));
  [...pos].sort((a, b) => a - b).forEach((q, i) => { p.cp[path[q]] = i + 1; });
  const on = new Set(path.slice(1).map((c, i) => edgeId(n, path[i], c)));
  for (const e of allEdges(n, p.holes)) if (!on.has(e) && rnd() < 0.2) setWallId(p.walls, e, true);
  return p;
};

t('holes: allEdges leaves out the edges that touch a hole; without holes it is unchanged', () => {
  const n = 4, holes = new Uint8Array(16); holes[5] = 1;
  eq(allEdges(n).length, 24); eq(allEdges(n, holes).length, 20);
  ok(allEdges(n, holes).every(e => !holes[e >> 1] && !holes[edgeCells(n, e)[1]]));
  eq(allEdges(n, null), allEdges(n));
});

t.slow('holes: the solver finds exactly the solutions a brute-force search finds, with every prune on or off', () => {
  const flags = [{}, { prop: true }, { prop: true, incr: false }, { prop: true, lconn: false }, { prop: true, pocket: true, parity: true, prune2: true, seg: 'all', legCollide: true }, { pocket: true, parity: true, prune2: true, seg: true }];
  let checked = 0, unique = 0;
  for (let seed = 1; checked < 80 && seed < 400; seed++) {
    const p = holesBoard(seed * 31, 3 + (seed % 4)); if (!p) continue;
    const want = holesBrute(p); checked++; if (want === 1) unique++;
    ok(want >= 1, 'the board was built from a solution');
    for (const f of flags) {
      const r = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true, ...f });
      eq(r.count, want, `seed ${seed} ${JSON.stringify(f)}`);
      ok(r.paths.every(path => path.length === cellCount(p) && isSolved(p, path)), 'a captured solution has exactly the cells that are left');
    }
  }
  ok(checked >= 80 && unique > 10, `checked ${checked}, unique ${unique}`);
});

t('holes: canStep refuses a hole, isSolved needs every cell that is left, a checkpoint on a hole is invalid', () => {
  const p = makePuzzle(3); p.holes = new Uint8Array(9); p.holes[4] = 1; p.cp[0] = 1; p.cp[1] = 2;
  ok(!canStep(p, 1, 4) && !canStep(p, 3, 4) && canStep(p, 0, 1));
  eq(cellCount(p), 8);
  p.cp[1] = 0; p.cp[3] = 2;
  const ring = [0, 1, 2, 5, 8, 7, 6, 3];
  ok(isSolved(p, ring) && !isSolved(p, ring.slice(0, 7)));
  const q = clonePuzzle(p); ok(q.holes && q.holes[4] === 1 && q.holes !== p.holes);
  eq(Object.keys(clonePuzzle(makePuzzle(3))).sort(), ['cp', 'n', 'walls']);
  const path = []; step(p, path, 0); step(p, path, 1); eq(step(p, path, 4), null); // walking into a hole does nothing
  p.cp[4] = 3; ok(!validate(p).ok);
});

t('holes: the text format round-trips holes; a standard puzzle has no holes line', () => {
  const p = holesBoard(5, 5);
  const text = serialize(p), back = parse(text);
  ok(/^holes /m.test(text)); eq([...back.holes], [...p.holes]); eq([...back.cp], [...p.cp]); eq(serialize(back), text);
  ok(!/holes/.test(serialize(randPuzzle(1, 5, 4, 0.1))));
  let msg = ''; try { parse('size 3\ncheckpoints 1,1=1 0,0=2\nwalls\nholes 1,1'); } catch (e) { msg = e.message; }
  ok(/hole/.test(msg), msg);
});

t('cutout: the checkerboard rule — colour counts differ by at most 1, so 5x5 minus its four corners has no path', () => {
  const corners = new Uint8Array(25); for (const c of [0, 4, 20, 24]) corners[c] = 1;
  eq(colourCounts(5, corners), [9, 12]); ok(!isBalanced(5, corners) && !shapeIsViable(5, corners));
  const centre = new Uint8Array(25); centre[12] = 1;
  eq(colourCounts(5, centre), [12, 12]); ok(isBalanced(5, centre) && shapeIsViable(5, centre));
  eq(colourCounts(4, new Uint8Array(16)), [8, 8]);
  ok(!shapeIsViable(5, Uint8Array.from({ length: 25 }, (_, i) => (i % 5 === 2 ? 1 : 0)))); // a full column cut away splits the board
});

t('cutout: every outline is offered; boards obey the rule, have a path, no edge hole', () => {
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
      ok(board.silhouette === silhouette && LABELS.includes(board.label), `${n} ${silhouette}`);
      ok(isBalanced(n, holes) && shapeIsViable(n, holes) && holes.some(Boolean));
      eq(path.length, cellCount({ n, holes }));
      ok(new Set(path).size === path.length, 'every cell once');
      ok(path.every(c => !holes[c]), 'no hole');
      const adj = adjacency(n, holes);
      ok(path.every((c, i) => i === 0 || adj[path[i - 1]].includes(c)), 'neighbour steps');
      if (silhouette === 'square') {
        ok(board.interior >= 1 && ['donut', 'pillars'].includes(board.label));
        for (let i = 0; i < n * n; i++) {
          const edge = i < n || i >= n * (n - 1) || i % n === 0 || i % n === n - 1;
          ok(!(edge && holes[i]), 'an interior hole never touches the edge');
        }
      }
    }
  }
  eq([...seen].sort(), [...SILHOUETTES].sort());
});

t('cutout: boards with several interior holes exist and keep the checkerboard rule', () => {
  const counts = new Set();
  const kinds = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const board = proposeBoard(12, makeRng(seed), { silhouettes: ['square'], interior: 4 });
    ok(board && isBalanced(12, board.holes) && shapeIsViable(12, board.holes));
    counts.add(board.interior);
    kinds.add(board.label);
    const holeCells = board.holes.reduce((sum, v) => sum + v, 0);
    ok(holeCells >= board.interior, 'at least one cell per hole');
  }
  ok(counts.has(4) && [...counts].every(c => c >= 3), `hole counts ${[...counts]}`);
  eq([...kinds].sort(), ['donut', 'pillars']);
  const odd = proposeBoard(9, makeRng(5), { silhouettes: ['square'], interior: 3 });
  ok(isBalanced(9, odd.holes), 'odd size: single holes sit on the colour that keeps the rule');
});

t.slow('cutout: generateCutout: unique, balanced, no wall at a hole, deterministic, the cheapest board that reaches the target wins', () => {
  const cases = [[5, 11, null], [6, 12, ['ell']], [7, 13, ['cross']], [8, 14, null]];
  cases.push([9, 15, null], [10, 16, ['square']]);
  for (const [n, seed, silhouettes] of cases) {
    const seen = [];
    const base = { silhouettes: silhouettes || undefined, boards: 3, effort: 0.15 };
    const p = runSync(generateCutout(n, seed, { ...base, onCandidate: c => seen.push(c) }));
    const again = runSync(generateCutout(n, seed, base));
    eq(serialize(p), serialize(again), 'deterministic');
    const wanted = silhouettes ? silhouettes[0] : null;
    ok(LABELS.includes(p.shape) && (!wanted || wanted === 'square' || p.shape === wanted));
    ok(isBalanced(n, p.holes) && validate(p).ok && p.holes.some(Boolean));
    const r = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true });
    eq([r.count, r.exceeded], [1, false], `${n}x${n} seed ${seed}: unique`);
    ok(isSolved(p, r.paths[0]) && isSolved(p, p.path), 'the stored solution solves it');
    ok(p.path.every((c, i) => i === 0 || canStep(p, p.path[i - 1], c)));
    for (const e of allEdges(n)) if (hasWallId(p.walls, e)) ok(!p.holes[e >> 1] && !p.holes[edgeCells(n, e)[1]], 'a wall next to a hole');
    ok(p.cp.every((v, i) => !v || !p.holes[i]));
    ok(seen.length >= 1 && seen.length <= 3 + 2, 'every board tried was reported (3 boards, 2 more in a second look)');
    const hits = seen.filter(c => c.hit);
    eq(p.score.hit, hits.length > 0);
    if (hits.length) ok(p.score.cost <= Math.min(...hits.map(c => c.cost)) + 1e-9, 'the winner is the cheapest of the boards that got there');
    else ok(seen.every(c => c.miss >= p.score.miss - 1e-9), 'short of the target, the closest board wins');
    eq(p.score.walls, wallCount(p));
    eq(p.score.cost, costOf(p.score.walls, p.score.interior));
    eq(p.score.target, Math.min(CUTOUT_GRADE, SIZE_GRADE_CAP[n] ?? 5));
    const m = trapMetrics(p, undefined, p.path, CUTOUT_MODEL);
    eq([m.grade, +m.predicted.toFixed(9)], [p.score.grade, +p.score.difficulty.toFixed(9)], 'the score is the grade under the Cutout model');
  }
  eq(costOf(4, 2), COST.wall * 4 + COST.hole * 2);
  ok(COST.hole < COST.wall, 'a hole is cheaper than a wall: it pays for itself when it makes a wall unnecessary');
  ok(PLAY_SIZES.every(n => CUTOUT_BOARDS[n] >= 2));
});

t('cutout: the grade model is the trap model without altFrac; a clock ends the search early and still gives a unique puzzle', () => {
  const p = runSync(generateCutout(7, 5, { boards: 1, effort: 0.1 }));
  const full = trapMetrics(p, undefined, p.path), flat = trapMetrics(p, undefined, p.path, withoutAltFrac());
  const term = TRAP_MODEL.w.altFrac * (full.altFrac - TRAP_MODEL.mean.altFrac) / TRAP_MODEL.sd.altFrac;
  ok(Math.abs(full.predicted - term - flat.predicted) < 1e-9, 'only the altFrac term goes');
  eq(withoutAltFrac().cuts, TRAP_MODEL.cuts);
  eq(withoutAltFrac(TRAP_MODEL).w.altFrac, 0);
  ok(TRAP_MODEL.w.altFrac !== 0, 'the original model is not touched');
  const b = targetBand(3, 9, TRAP_MODEL, 0.15, true), c = targetBand(3, 9, TRAP_MODEL, 0.15, false);
  eq([b.lo, b.hi, b.b], [c.lo, Infinity, Infinity]);
  const t0 = performance.now();
  const q = runSync(generateCutout(9, 3, { maxMs: 1 }));
  ok(performance.now() - t0 < 20000, 'a 1 ms clock ends it after the first board (a start puzzle is always scored)');
  const r = solve(q, { limit: 2, nodeCap: 5e6, prop: true });
  eq([r.count, r.exceeded], [1, false]);
});

t('layout: backbite keeps a Hamiltonian path of the board with holes; crossings of the middle line; the interleaved path crosses at least as often', () => {
  for (const [n, seed] of [[6, 1], [8, 2], [10, 3]]) {
    const rnd = makeRng(seed), board = proposeBoard(n, rnd, {}), adj = adjacency(n, board.holes), before = board.path.slice();
    const moved = backbiteHoles(board.path, adj, makeRng(seed + 1), 20 * before.length), again = backbiteHoles(board.path, adj, makeRng(seed + 1), 20 * before.length);
    eq(board.path, before, 'the path given is not changed');
    eq(moved, again, 'deterministic');
    eq([...moved].sort((a, b) => a - b), [...before].sort((a, b) => a - b), 'the same cells');
    ok(moved.every((c, i) => i === 0 || adj[moved[i - 1]].includes(c)), 'every step is a move to a neighbour');
    const best = interleavedPath(n, board, makeRng(seed + 2), adj);
    ok(pathCrossings(n, best) >= pathCrossings(n, board.path), 'at least the board path');
    eq([...best].sort((a, b) => a - b), [...before].sort((a, b) => a - b));
  }
  const serpentine = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12]; // 4x4, rows in turn: 4 vertical-line crossings, 1 horizontal
  eq(pathCrossings(4, serpentine), 1);
});

t('layout: placeCheckpoints puts K checkpoints with near-even legs; its detour is at least that of the even spacing; stats count what they say', () => {
  for (const [n, seed, K] of [[7, 4, 6], [8, 5, 9], [9, 6, 10]]) {
    const board = proposeBoard(n, makeRng(seed), {}), adj = adjacency(n, board.holes), lay = layoutFor(n, adj, board.path), P = board.path.length;
    const pos = placeCheckpoints(lay, K, { quadrant: 0 });
    ok(pos && pos.length === K && pos[0] === 0 && pos[K - 1] === P - 1, 'K positions, both ends');
    const mean = (P - 1) / (K - 1);
    for (let i = 1; i < K; i++) { const leg = pos[i] - pos[i - 1]; ok(leg >= Math.floor(LAYOUT.minLeg * mean) && leg <= Math.ceil(LAYOUT.maxLeg * mean), `leg ${leg} of mean ${mean.toFixed(1)}`); }
    const even = Array.from({ length: K }, (_, i) => Math.round((i * (P - 1)) / (K - 1)));
    ok(lay.stats(pos).detour >= lay.stats(even).detour - 1e-9, 'the optimum is not worse than the even spacing');
    ok(placeCheckpoints(lay, P + 1) === null && placeCheckpoints(lay, 1) === null);
    const cp = new Uint16Array(n * n);
    pos.forEach((q, i) => { cp[board.path[q]] = i + 1; });
    eq(lay.positionsOf(cp), pos, 'positionsOf reads the numbers back');
  }
  const lay = layoutFor(4, adjacency(4, new Uint8Array(16)), [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12]);
  eq(lay.dist(0, 5), 3, 'cell 0 to cell 6 (row 1, column 2): 3 steps');
  eq(lay.stats([0, 15]).detour, (15 - 3) / 15, 'one leg from cell 0 to cell 12: 15 steps walked, 3 needed');
});

t('layout: the polish of the placement is deterministic, keeps the legs inside the bounds, never lowers the score, and stats count the overlap of legs the way spatial.js does', () => {
  for (const [n, seed, K] of [[8, 5, 9], [10, 7, 14]]) {
    const board = proposeBoard(n, makeRng(seed), {}), adj = adjacency(n, board.holes), lay = layoutFor(n, adj, board.path), P = board.path.length;
    const dp = placeCheckpoints(lay, K), a = placeCheckpoints(lay, K, { rnd: makeRng(3) }), b = placeCheckpoints(lay, K, { rnd: makeRng(3) });
    eq(a, b, 'deterministic for a seed');
    eq(a.length, K);
    ok(a[0] === 0 && a[K - 1] === P - 1);
    const mean = (P - 1) / (K - 1);
    for (let i = 1; i < K; i++) { const leg = a[i] - a[i - 1]; ok(leg >= Math.floor(LAYOUT.minLeg * mean) && leg <= Math.ceil(LAYOUT.maxLeg * mean)); }
    ok(placementScore(lay, a) >= placementScore(lay, dp) - 1e-9, 'the local search only keeps what does not lower the score');
    eq(placeCheckpoints(lay, K, { rnd: makeRng(3), polish: 0 }), dp, 'polish 0 = the programme alone');
    eq(placeCheckpoints(lay, K, { rnd: makeRng(3), overlap: 0, cross: 0 }), dp, 'no weight on overlap: nothing to polish');
    const s = lay.stats(a), pts = a.map(q => [board.path[q] / n | 0, board.path[q] % n]);
    eq([s.overlap, s.cross], [segmentOverlapCount(pts) / (K - 1), segmentCrossCount(pts) / (K - 1)]);
  }
});

t.slow('cutout: the layout (interleaved path, checkpoints that change quadrant) is on by default and can be switched off; o.valid in the targeted search', () => {
  const base = { boards: 2, effort: 0.15 };
  for (const [n, seed] of [[8, 21], [9, 22]]) {
    const on = runSync(generateCutout(n, seed, base)), off = runSync(generateCutout(n, seed, { ...base, layout: false })), path = runSync(generateCutout(n, seed, { ...base, place: false }));
    for (const p of [on, off, path]) { const r = solve(p, { limit: 2, nodeCap: 5e6, prop: true }); eq([r.count, r.exceeded], [1, false], `${n}x${n}: unique`); }
    eq(serialize(on), serialize(runSync(generateCutout(n, seed, base))), 'deterministic');
    ok(pathCrossings(n, on.path) >= 2 && pathCrossings(n, path.path) === pathCrossings(n, on.path), 'place: false keeps the interleaved path');
  }
  const none = runSync(generateTargeted(7, 3, 4, { valid: () => false })), all = runSync(generateTargeted(7, 3, 4, { valid: () => true })), plain = runSync(generateTargeted(7, 3, 4));
  ok(none.puzzle && none.unique, 'every change refused: the start puzzle comes back');
  eq(serialize(all.puzzle), serialize(plain.puzzle), 'valid = always true changes nothing');
});

t.slow('target: o.stop ends the search once a start puzzle is scored; the same seed gives the same puzzle; counts-only runs are unchanged', () => {
  const a = runSync(generateTargeted(7, 3, 4, { stop: () => true })), b = runSync(generateTargeted(7, 3, 4, { stop: () => true }));
  ok(a.puzzle && a.unique && a.proposals <= 2, `stopped after the start (${a.proposals} proposals)`);
  eq(serialize(a.puzzle), serialize(b.puzzle));
  const free = runSync(generateTargeted(7, 3, 4, { stop: () => false })), plain = runSync(generateTargeted(7, 3, 4));
  eq(serialize(free.puzzle), serialize(plain.puzzle));
});

t.slow('holes: the difficulty grader (ladder, trap) is sound on boards with holes', () => {
  for (const [n, seed] of [[6, 1], [7, 2], [8, 3], [9, 4], [10, 5]]) {
    const p = runSync(generateCutout(n, seed, { boards: 2, effort: 0.1 }));
    const lad = ladder(p);
    const state = JSON.stringify([lad.error, lad.contradiction, lad.solved]);
    ok(!lad.error && !lad.contradiction && lad.solved, `${n}x${n}: ladder ${state}`);
    ok(isSolved(p, lad.path), 'the ladder path is a solution');
    const m = trapMetrics(p);
    ok(m.ok && !m.nonUnique && Number.isFinite(m.predicted), `${n}x${n}: trap`);
    eq(m.T, cellCount(p));
    ok(m.altFrac > 0 && m.altFrac <= 1);
    eq(m.path.length, cellCount(p));
  }
});

t('cutout: boardSvg draws one tile per cell that is left, an outline, and nothing for holes; the standard board is unchanged', () => {
  const p = runSync(generateCutout(6, 3, { boards: 1, effort: 0.1 })), svg = boardSvg({ puzzle: p, path: [], hintCell: null, hintWrongCell: null });
  ok(svg.includes('class="zip-svg cutout"'));
  eq((svg.match(/<rect /g) || []).length, cellCount(p)); ok(svg.includes('data-role="outline"'));
  const std = boardSvg({ puzzle: randPuzzle(2, 5, 4, 0.1), path: [], hintCell: null, hintWrongCell: null });
  ok(!std.includes('cutout') && !std.includes('<rect '));
});

designCutoutTests(t, ok, eq);

registerAsyncTests();
