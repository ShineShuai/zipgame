// Tests of the Pentagon boards (core/pentagon.js, the open-border support of
// core/surface/topology.js, solve.js and gen.js) and of the Pentagon generator
// (core/gen/pentagon.js). Registered by tests.js: pentagonTests(t, ok, eq).
// Set PENTAGON_SLOW=1 for the 100-cell board (a few seconds per puzzle).
import { hashStr } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';
import { surfaceTopology, SLOTS } from '../src/core/surface/topology.js';
import {
  pentagonMesh, PENTAGON_KIND, PENTAGON_SIZES, PENTAGON_CELLS, PENTAGON_BOARD_SIZES,
  isPentagon, shapeHint,
} from '../src/core/pentagon.js';
import {
  makeSurfacePuzzle, validateSurface, isSolved, serializeSurface, parseSurface, maxNumber,
  wallCount,
} from '../src/core/surface/puzzle.js';
import { solveSurface, countHamiltonianPaths } from '../src/core/surface/solve.js';
import {
  generatePentagon, pentagonK, pentagonDefaultK, PENTAGON_CANDIDATES,
} from '../src/core/gen/pentagon.js';
import { makeRng } from '../src/core/rng.js';
import { pickK, kRange } from '../src/core/gen/pick-k.js';
import { generate } from '../src/core/gen/generate.js';
import { maxNumber as flatMax, makePuzzle } from '../src/core/model.js';
import {
  encodeShare, decodeShare, SHARE_VERSION_PENTAGON, PENTAGON, SHARE_VERSION_PUZZLE,
} from '../src/core/share-code.js';
import { makeShareRecord, shareStatus } from '../src/features/share.js';
import {
  buildFlat, cellAt, pickSide, routePieces, routeCrossings,
} from '../src/view/surface-net.js';
import { surfaceSvg, netFrame } from '../src/apps/design/surface-board.js';
import { keptK } from '../src/apps/design/k-field.js';
import { playGradesFor } from '../src/core/grades.js';
import {
  surfaceTrapMetrics, surfaceTrapProfile, surfaceSolutionPath, GRAPH_TRAP_MODEL,
} from '../src/core/surface/trap.js';
import { TRAP_CFG, trapGradeOf, SIZE_GRADE_CAP } from '../src/core/trap.js';

const slow = typeof process !== 'undefined' && Boolean(process.env.PENTAGON_SLOW);
const board = n => surfaceTopology(PENTAGON_KIND, n);
const neighboursOf = (top, cell) => {
  const found = [];
  for (let k = 0; k < SLOTS; k++) {
    if (top.nb[cell * SLOTS + k] >= 0) found.push(top.nb[cell * SLOTS + k]);
  }
  return found;
};
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const versionOf = code => ALPHABET.indexOf(code[0]) >> 3; // the first 3 bits of a code
const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: maxNumber(p), variant: PENTAGON, puzzle: p, ...extra,
});
// A puzzle that is only well formed (not necessarily unique): the numbers 1, 2, ... on `cells`,
// walls on `edges`.
const made = (n, cells, edges) => {
  const p = makeSurfacePuzzle(PENTAGON_KIND, n);
  cells.forEach((cell, i) => { p.cp[cell] = i + 1; });
  edges.forEach(edge => { p.walls[edge] = 1; });
  return p;
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
  5: ['6f6ec879', '9e27987c'],
  6: ['6d7409df', '8e6a7967'],
  7: ['664faff8', '5ec24b86'],
  8: ['9d03dd2f', 'af390c97'],
  9: ['85d19675', '89a82f81'],
  10: ['a95f48ab', '5d1dc5f4'],
  11: ['9337a669', 'c9dfbb98'],
};

export function pentagonTests(t, ok, eq) {
  t('pentagon: boards — 16 to 100 cells of 5 sides, connected, not bipartite, no cell with fewer '
    + 'than 2 neighbours; the boards of the play app have only the 4 corner cells with 2', () => {
    eq(PENTAGON_SIZES, [4, 6, 8, 9, 10]);
    eq(PENTAGON_BOARD_SIZES.map(n => PENTAGON_CELLS[n]), [16, 24, 36, 48, 64, 80, 96, 100]);
    for (const n of PENTAGON_BOARD_SIZES) {
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
      const twos = [5, 7, 11].includes(n) ? { 5: 8, 7: 12, 11: 16 }[n] : 4;
      eq(histogram[2], twos, `n=${n} cells with 2 neighbours`);
      const hint = shapeHint(top);
      eq([hint.twoNeighbour, hint.fixed, hint.path], [twos, 2 * twos, top.T - 1],
        `n=${n} shape hint`);
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
    for (const n of PENTAGON_BOARD_SIZES) {
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

  t('pentagon: every board is symmetric — a quarter turn about the centre (a half turn for the '
    + '96-cell board) maps the cells onto the cells and keeps who touches whom', () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const at = (x, y) => {
        for (let c = 0; c < top.T; c++) {
          const near = Math.abs(top.centres[2 * c] - x) < 1e-6;
          if (near && Math.abs(top.centres[2 * c + 1] - y) < 1e-6) return c;
        }
        return -1;
      };
      const half = n === 9; // the portrait board: a half turn only
      const turned = Array.from({ length: top.T }, (_, c) => {
        const [x, y] = [top.centres[2 * c], top.centres[2 * c + 1]];
        return half ? at(-x, -y) : at(-y, x);
      });
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
    for (const n of PENTAGON_BOARD_SIZES) {
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
    ok(threw(() => pentagonMesh(3)) && threw(() => board(12)), 'only the boards 4 to 11');
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
    eq([back.kind, back.n, Array.from(back.cp), Array.from(back.walls)],
      [PENTAGON_KIND, 6, Array.from(p.cp), Array.from(p.walls)]);
    eq(back.path, p.path);
    ok(validateSurface(back).ok);
    ok(threw(() => parseSurface('surface pentagon 12\n')), 'size 12 does not exist');
    const past = `surface pentagon 4\nwalls ${board(4).E}\n`;
    ok(threw(() => parseSurface(past)), 'edge past the last');
    eq(wallCount(makeSurfacePuzzle(PENTAGON_KIND, 4)), 0);
  });

  t('pentagon-gen: the number of checkpoints follows the rule of the square boards — pickK on '
    + 'the range from the square root to a quarter of the cells', () => {
    eq([16, 36, 64, 96, 100].map(cells => kRange(cells)),
      [[4, 5], [6, 9], [8, 16], [10, 24], [10, 25]]);
    for (const n of PENTAGON_BOARD_SIZES) {
      const [min, max] = kRange(PENTAGON_CELLS[n]);
      const seen = [];
      for (let seed = 1; seed <= 600; seed++) {
        const K = pentagonK(n, makeRng(seed));
        eq(K, pickK(min, max, makeRng(seed)), 'the same draw as pickK');
        ok(K >= min && K <= max, `n=${n}: K=${K} in ${min}..${max}`);
        seen.push(K);
      }
      const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
      if (max - min >= 8) {
        ok(Math.abs(mean - (min + 0.3 * (max - min))) < 0.4, `n=${n}: mean ${mean.toFixed(2)}`);
      }
      ok(seen.some(K => K !== seen[0]) || max - min < 2, `n=${n}: K varies`);
      ok(PENTAGON_CANDIDATES[n] >= 1);
    }
  });

  t('pentagon-gen: puzzles of 16, 36 and 64 cells have exactly one solution (checked against a '
    + 'plain search on 16), the path solves them, the same seed gives the same puzzle', () => {
    for (const [n, seeds] of [[4, [1, 2, 3, 4]], [6, [1, 2, 3]], [8, [1]]]) {
      for (const seed of seeds) {
        const p = game(n, seed);
        eq([p.kind, p.n], [PENTAGON_KIND, n]);
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
    ok(threw(() => game(3, 1)) && threw(() => game(12, 1)));
  });

  t('pentagon-design: the flat layout — corners counter-clockwise, y up, every side with a '
    + 'neighbour glued and shared by both cells, a point finds its cell and its side', () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const net = buildFlat(top);
      ok(buildFlat(top) === net, 'built once');
      eq([net.polys.length, net.centers.length, net.tags.length, net.cuts.length],
        [top.T, top.T, 0, 0]);
      ok(net.uniform === true && net.glued.every(v => v === 1), 'one tint, no cuts');
      ok(Math.abs(net.side - 0.7466) < 1e-3, `side ${net.side}`);
      const area = poly => poly.reduce((sum, [x, y], i) => {
        const [nx, ny] = poly[(i + 1) % poly.length];
        return sum + (x * ny - nx * y) / 2;
      }, 0);
      const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
      for (let c = 0; c < top.T; c++) {
        ok(area(net.polys[c]) > 0.5, `n=${n} cell ${c}: counter-clockwise, y up`);
        eq(cellAt(net, ...net.centers[c]), c, `n=${n}: the centre of ${c} is in ${c}`);
        for (let k = 0; k < 5; k++) {
          const o = top.nb[c * SLOTS + k];
          const [a, b] = [net.polys[c][k], net.polys[c][(k + 1) % 5]];
          const mid = [0, 1].map(axis => (a[axis] + b[axis]) / 2);
          const toward = [0, 1].map(axis => mid[axis] + (net.centers[c][axis] - mid[axis]) * 0.2);
          eq(pickSide(net, c, ...toward), k, `n=${n} cell ${c}: a point near side ${k}`);
          if (o < 0) continue;
          const back = top.rev[c * SLOTS + k];
          const shared = same(a, net.polys[o][(back + 1) % 5]) && same(b, net.polys[o][back]);
          ok(shared, `n=${n}: ${c}-${o} share a side`);
        }
      }
      const total = net.polys.reduce((sum, poly) => sum + area(poly), 0);
      ok(Math.abs(total - top.T * area(net.polys[0])) < 1e-6, `n=${n}: the cells are one size`);
    }
  });

  t('pentagon-design: a route is a line through the centres, nothing crosses a cut', () => {
    const p = game(6, 4);
    const net = buildFlat(board(6));
    const pieces = routePieces(net, p.path);
    eq(pieces.length, 1, 'one piece');
    eq(pieces[0], p.path.map(c => net.centers[c]), 'through the centres in order');
    eq(routeCrossings(net, p.path), [], 'no crossings');
  });

  t('pentagon-design: the picture — a polygon per cell, a line per wall, a border line per side '
    + 'on the border, a badge per number, the path and the head in play', () => {
    const count = (markup, text) => markup.split(text).length - 1;
    for (const n of [4, 6, 8]) {
      const top = board(n);
      const p = game(n, 2);
      const net = buildFlat(top);
      const state = {
        P: p, selected: -1, buffer: '', playing: false, path: [], template: null,
        solutions: [], visible: [],
      };
      const { markup, frame } = surfaceSvg(net, state);
      eq(count(markup, 'class="sf-cell'), top.T, `n=${n} cells`);
      eq(count(markup, 'class="sf-wall"'), wallCount(p), 'walls');
      let border = 0;
      for (let i = 0; i < top.T * SLOTS; i++) if (i % SLOTS < 5 && top.nb[i] < 0) border++;
      eq(count(markup, 'class="sf-border"'), border, 'border sides');
      eq([count(markup, 'class="sf-cut"'), count(markup, 'class="sf-tag"')], [0, 0], 'no cuts');
      eq(count(markup, 'class="sf-badge'), maxNumber(p), 'badges');
      ok(markup.startsWith('<svg') && frame.width > 100 && frame.height > 100, 'a picture');
      const centre = net.centers[3];
      const back = frame.toNet(...frame.toPixels(centre));
      ok(Math.abs(back[0] - centre[0]) < 0.02 && Math.abs(back[1] - centre[1]) < 0.02, 'frame');
      const walked = surfaceSvg(net, { ...state, playing: true, path: p.path.slice(0, 6) }).markup;
      const marks = ['sf-path', 'sf-head'].map(name => count(walked, `class="${name}"`));
      eq(marks, [1, 1], 'path, head');
      const solved = surfaceSvg(net, { ...state, solutions: [p.path], visible: [true] }).markup;
      eq(count(solved, 'class="sf-path"'), 1, 'a solution');
    }
    eq(netFrame(buildFlat(board(10))).scale <= 60 / 0.7, true, 'a 100-cell board fits the page');
  });

  t('pentagon-design: design.html — the Pentagon type is offered, and every surface panel but '
    + 'the 3D view buttons and Follow head is shown for it', () => {
    const fs = typeof process !== 'undefined' && process.getBuiltinModule?.('node:fs');
    if (!fs) return; // in the browser the page is not on hand
    const html = fs.readFileSync(new URL('../design.html', import.meta.url), 'utf8');
    ok(html.includes('<option value="pentagon">Pentagon</option>'), 'an option');
    ok(/id="sfBoard"[^>]*data-variants="[^"]*\bpentagon\b/.test(html), 'the board is shown');
    const panel = /<div[^>]*data-variants="([^"]*\bball\b[^"]*)"[^>]*>([^]{0,120})/g;
    const tags = [...html.matchAll(panel)];
    ok(tags.length >= 5, 'the surface panels were found');
    for (const [, variants, after] of tags) {
      if (variants.split(' ').includes('pentagon')) continue;
      ok(/>View<|for="sfFollow"/.test(after), `a panel without Pentagon: ${after.slice(0, 40)}`);
    }
  });

  t('pentagon-design: the Checkpoints field keeps a typed number, cut to the board; else it '
    + 'follows the size', () => {
    const cells = 36;
    eq(keptK({ typed: true, value: '20', cells, fallback: 14 }), '20', 'typed: stays');
    eq(keptK({ typed: true, value: '20', cells: 16, fallback: 6 }), '16', 'cut to a small board');
    eq(keptK({ typed: false, value: '20', cells, fallback: 14 }), '14', 'not typed: the default');
    eq(keptK({ typed: true, value: '', cells, fallback: 14 }), '14', 'emptied: the default');
    eq(keptK({ typed: true, value: 'x', cells, fallback: 14 }), '14', 'not a number: the default');
    eq(keptK({ typed: true, value: '3', cells, fallback: 14 }), '3', 'a small number stays');
  });

  t('pentagon-grade: a forced start — the solution keeps its path, a wrong turn has no solution, '
    + 'only the steps below the last forced cell are counted', () => {
    for (const [n, seed] of [[4, 2], [6, 3], [8, 1]]) {
      const p = game(n, seed);
      const top = board(n);
      const full = solveSurface(p, { limit: 2, forced: p.path });
      eq([full.count, full.path, full.nodes], [1, p.path, 1], `n=${n}: the whole path forced`);
      const start = solveSurface(p, { limit: 2, forced: p.path.slice(0, 5) });
      eq([start.count, start.path], [1, p.path], `n=${n}: a start of the path`);
      ok(start.nodes < solveSurface(p, { limit: 2 }).nodes + 1, 'fewer steps than from the start');
      for (let i = 0; i < Math.min(8, p.path.length - 1); i++) {
        for (let k = 0; k < SLOTS; k++) {
          const cell = top.nb[p.path[i] * SLOTS + k];
          if (cell < 0 || p.path.slice(0, i + 1).includes(cell) || cell === p.path[i + 1]) continue;
          const wrong = solveSurface(p, { limit: 1, forced: [...p.path.slice(0, i + 1), cell] });
          eq(wrong.count, 0, `n=${n}: a wrong turn at step ${i} has no solution`);
        }
      }
    }
  });

  t('pentagon-grade: the wrong turns along the solution — each a neighbour over a side without a '
    + 'wall, none the solution\'s own next cell, none visited; every one dead (checked by plain '
    + 'search on 16 cells)', () => {
    for (const [n, seed] of [[4, 2], [4, 5], [6, 3], [8, 1]]) {
      const p = game(n, seed);
      const top = board(n);
      const profile = surfaceTrapProfile(p, p.path);
      ok(profile.length > 0 && !profile.nonUnique, `n=${n}: some wrong turns, a unique puzzle`);
      for (const { i, cell, sub, capped } of profile) {
        ok(!p.path.slice(0, i + 1).includes(cell) && cell !== p.path[i + 1], 'a real wrong turn');
        const slot = [...Array(SLOTS).keys()].find(k => top.nb[p.path[i] * SLOTS + k] === cell);
        const side = top.edgeAt[p.path[i] * SLOTS + slot];
        ok(slot !== undefined && !p.walls[side], 'next to it, no wall');
        ok(sub >= 0 && typeof capped === 'boolean');
      }
      if (n === 4) {
        for (const { i, cell } of profile) {
          const prefix = [...p.path.slice(0, i + 1), cell];
          const seen = new Uint8Array(top.T);
          prefix.forEach(c => { seen[c] = 1; });
          let completions = 0;
          const go = (head, depth, next) => {
            if (depth === top.T) { if (p.cp[head] === maxNumber(p)) completions++; return; }
            for (let k = 0; k < SLOTS; k++) {
              const other = top.nb[head * SLOTS + k];
              if (other < 0 || seen[other] || p.walls[top.edgeAt[head * SLOTS + k]]) continue;
              const number = p.cp[other];
              if (number && number !== next) continue;
              seen[other] = 1;
              go(other, depth + 1, number ? next + 1 : next);
              seen[other] = 0;
            }
          };
          let next = 2;
          prefix.slice(1).forEach(c => { if (p.cp[c]) next = p.cp[c] + 1; });
          const okPrefix = prefix.every((c, j) => j === 0 || !p.cp[c] || p.cp[c] <= next - 1);
          if (okPrefix) go(cell, prefix.length, next);
          eq(completions, 0, `n=${n}: the wrong turn at step ${i} cannot be finished`);
        }
      }
    }
  });

  t('pentagon-grade: the grade — 0 to 5 by the reduced trap model, capped by the size of a '
    + 'square board with as many cells, the same for a received puzzle (no stored solution), '
    + 'rising with the board', () => {
    const meanPredicted = n => {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) {
        sum += surfaceTrapMetrics(game(n, 100 + seed)).predicted;
      }
      return sum / 6;
    };
    for (const [n, cap] of [[4, 5], [5, SIZE_GRADE_CAP[5]], [6, SIZE_GRADE_CAP[6]], [8, 5]]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = game(n, seed);
        const m = surfaceTrapMetrics(p);
        ok(m.ok && m.grade >= 0 && m.grade <= cap, `n=${n}: grade ${m.grade} <= ${cap}`);
        const cut = Math.min(trapGradeOf(m.predicted, GRAPH_TRAP_MODEL), cap);
        eq(m.grade, cut, 'the model and the cap');
        ok(m.T === PENTAGON_CELLS[n] && m.altFrac > 0, 'the fields of the display');
        eq(m.ladTrials, 0, 'no ladder');
        const graded = playGradesFor(p);
        eq([graded.trap.grade, graded.legacy], [m.grade, null], 'playGradesFor');
        if (PENTAGON_SIZES.includes(n)) {
          const received = decodeShare(encodeShare(makeShareRecord({
            n, timeS: 5, legs: [], K: maxNumber(p), variant: PENTAGON, puzzle: p,
          }))).puzzle;
          eq(playGradesFor(received).trap.grade, m.grade, `n=${n}: the same grade when received`);
        }
      }
    }
    ok(meanPredicted(4) < meanPredicted(6) && meanPredicted(6) < meanPredicted(8),
      'a bigger board grades higher on average');
    eq(surfaceSolutionPath(game(6, 3)).length, 36);
    ok(TRAP_CFG.cap > 0);
  });

  t('pentagon-design: Generate of the design app — the default K is the mean of the rule of '
    + 'the square boards', () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const [min, max] = kRange(PENTAGON_CELLS[n]);
      eq(pentagonDefaultK(n), Math.round(min + 0.3 * (max - min)), `n=${n}`);
    }
    eq([4, 6, 8, 9, 10].map(n => pentagonDefaultK(n)), [4, 7, 10, 14, 15]);
  });

  t('pentagon: isPentagon tells a Pentagon puzzle from a 3D one and from a grid one', () => {
    ok(isPentagon(makeSurfacePuzzle(PENTAGON_KIND, 4)), 'a Pentagon puzzle');
    ok(!isPentagon(makeSurfacePuzzle('tetra', 2)), 'a tetra puzzle has a surface too');
    ok(!isPentagon(makePuzzle(5)), 'a grid puzzle');
    ok(!isPentagon(null) && !isPentagon(undefined), 'no puzzle');
  });

  t('pick-k: kRange is the rule of the square boards on a board with n * n cells', () => {
    for (let n = 4; n <= 16; n++) {
      const min = Math.max(4, n);
      eq(kRange(n * n), [min, Math.max(min + 1, Math.round((n * n) / 4))], `n=${n}`);
    }
  });

  t('pentagon-share: a code of its own version (6) — round trip for every size, short, '
    + 'damaged codes fail', () => {
    eq(SHARE_VERSION_PENTAGON, 6);
    const puzzles = [
      ...[1, 2, 3].map(seed => game(4, seed)),
      ...[1, 2, 3].map(seed => game(6, seed)),
      game(8, 1),
      made(10, [0, 37, 12, 99, 55, 70], [3, 4, 100, 219]),
      made(9, [0, 95, 12, 50, 77], [0, 7, 200]),
    ];
    const longest = { 4: 16, 6: 30, 8: 50, 9: 70, 10: 75 };
    for (const p of puzzles) {
      const rec = record(p);
      const code = encodeShare(rec);
      ok(code && code.length <= longest[p.n], `n=${p.n}: short (${code?.length})`);
      eq(versionOf(code), 6, 'its own version');
      const back = decodeShare(code);
      ok(back && back.variant === PENTAGON && back.kind === 'local', 'decodes as pentagon');
      eq([back.n, back.grade, back.timeS, back.levels], [p.n, null, 83.4, rec.levels]);
      eq([back.puzzle.kind, Array.from(back.puzzle.cp), Array.from(back.puzzle.walls)],
        [PENTAGON_KIND, Array.from(p.cp), Array.from(p.walls)]);
      eq(serializeSurface(back.puzzle), serializeSurface(p), 'the same puzzle text');
      eq(encodeShare(back), code, 'one puzzle, one code');
      if (p.path) eq(solveSurface(back.puzzle, { limit: 2, nodeCap: 0 }).count, 1, 'unique');
      const typo = code.slice(0, 7) + (code[7] === 'A' ? 'B' : 'A') + code.slice(8);
      eq(decodeShare(typo), null, 'mistyped');
      eq(decodeShare(code.slice(0, -1)), null, 'truncated');
      eq(decodeShare(`${code}A`), null, 'too long');
    }
    const full = record(puzzles[3]);
    const bare = encodeShare({ ...full, levels: [] });
    ok(bare.length < encodeShare(full).length, 'no strip, shorter');
    eq(decodeShare(bare).levels, []);
  });

  t('pentagon-share: the format is frozen, other versions are not disturbed', () => {
    const p = made(4, [0, 7, 15], [1, 5]);
    const code = encodeShare(makeShareRecord({
      n: 4, timeS: 12.3, legs: [], K: 3, variant: PENTAGON, puzzle: p,
    }));
    eq(code, 'xgAY4HiSGI', 'do not edit this code: the format must not change');
    eq(decodeShare(code).puzzle.cp.indexOf(3), 15);
    const flat = runSync(generate(5, 1));
    const standard = encodeShare(makeShareRecord({
      n: 5, grade: 2, timeS: 10, legs: [], K: flatMax(flat), puzzle: flat,
    }));
    eq(versionOf(standard), SHARE_VERSION_PUZZLE, 'a standard puzzle keeps version 3');
    eq(decodeShare(standard).variant, null);
    const low = ALPHABET.indexOf(code[0]) & 7; // the 3 bits after the version
    const other = ALPHABET[low | (SHARE_VERSION_PUZZLE << 3)] + code.slice(1);
    eq(decodeShare(other), null, 'a Pentagon code under another version is not a code');
  });

  t('pentagon-share: records that cannot be a code give null', () => {
    const p = made(6, [0, 20, 35], [2, 9]);
    ok(encodeShare(record(p)) !== null, 'the control record is fine');
    const bad = (what, rec) => eq(encodeShare(rec), null, what);
    bad('n of the record is not the board', record(p, { n: 4 }));
    bad('a grade', { ...record(p), grade: 3 });
    bad('no time', { ...record(p), timeS: 0 });
    bad('levels of the wrong length', { ...record(p), levels: [0, 1, 2] });
    bad('one number only', record(made(6, [0], [])));
    const gap = Uint16Array.from(p.cp, v => (v === 3 ? 4 : v));
    bad('a gap in the numbers', record({ ...p, cp: gap }));
    const two = Uint8Array.from(p.walls, (v, i) => (i === 2 ? 2 : v));
    bad('a wall that is not 0 or 1', record({ ...p, walls: two }));
    bad('too many walls', record({ ...p, walls: new Uint8Array(p.walls.length + 1) }));
    bad('not a Pentagon puzzle', record({ n: 6, cp: p.cp, walls: p.walls }));
    const flagged = record(p);
    bad('another variant flag', { ...flagged, puzzle: { ...flagged.puzzle, wrap: true } });
    bad('a size that is not offered', record({ ...p, n: 5 }));
  });

  t('pentagon-share: the record holds a copy of the puzzle; the receiver plays the sizes the '
    + 'registry offers', () => {
    const p = made(6, [0, 20, 35], [2, 9]);
    const rec = record(p);
    p.cp[0] = 0;
    p.walls[2] = 0;
    eq([rec.puzzle.cp[0], rec.puzzle.walls[2], rec.puzzle.kind], [1, 1, PENTAGON_KIND]);
    const sizesOf = variant => (variant === PENTAGON ? PENTAGON_SIZES : []);
    const small = { ...rec, n: 4 };
    eq(shareStatus(small, { sizes: [5, 6, 7], sizesOf }).status, 'ok', 'size 4: a Pentagon size');
    eq(shareStatus(small, { sizes: [5, 6, 7] }).status, 'invalid', 'without the registry');
  });

  if (slow) {
    t('pentagon-gen: a 100-cell puzzle has exactly one solution', () => {
      const p = game(10, 1);
      eq(solveSurface(p, { limit: 2, nodeCap: 0 }).count, 1);
      ok(isSolved(p, p.path));
    });
  }
}
