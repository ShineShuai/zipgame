// Tests of what the design app needs for the Wrap-around and Exact puzzle types: the seam geometry
// (view/geometry.js chordSegments), the board previews, the designer helpers (random Exact path,
// wrap-aware scatter, seam walls), the leg-collision check on Exact boards and the A/B compare on a
// torus. Registered by tests.js: designVariantsTests(t, ta, ok, eq).
import { makePuzzle, validate, labelCount } from '../src/core/model.js';
import { setWallId, hasWallId, wallIds, clearSeamWalls, edgeId } from '../src/core/edges.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { chordSegments } from '../src/view/geometry.js';
import { miniPreviewSvg } from '../src/apps/design/board.js';
import { randomExactPuzzle, generateExact } from '../src/core/gen/exact.js';
import { randomPathPuzzle, generateUnique } from '../src/core/gen/generate.js';
import { scatter } from '../src/core/gen/checkpoints.js';
import { boardLegCollide } from '../src/core/connectivity.js';
import { runCompare } from '../src/apps/design/compare.js';
import { decodeFlags, DEFAULT_FLAGS_INT } from '../src/core/gen/flags.js';

export function designVariantsTests(t, ta, ok, eq) {
  t('chordSegments: one straight piece on a grid, two across a seam on a torus', () => {
    eq(chordSegments(5, false, 0, 4), [[0.5, 0.5, 4.5, 0.5]], 'a grid never wraps');
    eq(chordSegments(5, true, 0, 2), [[0.5, 0.5, 2.5, 0.5]], 'no seam on the short way');
    // 0 -> 4 on a row of 5: one step left over the seam, so a stub out of 0 and a stub into 4
    eq(chordSegments(5, true, 0, 4), [[0.5, 0.5, -0.5, 0.5], [5.5, 0.5, 4.5, 0.5]]);
    // down over the bottom seam: cell 20 (last row, column 0) -> cell 0
    eq(chordSegments(5, true, 20, 0), [[0.5, 4.5, 0.5, 5.5], [0.5, -0.5, 0.5, 0.5]]);
    // both axes at once (diagonal): 0 -> 24
    const diag = chordSegments(5, true, 0, 24);
    eq(diag.length, 2);
    eq(diag[0], [0.5, 0.5, -0.5, -0.5]);
    eq(diag[1], [5.5, 5.5, 4.5, 4.5]);
  });

  t('clearSeamWalls: drops only the walls a grid does not have, and counts them', () => {
    const p = makePuzzle(4);
    setWallId(p.walls, 5 * 2, true); // V next to cell 5, inside the board
    setWallId(p.walls, 5 * 2 + 1, true); // H below cell 5, inside the board
    setWallId(p.walls, 7 * 2, true); // V of the last column: a seam
    setWallId(p.walls, 13 * 2 + 1, true); // H of the last row: a seam
    eq(clearSeamWalls(p), 2);
    eq(wallIds(p), [10, 11]);
    eq(clearSeamWalls(p), 0);
    ok(hasWallId(p.walls, 10) && hasWallId(p.walls, 11));
  });

  t('randomExactPuzzle: a path whose numbers are its steps, K numbers, start and end among them', () => {
    for (const [n, K, seed] of [[5, 4, 1], [6, 7, 2], [7, 2, 3]]) {
      const p = randomExactPuzzle(n, K, makeRng(seed));
      ok(p.exact && !p.wrap && !p.arrows, 'an Exact puzzle');
      eq(labelCount(p), K);
      eq(p.cp[p.path[0]], 1);
      eq(p.cp[p.path[n * n - 1]], n * n);
      p.path.forEach((cell, i) => { if (p.cp[cell]) eq(p.cp[cell], i + 1, 'number = step'); });
      ok(validate(p).ok, validate(p).msg);
      ok(solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count >= 1, 'its own path solves it');
    }
    eq(labelCount(randomExactPuzzle(5, 1, makeRng(4))), 2, 'at least the start and the end');
  });

  t('scatter: on a wrap-around board it numbers K cells 1..K and is deterministic', () => {
    const w = randomPathPuzzle(6, 5, makeRng(9), true);
    const a = scatter(w, 5, makeRng(10)), b = scatter(w, 5, makeRng(10));
    eq([...a], [...b]);
    eq([...a].filter(Boolean).sort(), [1, 2, 3, 4, 5]);
    // the nearest-next order walks across a seam: the cells 0 and 5 are neighbours on a torus only
    const p = makePuzzle(6);
    p.wrap = true;
    const tight = scatter(p, 6, makeRng(1));
    eq([...tight].filter(Boolean).length, 6);
  });

  t('boardLegCollide: never calls a prefix of the real solution stuck, on Exact and wrap-around boards', () => {
    const exact = runSync(generateExact(5, 7, { candidates: 3, refineNodes: 0 }));
    const wrap = runSync(generateUnique(5, 6, makeRng(3), { maxWalls: 8, tries: 40, wrap: true })).puzzle;
    for (const p of [exact, wrap]) {
      const path = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true }).paths[0];
      for (let len = 1; len < path.length; len++) {
        const r = boardLegCollide(p, path.slice(0, len));
        ok(!r.infeasible, `${p.exact ? 'exact' : 'wrap'} prefix ${len}: ${JSON.stringify(r.conflicts)}`);
      }
    }
  });

  t('boardLegCollide: an Exact board reports the same collision as the standard one with the same order', () => {
    // The position of the standard test in tests.js (7x7, path cut at 13 cells), but with the numbers
    // 5, 10, 15... instead of 1, 2, 3...: Exact numbers are steps, the legs run by their order.
    const n = 7, rc = (r, c) => r * n + c;
    const make = scale => {
      const q = makePuzzle(n);
      for (const [r, c, k] of [[0, 0, 6], [0, 5, 5], [1, 5, 7], [3, 2, 4], [3, 6, 3], [5, 1, 1], [6, 5, 2]]) {
        q.cp[rc(r, c)] = k * scale;
      }
      for (const [type, r, c] of [['V', 3, 0], ['V', 3, 4], ['H', 4, 1], ['V', 5, 0], ['V', 5, 1], ['V', 6, 4]]) {
        const other = type === 'V' ? rc(r, c + 1) : rc(r + 1, c);
        setWallId(q.walls, edgeId(n, rc(r, c), other), true);
      }
      return q;
    };
    const path = [[5, 1], [6, 1], [6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4]]
      .map(([r, c]) => rc(r, c));
    const standard = boardLegCollide(make(1), path);
    ok(standard.infeasible, 'the standard position is stuck');
    const exact = make(5);
    exact.exact = true;
    eq(boardLegCollide(exact, path), standard);
  });

  t('miniPreviewSvg: a wrap-around board draws its path as a path with seam stubs and a margin', () => {
    const p = runSync(generateUnique(5, 6, makeRng(3), { maxWalls: 8, tries: 40, wrap: true })).puzzle;
    const svg = miniPreviewSvg(p, p.path, '#fff');
    ok(svg.includes('<path d="M') && !svg.includes('<polyline'), 'a path, not a polyline');
    ok(svg.includes('viewBox="-0.3 -0.3 5.6 5.6"'), 'margin for the stubs');
    const grid = makePuzzle(5);
    grid.cp[0] = 1; grid.cp[24] = 2;
    ok(miniPreviewSvg(grid, [0, 1, 2], '#fff').includes('<polyline'), 'a grid keeps the polyline');
  });

  ta('compare A / B on a torus: both runs build wrap-around puzzles', async () => {
    const flags = decodeFlags(DEFAULT_FLAGS_INT);
    const r = await runCompare({
      n: 5, K: 6, maxWalls: 10, tries: 40, hardest: false, seed: 3, flagsA: flags, flagsB: flags, wrap: true,
    });
    ok(r.a.unique && r.b.unique, 'both found a puzzle');
    ok(r.a.puzzle.wrap && r.b.puzzle.wrap, 'both are wrap-around');
    eq([...r.a.puzzle.cp], [...r.b.puzzle.cp], 'same flags, same seed, same puzzle');
    const plain = await runCompare({
      n: 5, K: 6, maxWalls: 10, tries: 40, hardest: false, seed: 3, flagsA: flags, flagsB: flags,
    });
    ok(!plain.a.puzzle.wrap, 'without wrap it is a grid puzzle');
  });
}
