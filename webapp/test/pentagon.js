// Tests of the Pentagon boards (core/surface/pentagon.js, the open-border support of
// core/surface/topology.js, solve.js and gen.js) and of the Pentagon generator
// (core/gen/pentagon.js). Registered by tests.js: pentagonTests(t, ok, eq).
// Set PENTAGON_SLOW=1 for the 100-cell board (a few seconds per puzzle).
import { hashStr } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';
import { surfaceTopology, SLOTS } from '../src/core/surface/topology.js';
import {
  pentagonMesh, PENTAGON_KIND, PENTAGON_SIZES, PENTAGON_CELLS,
} from '../src/core/surface/pentagon.js';
import {
  makeSurfacePuzzle, validateSurface, isSolved, serializeSurface, parseSurface, maxNumber,
  wallCount,
} from '../src/core/surface/puzzle.js';
import { solveSurface, countHamiltonianPaths } from '../src/core/surface/solve.js';
import {
  generatePentagon, pentagonK, PENTAGON_SHARE, PENTAGON_CANDIDATES,
} from '../src/core/gen/pentagon.js';
import { makeRng } from '../src/core/rng.js';

const slow = typeof process !== 'undefined' && Boolean(process.env.PENTAGON_SLOW);
const board = n => surfaceTopology(PENTAGON_KIND, n);
const neighboursOf = (top, cell) => {
  const found = [];
  for (let k = 0; k < SLOTS; k++) {
    if (top.nb[cell * SLOTS + k] >= 0) found.push(top.nb[cell * SLOTS + k]);
  }
  return found;
};
const threw = f => { try { f(); return false; } catch { return true; } };
const game = (n, seed, o) => runSync(generatePentagon(n, seed, o));

// Every Hamiltonian path that obeys the rules, by plain search with no pruning at all.
function brute(p) {
  const top = board(p.n);
  const K = maxNumber(p);
  const vis = new Uint8Array(top.T);
  let count = 0;
  const go = (cell, depth, next) => {
    vis[cell] = 1;
    if (depth === top.T) {
      if (next === K + 1 && p.cp[cell] === K) count++;
    } else {
      for (let k = 0; k < top.deg[cell]; k++) {
        const other = top.nb[cell * SLOTS + k];
        if (other < 0 || vis[other] || p.walls[top.edgeAt[cell * SLOTS + k]]) continue;
        const number = p.cp[other];
        if (number && number !== next) continue;
        go(other, depth + 1, number ? next + 1 : next);
      }
    }
    vis[cell] = 0;
  };
  go(p.cp.indexOf(1), 1, 2);
  return count;
}

// The numbering of every board is frozen: puzzles and share codes refer to cell numbers. If this
// fails the board changed: do not edit the hashes, fix the board.
const FROZEN = {
  4: ['8ac141ce', '09197270'],
  6: ['6d7409df', '8e6a7967'],
  8: ['9d03dd2f', 'af390c97'],
  10: ['a95f48ab', '5d1dc5f4'],
};

export function pentagonTests(t, ok, eq) {
  t('pentagon: boards — 16, 36, 64, 100 cells of 5 sides, connected, not bipartite, no cell with '
    + 'fewer than 2 neighbours, only the 4 corner cells have 2', () => {
    eq(PENTAGON_SIZES, [4, 6, 8, 10]);
    for (const n of PENTAGON_SIZES) {
      const top = board(n);
      eq(top.T, PENTAGON_CELLS[n], `n=${n} cells`);
      ok(top.flat && top.centres.length === 2 * top.T, 'flat, with centres');
      let pairs = 0;
      const histogram = {};
      for (let c = 0; c < top.T; c++) {
        eq(top.deg[c], 5, 'every cell has 5 sides');
        const count = neighboursOf(top, c).length;
        histogram[count] = (histogram[count] || 0) + 1;
        pairs += count;
      }
      eq(top.E, pairs / 2, `n=${n} edges`);
      ok(!histogram[0] && !histogram[1], `n=${n} no cell with fewer than 2 neighbours`);
      eq(histogram[2], 4, `n=${n} corner cells`);
      ok(top.bipartite === false && top.classes === null, 'three cells meet at a corner');
      for (let c = 0; c < top.T; c++) ok(top.dist[c * top.T + (top.T - 1)] < 255, 'connected');
    }
  });

  t('pentagon: sides on the border have no neighbour and no edge; the others are matched both '
    + 'ways', () => {
    const top = board(6);
    for (let c = 0; c < top.T; c++) {
      for (let k = 0; k < 5; k++) {
        const other = top.nb[c * SLOTS + k];
        const edge = top.edgeAt[c * SLOTS + k];
        if (other < 0) {
          eq(edge, -1, 'no edge on the border');
          continue;
        }
        ok(edge >= 0 && top.nb[other * SLOTS + top.rev[c * SLOTS + k]] === c, 'matched back');
        eq(top.edgeAt[other * SLOTS + top.rev[c * SLOTS + k]], edge, 'one edge for both sides');
      }
    }
  });

  t('pentagon: every cell is the same pentagon — 4 sides of 0.789 and one of 0.577 (slot 0), '
    + 'angles 90, 90, 120, 120, 120', () => {
    for (const n of PENTAGON_SIZES) {
      const top = board(n);
      const point = corner => [top.verts[corner * 3], top.verts[corner * 3 + 1]];
      for (let c = 0; c < top.T; c++) {
        const ring = [0, 1, 2, 3, 4].map(k => point(top.ring[c * SLOTS + k]));
        const sides = ring.map((a, k) => {
          const b = ring[(k + 1) % 5];
          return Math.hypot(a[0] - b[0], a[1] - b[1]);
        });
        ok(Math.abs(sides[0] - 0.5774) < 1e-3, `n=${n} cell ${c}: slot 0 is the short side`);
        for (let k = 1; k < 5; k++) {
          ok(Math.abs(sides[k] - 0.7887) < 1e-3, `side ${k} is long`);
        }
        const angles = ring.map((b, k) => {
          const a = ring[(k + 4) % 5];
          const d = ring[(k + 1) % 5];
          const u = [a[0] - b[0], a[1] - b[1]];
          const w = [d[0] - b[0], d[1] - b[1]];
          const cos = (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w));
          return Math.round((Math.acos(cos) * 180) / Math.PI);
        }).sort((x, y) => x - y);
        eq(angles, [90, 90, 120, 120, 120], `n=${n} cell ${c}`);
      }
    }
  });

  t('pentagon: every board is symmetric — a quarter turn about the centre maps the cells onto '
    + 'the cells and keeps who touches whom', () => {
    for (const n of PENTAGON_SIZES) {
      const top = board(n);
      const at = (x, y) => {
        for (let c = 0; c < top.T; c++) {
          const near = Math.abs(top.centres[2 * c] - x) < 1e-6;
          if (near && Math.abs(top.centres[2 * c + 1] - y) < 1e-6) return c;
        }
        return -1;
      };
      const turned = Array.from(
        { length: top.T }, (_, c) => at(-top.centres[2 * c + 1], top.centres[2 * c]),
      );
      ok(turned.every(c => c >= 0) && new Set(turned).size === top.T, `n=${n}: a bijection`);
      for (let c = 0; c < top.T; c++) {
        const image = neighboursOf(top, turned[c]).sort((a, b) => a - b);
        const mapped = neighboursOf(top, c).map(o => turned[o]).sort((a, b) => a - b);
        eq(mapped, image, `n=${n} cell ${c}`);
      }
    }
  });

  t('pentagon: the numbering is frozen — reading order of the centres, and a fixed neighbour and '
    + 'corner table per size', () => {
    for (const n of PENTAGON_SIZES) {
      const top = board(n);
      const hashes = [top.nb, top.ring].map(table => hashStr(Array.from(table).join(',')));
      eq(hashes, FROZEN[n], `n=${n}`);
      // rows: y never goes back by more than rounding, and rows are far apart
      const ys = Array.from({ length: top.T }, (_, c) => top.centres[2 * c + 1]);
      for (let c = 1; c < top.T; c++) {
        const gap = ys[c] - ys[c - 1];
        ok(Math.abs(gap) < 1e-9 || gap > 0.25, `n=${n} cell ${c}: same row or a new row below`);
        if (Math.abs(gap) < 1e-9) {
          ok(top.centres[2 * c] > top.centres[2 * c - 2], 'left to right');
        }
      }
    }
    const again = pentagonMesh(6);
    eq(again.cells, pentagonMesh(6).cells, 'the same mesh every time');
    ok(threw(() => pentagonMesh(5)) && threw(() => board(7)), 'only 4, 6, 8, 10');
  });

  t('pentagon: the solver counts the Hamiltonian paths of the 16-cell board like a plain search',
    () => {
      const top = board(4);
      const result = countHamiltonianPaths(top);
      ok(!result.capped && result.count > 0);
      let plain = 0;
      const vis = new Uint8Array(top.T);
      const go = (cell, depth) => {
        vis[cell] = 1;
        if (depth === top.T) plain++;
        else for (const other of neighboursOf(top, cell)) if (!vis[other]) go(other, depth + 1);
        vis[cell] = 0;
      };
      for (let c = 0; c < top.T; c++) go(c, 1);
      eq(result.count, plain);
    });

  t('pentagon: text format — surface pentagon n, round trip, bad sizes and edges refused', () => {
    const p = game(6, 5);
    const text = serializeSurface(p, { path: p.path });
    ok(text.startsWith('surface pentagon 6\n'));
    const back = parseSurface(text);
    eq([back.surface, back.n, Array.from(back.cp), Array.from(back.walls)],
      [PENTAGON_KIND, 6, Array.from(p.cp), Array.from(p.walls)]);
    eq(back.path, p.path);
    ok(validateSurface(back).ok);
    ok(threw(() => parseSurface('surface pentagon 5\n')), 'size 5 does not exist');
    const past = `surface pentagon 4\nwalls ${board(4).E}\n`;
    ok(threw(() => parseSurface(past)), 'edge past the last');
    eq(wallCount(makeSurfacePuzzle(PENTAGON_KIND, 4)), 0);
  });

  t('pentagon-gen: K is 35 to 45% of the cells (at least 4), drawn from the seed', () => {
    for (const n of PENTAGON_SIZES) {
      const rnd = makeRng(n);
      const seen = new Set();
      for (let i = 0; i < 40; i++) {
        const K = pentagonK(n, rnd);
        seen.add(K);
        const cells = PENTAGON_CELLS[n];
        const low = Math.max(4, Math.round(cells * PENTAGON_SHARE[0]));
        ok(K >= low && K <= Math.round(cells * PENTAGON_SHARE[1]), `n=${n} K=${K}`);
      }
      ok(seen.size > 1 || n === 4, `n=${n}: K varies`);
      ok(PENTAGON_CANDIDATES[n] >= 1);
    }
  });

  t('pentagon-gen: puzzles of 16, 36 and 64 cells have exactly one solution (checked against a '
    + 'plain search on 16), the path solves them, the same seed gives the same puzzle', () => {
    for (const [n, seeds] of [[4, [1, 2, 3, 4]], [6, [1, 2, 3]], [8, [1]]]) {
      for (const seed of seeds) {
        const p = game(n, seed);
        eq([p.surface, p.n], [PENTAGON_KIND, n]);
        ok(validateSurface(p).ok, `n=${n} seed=${seed}: valid`);
        ok(isSolved(p, p.path), 'the stored path solves it');
        const solved = solveSurface(p, { limit: 2, nodeCap: 0 });
        eq(solved.count, 1, `n=${n} seed=${seed}: unique`);
        eq(solved.path, p.path, 'and it is the stored path');
        if (n === 4) eq(brute(p), 1, `n=${n} seed=${seed}: unique by plain search`);
        const again = game(n, seed);
        eq([Array.from(again.cp), Array.from(again.walls), again.path],
          [Array.from(p.cp), Array.from(p.walls), p.path], 'same seed, same puzzle');
        eq(p.seed, seed);
      }
    }
    const other = [1, 2].map(seed => Array.from(game(6, seed).cp).join());
    ok(other[0] !== other[1], 'other seed, other puzzle');
  });

  t('pentagon-gen: progress events — frac rises to 1, K is reported, o.K and o.candidates are '
    + 'obeyed, other sizes are refused', () => {
    const events = [];
    const p = runSync(generatePentagon(6, 7, { K: 9, candidates: 2 }), e => events.push(e));
    eq(maxNumber(p), 9);
    ok(events.length > 10);
    ok(events.every(e => e.K === 9 && e.frac >= 0 && e.frac <= 1));
    ok(events.every((e, i) => i === 0 || e.frac >= events[i - 1].frac - 1e-12), 'rises');
    eq(events[events.length - 1].frac, 1);
    eq(events[events.length - 1].walls, wallCount(p), 'the last event has the wall count');
    ok(threw(() => game(5, 1)) && threw(() => game(12, 1)));
  });

  if (slow) {
    t('pentagon-gen: a 100-cell puzzle has exactly one solution', () => {
      const p = game(10, 1);
      eq(solveSurface(p, { limit: 2, nodeCap: 0 }).count, 1);
      ok(isSolved(p, p.path));
    });
  }
}
