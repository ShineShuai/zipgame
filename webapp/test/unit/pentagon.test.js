// Tests of the Pentagon puzzle: the boards (core/pentagon.js, the open-border support of
// core/surface/topology.js, solve.js and gen.js), the generator (core/gen/pentagon.js) and the
// variant in the play app: the registry entry and texts, the icon, the board
// (apps/play/pentagon-board.js), walking and hints on it, the share text, and the links made
// earlier (they must read as they did). The page itself (apps/play/main.js) is not run here.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import { hashStr, makeRng } from '../../src/core/rng.js';
import { runSync } from '../../src/core/run.js';
import { surfaceTopology, SLOTS } from '../../src/core/surface/topology.js';
import {
  pentagonMesh,
  PENTAGON_KIND,
  PENTAGON_SIZES,
  PENTAGON_CELLS,
  PENTAGON_BOARD_SIZES,
  isPentagon,
  shapeHint,
} from '../../src/core/pentagon.js';
import {
  makeSurfacePuzzle,
  validateSurface,
  isSolved,
  serializeSurface,
  parseSurface,
  maxNumber,
  wallCount,
  step as surfaceStep,
  isSolved as surfaceSolved,
} from '../../src/core/surface/puzzle.js';
import { solveSurface, countHamiltonianPaths } from '../../src/core/surface/solve.js';
import {
  generatePentagon,
  pentagonK,
  pentagonDefaultK,
  PENTAGON_CANDIDATES,
} from '../../src/core/gen/pentagon.js';
import { oracle, topologyMoves } from '../oracle.js';
import { pickK, kRange } from '../../src/core/gen/pick-k.js';
import { generate, PLAY_SIZES } from '../../src/core/gen/generate.js';
import { maxNumber as flatMax, makePuzzle } from '../../src/core/model.js';
import {
  encodeShare,
  decodeShare,
  SHARE_VERSION_PENTAGON,
  PENTAGON,
  SHARE_VERSION_PUZZLE,
} from '../../src/core/share-code.js';
import {
  makeShareRecord,
  shareStatus,
  shareText,
  isPlayable,
  sizeArg,
} from '../../src/features/share.js';
import {
  buildFlat,
  cellAt,
  pickSide,
  routePieces,
  routeCrossings,
} from '../../src/view/surface-net.js';
import { surfaceSvg, netFrame } from '../../src/apps/design/surface-board.js';
import { keptK } from '../../src/apps/design/k-field.js';
import { playGradesFor } from '../../src/core/grades.js';
import {
  surfaceTrapMetrics,
  surfaceTrapProfile,
  surfaceSolutionPath,
  GRAPH_TRAP_MODEL,
} from '../../src/core/surface/trap.js';
import { TRAP_CFG, trapGradeOf, SIZE_GRADE_CAP } from '../../src/core/trap.js';
import { COLORS } from '../../src/apps/play/board.js';
import { sanitize, serialize as serializeShared } from '../../src/features/shared-games.js';
import { maxHints, computeHint, solutionOf } from '../../src/features/hints.js';
import {
  PLAY_VARIANTS,
  variantById,
  variantOf,
  sizesFor,
  luckyDefs,
} from '../../src/apps/play/variants.js';
import { variantIcon } from '../../src/apps/play/icons.js';
import {
  pentagonBoardSvg,
  pentagonCellAt,
  pentagonCentres,
  pentagonPoint,
  pentagonRouteD,
  pentagonView,
  pentagonAcross,
} from '../../src/apps/play/pentagon-board.js';
import { EN, ZH, t as translate, setLang } from '../../src/ui/i18n.js';
import { made } from '../fixtures/made.js';

// ---- the boards and the generator

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
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: PENTAGON,
    puzzle: p,
    ...extra,
  });
// A puzzle that is only well formed (not necessarily unique): the numbers 1, 2, ... on `cells`,
// walls on `edges`.
const withCells = (n, cells, edges) => {
  const p = makeSurfacePuzzle(PENTAGON_KIND, n);
  cells.forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  edges.forEach(edge => {
    p.walls[edge] = 1;
  });
  return p;
};
const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
const generated = (n, seed, o) => runSync(generatePentagon(n, seed, o));

// Every Hamiltonian path that obeys the rules, by plain search with no pruning at all
// (test/oracle.js).
function brute(p) {
  const top = board(p.n);
  return oracle(p, {
    moves: topologyMoves(p, top, SLOTS),
    total: top.T,
    keep: false,
  }).count;
}

// The numbering of every board is frozen: puzzles and share codes refer to cell numbers. If this
// fails the board changed: do not edit the hashes, fix the board.
const FROZEN = {
  4: ['8ac141ce', '09197270'],
  5: ['6f6ec879', '9e27987c'],
  6: ['6d7409df', '8e6a7967'],
  7: ['664faff8', '5ec24b86'],
  8: ['9d03dd2f', 'af390c97'],
  9: ['9337a669', 'c9dfbb98'],
  10: ['a95f48ab', '5d1dc5f4'],
  11: ['e538a4a4', '7dd55cbc'],
};

test(
  'pentagon: boards — 16 to 120 cells of 5 sides, connected, not bipartite, no cell with fewer' +
    ' than 2 neighbours; the boards of the play app have only the 4 corner cells with 2',
  FAST,
  () => {
    assert.deepStrictEqual(
      PENTAGON_BOARD_SIZES.map(n => PENTAGON_CELLS[n]),
      [16, 24, 36, 48, 64, 80, 100, 120],
    );
    for (const n of PENTAGON_BOARD_SIZES) {
      const cells = PENTAGON_CELLS[n];
      assert.deepStrictEqual(
        Math.round(Math.sqrt(cells)),
        n,
        `n=${n}: the side of about ${cells} cells`,
      );
    }
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      assert.deepStrictEqual(top.T, PENTAGON_CELLS[n], `n=${n} cells`);
      assert.ok(top.flat && top.centres.length === 2 * top.T, 'flat, with centres');
      let pairs = 0;
      const histogram = {};
      for (let c = 0; c < top.T; c++) {
        assert.deepStrictEqual(top.deg[c], 5, 'every cell has 5 sides');
        const count = neighboursOf(top, c).length;
        histogram[count] = (histogram[count] || 0) + 1;
        pairs += count;
      }
      assert.deepStrictEqual(top.E, pairs / 2, `n=${n} edges`);
      assert.ok(!histogram[0] && !histogram[1], `n=${n} no cell with fewer than 2 neighbours`);
      const twos = { 5: 8, 7: 12, 9: 16, 11: 20 }[n] ?? 4;
      assert.deepStrictEqual(histogram[2], twos, `n=${n} cells with 2 neighbours`);
      const hint = shapeHint(top);
      assert.deepStrictEqual(
        [hint.twoNeighbour, hint.fixed, hint.path],
        [twos, 2 * twos, top.T - 1],
        `n=${n} shape hint`,
      );
      assert.ok(top.bipartite === false && top.classes === null, 'three cells meet at a corner');
      for (let c = 0; c < top.T; c++)
        assert.ok(top.dist[c * top.T + (top.T - 1)] < 255, 'connected');
    }
  },
);

test(
  'pentagon: sides on the border have no neighbour and no edge; the others are matched both ' +
    'ways',
  FAST,
  () => {
    const top = board(6);
    for (let c = 0; c < top.T; c++) {
      for (let k = 0; k < 5; k++) {
        const other = top.nb[c * SLOTS + k];
        const edge = top.edgeAt[c * SLOTS + k];
        if (other < 0) {
          assert.deepStrictEqual(edge, -1, 'no edge on the border');
          continue;
        }
        assert.ok(
          edge >= 0 && top.nb[other * SLOTS + top.rev[c * SLOTS + k]] === c,
          'matched back',
        );
        assert.deepStrictEqual(
          top.edgeAt[other * SLOTS + top.rev[c * SLOTS + k]],
          edge,
          'one edge for both sides',
        );
      }
    }
  },
);

test(
  'pentagon: every cell is the same pentagon — 4 sides of 0.789 and one of 0.577 (slot 0), ' +
    'angles 90, 90, 120, 120, 120',
  FAST,
  () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const point = corner => [top.verts[corner * 3], top.verts[corner * 3 + 1]];
      for (let c = 0; c < top.T; c++) {
        const ring = [0, 1, 2, 3, 4].map(k => point(top.ring[c * SLOTS + k]));
        const sides = ring.map((a, k) => {
          const b = ring[(k + 1) % 5];
          return Math.hypot(a[0] - b[0], a[1] - b[1]);
        });
        assert.ok(
          Math.abs(sides[0] - 0.5774) < 1e-3,
          `n=${n} cell ${c}: slot 0 is the short side`,
        );
        for (let k = 1; k < 5; k++) {
          assert.ok(Math.abs(sides[k] - 0.7887) < 1e-3, `side ${k} is long`);
        }
        const angles = ring
          .map((b, k) => {
            const a = ring[(k + 4) % 5];
            const d = ring[(k + 1) % 5];
            const u = [a[0] - b[0], a[1] - b[1]];
            const w = [d[0] - b[0], d[1] - b[1]];
            const cos = (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w));
            return Math.round((Math.acos(cos) * 180) / Math.PI);
          })
          .sort((x, y) => x - y);
        assert.deepStrictEqual(angles, [90, 90, 120, 120, 120], `n=${n} cell ${c}`);
      }
    }
  },
);

test(
  'pentagon: every board is symmetric — a quarter turn about the centre maps the cells onto ' +
    'the cells and keeps who touches whom',
  FAST,
  () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const at = (x, y) => {
        for (let c = 0; c < top.T; c++) {
          const near = Math.abs(top.centres[2 * c] - x) < 1e-6;
          if (near && Math.abs(top.centres[2 * c + 1] - y) < 1e-6) return c;
        }
        return -1;
      };
      const turned = Array.from({ length: top.T }, (_, c) => {
        const [x, y] = [top.centres[2 * c], top.centres[2 * c + 1]];
        return at(-y, x);
      });
      assert.ok(
        turned.every(c => c >= 0) && new Set(turned).size === top.T,
        `n=${n}: a bijection`,
      );
      for (let c = 0; c < top.T; c++) {
        const image = neighboursOf(top, turned[c]).sort((a, b) => a - b);
        const mapped = neighboursOf(top, c)
          .map(o => turned[o])
          .sort((a, b) => a - b);
        assert.deepStrictEqual(mapped, image, `n=${n} cell ${c}`);
      }
    }
  },
);

test(
  'pentagon: the numbering is frozen — reading order of the centres, and a fixed neighbour and ' +
    'corner table per size',
  FAST,
  () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const hashes = [top.nb, top.ring].map(table => hashStr(Array.from(table).join(',')));
      assert.deepStrictEqual(hashes, FROZEN[n], `n=${n}`);
      // rows: y never goes back by more than rounding, and rows are far apart
      const ys = Array.from({ length: top.T }, (_, c) => top.centres[2 * c + 1]);
      for (let c = 1; c < top.T; c++) {
        const gap = ys[c] - ys[c - 1];
        assert.ok(
          Math.abs(gap) < 1e-9 || gap > 0.25,
          `n=${n} cell ${c}: same row or a new row below`,
        );
        if (Math.abs(gap) < 1e-9) {
          assert.ok(top.centres[2 * c] > top.centres[2 * c - 2], 'left to right');
        }
      }
    }
    const again = pentagonMesh(6);
    assert.deepStrictEqual(again.cells, pentagonMesh(6).cells, 'the same mesh every time');
    assert.ok(threw(() => pentagonMesh(3)) && threw(() => board(12)), 'only the boards 4 to 11');
  },
);

test(
  'pentagon: the solver counts the Hamiltonian paths of the 16-cell board like a plain search',
  FAST,
  () => {
    const top = board(4);
    const result = countHamiltonianPaths(top);
    assert.ok(!result.capped && result.count > 0);
    let plain = 0;
    const vis = new Uint8Array(top.T);
    const go = (cell, depth) => {
      vis[cell] = 1;
      if (depth === top.T) plain++;
      else for (const other of neighboursOf(top, cell)) if (!vis[other]) go(other, depth + 1);
      vis[cell] = 0;
    };
    for (let c = 0; c < top.T; c++) go(c, 1);
    assert.deepStrictEqual(result.count, plain);
  },
);

test(
  'pentagon: text format — surface pentagon n, round trip, bad sizes and edges refused',
  FAST,
  () => {
    const p = generated(6, 5);
    const text = serializeSurface(p, { path: p.path });
    assert.ok(text.startsWith('surface pentagon 6\n'));
    const back = parseSurface(text);
    assert.deepStrictEqual(
      [back.kind, back.n, Array.from(back.cp), Array.from(back.walls)],
      [PENTAGON_KIND, 6, Array.from(p.cp), Array.from(p.walls)],
    );
    assert.deepStrictEqual(back.path, p.path);
    assert.ok(validateSurface(back).ok);
    assert.ok(
      threw(() => parseSurface('surface pentagon 12\n')),
      'size 12 does not exist',
    );
    const past = `surface pentagon 4\nwalls ${board(4).E}\n`;
    assert.ok(
      threw(() => parseSurface(past)),
      'edge past the last',
    );
    assert.deepStrictEqual(wallCount(makeSurfacePuzzle(PENTAGON_KIND, 4)), 0);
  },
);

test(
  'pentagon-gen: the number of checkpoints follows the rule of the square boards — pickK on ' +
    'the range from the square root to a quarter of the cells',
  FAST,
  () => {
    assert.deepStrictEqual(
      [16, 36, 64, 100].map(cells => kRange(cells)),
      [
        [4, 5],
        [6, 9],
        [8, 16],
        [10, 25],
      ],
    );
    for (const n of PENTAGON_BOARD_SIZES) {
      const [min, max] = kRange(PENTAGON_CELLS[n]);
      const seen = [];
      for (let seed = 1; seed <= 600; seed++) {
        const K = pentagonK(n, makeRng(seed));
        assert.deepStrictEqual(K, pickK(min, max, makeRng(seed)), 'the same draw as pickK');
        assert.ok(K >= min && K <= max, `n=${n}: K=${K} in ${min}..${max}`);
        seen.push(K);
      }
      const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
      if (max - min >= 8) {
        assert.ok(
          Math.abs(mean - (min + 0.3 * (max - min))) < 0.4,
          `n=${n}: mean ${mean.toFixed(2)}`,
        );
      }
      assert.ok(seen.some(K => K !== seen[0]) || max - min < 2, `n=${n}: K varies`);
      assert.ok(PENTAGON_CANDIDATES[n] >= 1);
    }
  },
);

test(
  'pentagon-gen: puzzles of 16, 36 and 64 cells have exactly one solution (checked against a ' +
    'plain search on 16), the path solves them, the same seed gives the same puzzle',
  SLOW,
  () => {
    for (const [n, seeds] of [
      [4, [1, 2, 3, 4]],
      [6, [1, 2, 3]],
      [8, [1]],
    ]) {
      for (const seed of seeds) {
        const p = generated(n, seed);
        assert.deepStrictEqual([p.kind, p.n], [PENTAGON_KIND, n]);
        assert.ok(validateSurface(p).ok, `n=${n} seed=${seed}: valid`);
        assert.ok(isSolved(p, p.path), 'the stored path solves it');
        const solved = solveSurface(p, { limit: 2, nodeCap: 0 });
        assert.deepStrictEqual(solved.count, 1, `n=${n} seed=${seed}: unique`);
        assert.deepStrictEqual(solved.path, p.path, 'and it is the stored path');
        if (n === 4)
          assert.deepStrictEqual(brute(p), 1, `n=${n} seed=${seed}: unique by plain search`);
        const again = generated(n, seed);
        assert.deepStrictEqual(
          [Array.from(again.cp), Array.from(again.walls), again.path],
          [Array.from(p.cp), Array.from(p.walls), p.path],
          'same seed, same puzzle',
        );
        assert.deepStrictEqual(p.seed, seed);
      }
    }
    const other = [1, 2].map(seed => Array.from(generated(6, seed).cp).join());
    assert.ok(other[0] !== other[1], 'other seed, other puzzle');
  },
);

test(
  'pentagon-gen: progress events — frac rises to 1, K is reported, o.K and o.candidates are ' +
    'obeyed, other sizes are refused',
  FAST,
  () => {
    const events = [];
    const p = runSync(generatePentagon(6, 7, { K: 9, candidates: 2 }), e => events.push(e));
    assert.deepStrictEqual(maxNumber(p), 9);
    assert.ok(events.length > 10);
    assert.ok(events.every(e => e.K === 9 && e.frac >= 0 && e.frac <= 1));
    assert.ok(
      events.every((e, i) => i === 0 || e.frac >= events[i - 1].frac - 1e-12),
      'rises',
    );
    assert.deepStrictEqual(events[events.length - 1].frac, 1);
    assert.deepStrictEqual(
      events[events.length - 1].walls,
      wallCount(p),
      'the last event has the wall count',
    );
    assert.ok(threw(() => generated(3, 1)) && threw(() => generated(12, 1)));
  },
);

test(
  'pentagon-design: the flat layout — corners counter-clockwise, y up, every side with a ' +
    'neighbour glued and shared by both cells, a point finds its cell and its side',
  FAST,
  () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const top = board(n);
      const net = buildFlat(top);
      assert.ok(buildFlat(top) === net, 'built once');
      assert.deepStrictEqual(
        [net.polys.length, net.centers.length, net.tags.length, net.cuts.length],
        [top.T, top.T, 0, 0],
      );
      assert.ok(net.uniform === true && net.glued.every(v => v === 1), 'one tint, no cuts');
      assert.ok(Math.abs(net.side - 0.7466) < 1e-3, `side ${net.side}`);
      const area = poly =>
        poly.reduce((sum, [x, y], i) => {
          const [nx, ny] = poly[(i + 1) % poly.length];
          return sum + (x * ny - nx * y) / 2;
        }, 0);
      const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
      for (let c = 0; c < top.T; c++) {
        assert.ok(area(net.polys[c]) > 0.5, `n=${n} cell ${c}: counter-clockwise, y up`);
        assert.deepStrictEqual(
          cellAt(net, ...net.centers[c]),
          c,
          `n=${n}: the centre of ${c} is in ${c}`,
        );
        for (let k = 0; k < 5; k++) {
          const o = top.nb[c * SLOTS + k];
          const [a, b] = [net.polys[c][k], net.polys[c][(k + 1) % 5]];
          const mid = [0, 1].map(axis => (a[axis] + b[axis]) / 2);
          const toward = [0, 1].map(axis => mid[axis] + (net.centers[c][axis] - mid[axis]) * 0.2);
          assert.deepStrictEqual(
            pickSide(net, c, ...toward),
            k,
            `n=${n} cell ${c}: a point near side ${k}`,
          );
          if (o < 0) continue;
          const back = top.rev[c * SLOTS + k];
          const shared = same(a, net.polys[o][(back + 1) % 5]) && same(b, net.polys[o][back]);
          assert.ok(shared, `n=${n}: ${c}-${o} share a side`);
        }
      }
      const total = net.polys.reduce((sum, poly) => sum + area(poly), 0);
      assert.ok(
        Math.abs(total - top.T * area(net.polys[0])) < 1e-6,
        `n=${n}: the cells are one size`,
      );
    }
  },
);

test('pentagon-design: a route is a line through the centres, nothing crosses a cut', FAST, () => {
  const p = generated(6, 4);
  const net = buildFlat(board(6));
  const pieces = routePieces(net, p.path);
  assert.deepStrictEqual(pieces.length, 1, 'one piece');
  assert.deepStrictEqual(
    pieces[0],
    p.path.map(c => net.centers[c]),
    'through the centres in order',
  );
  assert.deepStrictEqual(routeCrossings(net, p.path), [], 'no crossings');
});

test(
  'pentagon-design: the picture — a polygon per cell, a line per wall, a border line per side ' +
    'on the border, a badge per number, the path and the head in play',
  FAST,
  () => {
    const count = (markup, text) => markup.split(text).length - 1;
    for (const n of [4, 6, 8]) {
      const top = board(n);
      const p = generated(n, 2);
      const net = buildFlat(top);
      const state = {
        P: p,
        selected: -1,
        buffer: '',
        playing: false,
        path: [],
        template: null,
        solutions: [],
        visible: [],
      };
      const { markup, frame } = surfaceSvg(net, state);
      assert.deepStrictEqual(count(markup, 'class="sf-cell'), top.T, `n=${n} cells`);
      assert.deepStrictEqual(count(markup, 'class="sf-wall"'), wallCount(p), 'walls');
      let border = 0;
      for (let i = 0; i < top.T * SLOTS; i++) if (i % SLOTS < 5 && top.nb[i] < 0) border++;
      assert.deepStrictEqual(count(markup, 'class="sf-border"'), border, 'border sides');
      assert.deepStrictEqual(
        [count(markup, 'class="sf-cut"'), count(markup, 'class="sf-tag"')],
        [0, 0],
        'no cuts',
      );
      assert.deepStrictEqual(count(markup, 'class="sf-badge'), maxNumber(p), 'badges');
      assert.ok(markup.startsWith('<svg') && frame.width > 100 && frame.height > 100, 'a picture');
      const centre = net.centers[3];
      const back = frame.toNet(...frame.toPixels(centre));
      assert.ok(
        Math.abs(back[0] - centre[0]) < 0.02 && Math.abs(back[1] - centre[1]) < 0.02,
        'frame',
      );
      const walked = surfaceSvg(net, {
        ...state,
        playing: true,
        path: p.path.slice(0, 6),
      }).markup;
      const marks = ['sf-path', 'sf-head'].map(name => count(walked, `class="${name}"`));
      assert.deepStrictEqual(marks, [1, 1], 'path, head');
      const solved = surfaceSvg(net, { ...state, solutions: [p.path], visible: [true] }).markup;
      assert.deepStrictEqual(count(solved, 'class="sf-path"'), 1, 'a solution');
    }
    assert.deepStrictEqual(
      netFrame(buildFlat(board(10))).scale <= 60 / 0.7,
      true,
      'a 100-cell board fits the page',
    );
  },
);

test(
  'pentagon-design: the Checkpoints field keeps a typed number, cut to the board; else it ' +
    'follows the size',
  FAST,
  () => {
    const cells = 36;
    assert.deepStrictEqual(
      keptK({ typed: true, value: '20', cells, fallback: 14 }),
      '20',
      'typed: stays',
    );
    assert.deepStrictEqual(
      keptK({ typed: true, value: '20', cells: 16, fallback: 6 }),
      '16',
      'cut to a small board',
    );
    assert.deepStrictEqual(
      keptK({ typed: false, value: '20', cells, fallback: 14 }),
      '14',
      'not typed: the default',
    );
    assert.deepStrictEqual(
      keptK({ typed: true, value: '', cells, fallback: 14 }),
      '14',
      'emptied: the default',
    );
    assert.deepStrictEqual(
      keptK({ typed: true, value: 'x', cells, fallback: 14 }),
      '14',
      'not a number: the default',
    );
    assert.deepStrictEqual(
      keptK({ typed: true, value: '3', cells, fallback: 14 }),
      '3',
      'a small number stays',
    );
  },
);

test(
  'pentagon-grade: a forced start — the solution keeps its path, a wrong turn has no solution, ' +
    'only the steps below the last forced cell are counted',
  SLOW,
  () => {
    for (const [n, seed] of [
      [4, 2],
      [6, 3],
      [8, 1],
    ]) {
      const p = generated(n, seed);
      const top = board(n);
      const full = solveSurface(p, { limit: 2, forced: p.path });
      assert.deepStrictEqual(
        [full.count, full.path, full.nodes],
        [1, p.path, 1],
        `n=${n}: the whole path forced`,
      );
      const start = solveSurface(p, { limit: 2, forced: p.path.slice(0, 5) });
      assert.deepStrictEqual(
        [start.count, start.path],
        [1, p.path],
        `n=${n}: a start of the path`,
      );
      assert.ok(
        start.nodes < solveSurface(p, { limit: 2 }).nodes + 1,
        'fewer steps than from the start',
      );
      for (let i = 0; i < Math.min(8, p.path.length - 1); i++) {
        for (let k = 0; k < SLOTS; k++) {
          const cell = top.nb[p.path[i] * SLOTS + k];
          if (cell < 0 || p.path.slice(0, i + 1).includes(cell) || cell === p.path[i + 1])
            continue;
          const wrong = solveSurface(p, { limit: 1, forced: [...p.path.slice(0, i + 1), cell] });
          assert.deepStrictEqual(
            wrong.count,
            0,
            `n=${n}: a wrong turn at step ${i} has no solution`,
          );
        }
      }
    }
  },
);

test(
  'pentagon-grade: the wrong turns along the solution — each a neighbour over a side without a ' +
    "wall, none the solution's own next cell, none visited; every one dead (checked by plain " +
    'search on 16 cells)',
  SLOW,
  () => {
    for (const [n, seed] of [
      [4, 2],
      [4, 5],
      [6, 3],
      [8, 1],
    ]) {
      const p = generated(n, seed);
      const top = board(n);
      const profile = surfaceTrapProfile(p, p.path);
      assert.ok(
        profile.length > 0 && !profile.nonUnique,
        `n=${n}: some wrong turns, a unique puzzle`,
      );
      for (const { i, cell, sub, capped } of profile) {
        assert.ok(
          !p.path.slice(0, i + 1).includes(cell) && cell !== p.path[i + 1],
          'a real wrong turn',
        );
        const slot = [...Array(SLOTS).keys()].find(k => top.nb[p.path[i] * SLOTS + k] === cell);
        const side = top.edgeAt[p.path[i] * SLOTS + slot];
        assert.ok(slot !== undefined && !p.walls[side], 'next to it, no wall');
        assert.ok(sub >= 0 && typeof capped === 'boolean');
      }
      if (n === 4) {
        for (const { i, cell } of profile) {
          const prefix = [...p.path.slice(0, i + 1), cell];
          const seen = new Uint8Array(top.T);
          prefix.forEach(c => {
            seen[c] = 1;
          });
          let completions = 0;
          const go = (head, depth, next) => {
            if (depth === top.T) {
              if (p.cp[head] === maxNumber(p)) completions++;
              return;
            }
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
          prefix.slice(1).forEach(c => {
            if (p.cp[c]) next = p.cp[c] + 1;
          });
          const okPrefix = prefix.every((c, j) => j === 0 || !p.cp[c] || p.cp[c] <= next - 1);
          if (okPrefix) go(cell, prefix.length, next);
          assert.deepStrictEqual(
            completions,
            0,
            `n=${n}: the wrong turn at step ${i} cannot be finished`,
          );
        }
      }
    }
  },
);

test(
  'pentagon-grade: the grade — 0 to 5 by the reduced trap model, capped by the size of a ' +
    'square board with as many cells, the same for a received puzzle (no stored solution), ' +
    'rising with the board',
  SLOW,
  () => {
    const meanPredicted = n => {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) {
        sum += surfaceTrapMetrics(generated(n, 100 + seed)).predicted;
      }
      return sum / 6;
    };
    for (const [n, cap] of [
      [4, 5],
      [5, SIZE_GRADE_CAP[5]],
      [6, SIZE_GRADE_CAP[6]],
      [8, 5],
    ]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = generated(n, seed);
        const m = surfaceTrapMetrics(p);
        assert.ok(m.ok && m.grade >= 0 && m.grade <= cap, `n=${n}: grade ${m.grade} <= ${cap}`);
        const cut = Math.min(trapGradeOf(m.predicted, GRAPH_TRAP_MODEL), cap);
        assert.deepStrictEqual(m.grade, cut, 'the model and the cap');
        assert.ok(m.T === PENTAGON_CELLS[n] && m.altFrac > 0, 'the fields of the display');
        const total = m.steps.reduce((sum, x) => sum + x.score, 0);
        assert.ok(
          Math.abs(m.trapSum * m.T - total) < 1e-9,
          'trapSum: all steps per cell, like core',
        );
        assert.deepStrictEqual(m.ladTrials, 0, 'no ladder');
        const graded = playGradesFor(p);
        assert.deepStrictEqual(
          [graded.trap.grade, graded.legacy],
          [m.grade, null],
          'playGradesFor',
        );
        if (PENTAGON_SIZES.includes(n)) {
          const received = decodeShare(
            encodeShare(
              makeShareRecord({
                n,
                timeS: 5,
                legs: [],
                K: maxNumber(p),
                variant: PENTAGON,
                puzzle: p,
              }),
            ),
          ).puzzle;
          assert.deepStrictEqual(
            playGradesFor(received).trap.grade,
            m.grade,
            `n=${n}: the same grade when received`,
          );
        }
      }
    }
    assert.ok(
      meanPredicted(4) < meanPredicted(6) && meanPredicted(6) < meanPredicted(8),
      'a bigger board grades higher on average',
    );
    assert.deepStrictEqual(surfaceSolutionPath(generated(6, 3)).length, 36);
    assert.ok(TRAP_CFG.cap > 0);
  },
);

test(
  'pentagon-design: Generate of the design app — the default K is the mean of the rule of ' +
    'the square boards',
  FAST,
  () => {
    for (const n of PENTAGON_BOARD_SIZES) {
      const [min, max] = kRange(PENTAGON_CELLS[n]);
      assert.deepStrictEqual(pentagonDefaultK(n), Math.round(min + 0.3 * (max - min)), `n=${n}`);
    }
    assert.deepStrictEqual(
      [4, 6, 8, 10].map(n => pentagonDefaultK(n)),
      [4, 7, 10, 15],
    );
  },
);

test(
  'pentagon: isPentagon tells a Pentagon puzzle from a 3D one and from a grid one',
  FAST,
  () => {
    assert.ok(isPentagon(makeSurfacePuzzle(PENTAGON_KIND, 4)), 'a Pentagon puzzle');
    assert.ok(!isPentagon(makeSurfacePuzzle('tetra', 2)), 'a tetra puzzle has a surface too');
    assert.ok(!isPentagon(makePuzzle(5)), 'a grid puzzle');
    assert.ok(!isPentagon(null) && !isPentagon(undefined), 'no puzzle');
  },
);

test('pick-k: kRange is the rule of the square boards on a board with n * n cells', FAST, () => {
  for (let n = 4; n <= 16; n++) {
    const min = Math.max(4, n);
    assert.deepStrictEqual(
      kRange(n * n),
      [min, Math.max(min + 1, Math.round((n * n) / 4))],
      `n=${n}`,
    );
  }
});

test('pentagon-share: a code of its own version (6), short, shorter without a strip', SLOW, () => {
  // compat pin: the version of the links already shared
  assert.deepStrictEqual(SHARE_VERSION_PENTAGON, 6);
  const puzzles = [
    ...[1, 2, 3].map(seed => generated(4, seed)),
    ...[1, 2, 3].map(seed => generated(6, seed)),
    generated(8, 1),
    withCells(10, [0, 37, 12, 99, 55, 70], [3, 4, 100, 219]),
  ];
  const longest = { 4: 16, 6: 30, 8: 50, 10: 75 };
  for (const p of puzzles) {
    const code = encodeShare(record(p));
    assert.ok(code && code.length <= longest[p.n], `n=${p.n}: short (${code?.length})`);
    assert.deepStrictEqual(versionOf(code), 6, 'its own version');
    const back = decodeShare(code).puzzle;
    assert.deepStrictEqual(serializeSurface(back), serializeSurface(p), 'the same puzzle text');
    if (p.path)
      assert.deepStrictEqual(solveSurface(back, { limit: 2, nodeCap: 0 }).count, 1, 'unique');
  }
  const full = record(puzzles[3]);
  const bare = encodeShare({ ...full, levels: [] });
  assert.ok(bare.length < encodeShare(full).length, 'no strip, shorter');
  assert.deepStrictEqual(decodeShare(bare).levels, []);
});

test('pentagon-share: the format is frozen, other versions are not disturbed', FAST, () => {
  const p = withCells(4, [0, 7, 15], [1, 5]);
  const code = encodeShare(
    makeShareRecord({
      n: 4,
      timeS: 12.3,
      legs: [],
      K: 3,
      variant: PENTAGON,
      puzzle: p,
    }),
  );
  assert.deepStrictEqual(code, 'xgAY4HiSGI', 'do not edit this code: the format must not change');
  assert.deepStrictEqual(decodeShare(code).puzzle.cp.indexOf(3), 15);
  const flat = runSync(generate(5, 1));
  const standard = encodeShare(
    makeShareRecord({
      n: 5,
      grade: 2,
      timeS: 10,
      legs: [],
      K: flatMax(flat),
      puzzle: flat,
    }),
  );
  assert.deepStrictEqual(
    versionOf(standard),
    SHARE_VERSION_PUZZLE,
    'a standard puzzle keeps version 3',
  );
  assert.deepStrictEqual(decodeShare(standard).variant, null);
  const low = ALPHABET.indexOf(code[0]) & 7; // the 3 bits after the version
  const other = ALPHABET[low | (SHARE_VERSION_PUZZLE << 3)] + code.slice(1);
  assert.deepStrictEqual(
    decodeShare(other),
    null,
    'a Pentagon code under another version is not a code',
  );
});

test('pentagon-share: records that cannot be a code give null', FAST, () => {
  const p = withCells(6, [0, 20, 35], [2, 9]);
  assert.ok(encodeShare(record(p)) !== null, 'the control record is fine');
  const bad = (what, rec) => assert.deepStrictEqual(encodeShare(rec), null, what);
  bad('n of the record is not the board', record(p, { n: 4 }));
  bad('a grade', { ...record(p), grade: 3 });
  bad('no time', { ...record(p), timeS: 0 });
  bad('levels of the wrong length', { ...record(p), levels: [0, 1, 2] });
  bad('one number only', record(withCells(6, [0], [])));
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

test(
  'pentagon-share: the record holds a copy of the puzzle; the receiver plays the sizes the ' +
    'registry offers',
  FAST,
  () => {
    const p = withCells(6, [0, 20, 35], [2, 9]);
    const rec = record(p);
    p.cp[0] = 0;
    p.walls[2] = 0;
    assert.deepStrictEqual(
      [rec.puzzle.cp[0], rec.puzzle.walls[2], rec.puzzle.kind],
      [1, 1, PENTAGON_KIND],
    );
    const sizesOf = variant => (variant === PENTAGON ? PENTAGON_SIZES : []);
    const small = { ...rec, n: 4 };
    assert.deepStrictEqual(
      shareStatus(small, { sizes: [5, 6, 7], sizesOf }).status,
      'ok',
      'size 4: a Pentagon size',
    );
    assert.deepStrictEqual(
      shareStatus(small, { sizes: [5, 6, 7] }).status,
      'invalid',
      'without the registry',
    );
  },
);

test('pentagon-gen: a 100-cell puzzle has exactly one solution', SLOW, () => {
  const p = generated(10, 1);
  assert.deepStrictEqual(solveSurface(p, { limit: 2, nodeCap: 0 }).count, 1);
  assert.ok(isSolved(p, p.path));
});

// ---- the variant in the play app

const game = (n, seed) => made('pentagon', n, seed);
const count = (text, part) => text.split(part).length - 1;
const state = (p, path = [], extra = {}) => ({
  puzzle: p,
  path,
  hintCell: null,
  hintWrongCell: null,
  ...extra,
});

// Links made earlier (n = 4, 6, 8, 10; made-up puzzles: numbers on the cells in order, walls on
// the edges). Never edit these codes: they are what a player may still
// hold, and they have to decode to the same puzzle.
const OLD_LINKS = [
  { code: 'xgAY4HiSGI', n: 4, cells: [0, 7, 15], edges: [1, 5] },
  { code: 'yuBryndeBGJ', n: 6, cells: [0, 20, 35], edges: [2, 9] },
  { code: 'xWABJ_1pO1Z-OK', n: 8, cells: [0, 31, 63, 12], edges: [3, 40] },
  { code: 'wgBDQGCPTQFQBuL', n: 10, cells: [0, 37, 99, 12], edges: [3, 4, 100] },
];

test(
  'play-pentagon: the registry entry — detect, sizes, lucky game, texts in both ' + 'languages',
  FAST,
  () => {
    const v = variantById(PENTAGON);
    assert.ok(v && PLAY_VARIANTS.includes(v), 'registered');
    assert.ok(v.detect(game(4, 1)), 'detects its puzzles');
    assert.ok(!v.detect(made('std', 5, 1)), 'and not a square one');
    assert.deepStrictEqual(variantOf(game(4, 1)), PENTAGON);
    for (const other of PLAY_VARIANTS.filter(x => x.id !== PENTAGON)) {
      assert.ok(!other.detect(game(4, 1)), `${other.id} does not claim it`);
    }
    assert.deepStrictEqual(
      sizesFor(PENTAGON, [5, 6, 7]),
      PENTAGON_SIZES,
      'its boards, whatever the grid sizes are',
    );
    assert.deepStrictEqual(sizesFor(PENTAGON, PLAY_SIZES), PENTAGON_SIZES);
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === PENTAGON);
    assert.deepStrictEqual(
      [lucky.locked, lucky.pool],
      [[6, 8], PENTAGON_SIZES],
      'a locked one draws 36 or 64 cells',
    );
    for (const dict of [EN, ZH]) {
      for (const key of Object.values(v.keys)) assert.ok(dict[key], `${key}`);
      assert.ok(dict['size.cells'], 'size.cells');
    }
    assert.ok(
      EN['mode.pentagonRules'].includes('pentagon') && EN['mode.pentagonRules'].includes('five'),
    );
  },
);

test('play-pentagon: the menu icon shows the pentagon board and its path', FAST, () => {
  const icon = variantIcon('pentagon');
  assert.ok(icon.startsWith('<svg') && icon.endsWith('</svg>') && icon.includes('vi-pentagon'));
  assert.deepStrictEqual(count(icon, '<polygon'), 16, 'the 16 cells of the smallest board');
  assert.ok(
    icon.includes('<polyline class="vi-path"') && count(icon, 'vi-dot') === 2,
    'path, two ends',
  );
  assert.ok(icon !== variantIcon('standard') && icon !== variantIcon('wrap'));
});

test(
  'play-pentagon: sizes are shown as cells; the share text says so in both languages',
  FAST,
  () => {
    assert.deepStrictEqual(
      PENTAGON_SIZES.map(n => sizeArg({ variant: PENTAGON, n })),
      [16, 36, 64, 100],
    );
    const squares = [
      { variant: null, n: 7 },
      { variant: 'wrap', n: 6 },
    ].map(sizeArg);
    assert.deepStrictEqual(squares, [7, 6], 'squares: n');
    const p = game(6, 3);
    const rec = makeShareRecord({
      n: 6,
      timeS: 41.2,
      legs: [],
      K: maxNumber(p),
      variant: PENTAGON,
      puzzle: p,
    });
    try {
      setLang('en');
      const text = shareText(rec, 'http://x/?s=abc', translate);
      assert.ok(text.startsWith('zigzag Pentagon · 36 cells\n⏱ 41.2s'), text);
      setLang('zh');
      assert.ok(
        shareText(rec, 'http://x/?s=abc', translate).startsWith('之折 五边形 · 36 格'),
        'zh',
      );
      assert.deepStrictEqual(translate('game.pentagonTitle', 36), '五边形 · 36 格');
      assert.deepStrictEqual(translate('size.cells', 36), '36 格');
    } finally {
      setLang('en');
    }
    const sizesOf = id => sizesFor(id, PLAY_SIZES);
    const status = shareStatus(rec, { sizes: PLAY_SIZES, sizesOf });
    assert.ok(isPlayable(status), 'a shared Pentagon game plays');
  },
);

test(
  'play-pentagon: the board markup — a polygon per cell, walls, border, badges, path, ' + 'hints',
  SLOW,
  () => {
    for (const n of [4, 6, 10]) {
      const p = game(n, 2);
      const top = surfaceTopology(PENTAGON_KIND, n);
      const markup = pentagonBoardSvg(state(p, p.path.slice(0, 6)));
      assert.deepStrictEqual(count(markup, '<polygon'), top.T, `n=${n}: cells`);
      assert.deepStrictEqual(count(markup, 'data-num-cell='), maxNumber(p), 'badges');
      let border = 0;
      for (let i = 0; i < top.T * SLOTS; i++) if (i % SLOTS < 5 && top.nb[i] < 0) border++;
      const walls = markup.match(/data-role="walls"[^>]*>([\s\S]*?)<\/g>/)[1];
      assert.deepStrictEqual(count(walls, '<line'), wallCount(p), 'one line per wall');
      const outline = markup.match(/data-role="outline"[^>]*>([\s\S]*?)<\/g>/)[1];
      assert.deepStrictEqual(count(outline, '<line'), border, 'border');
      assert.deepStrictEqual(
        count(markup.match(/data-role="path" d="([^"]*)"/)[1], 'L'),
        5,
        'the path of 6 cells',
      );
      assert.ok(
        markup.includes('class="zip-svg pentagon"') && markup.startsWith('<svg viewBox="'),
        'svg',
      );
      assert.ok(
        !markup.includes('data-role="hint"') && !markup.includes('data-role="hint-wrong"'),
      );
      const hinted = pentagonBoardSvg(
        state(p, [], { hintCell: p.path[0], hintWrongCell: p.path[3] }),
      );
      assert.ok(hinted.includes('data-role="hint"'), 'the ring');
      assert.ok(hinted.includes('data-role="hint-wrong"'), 'the cross');
      const filled = pentagonBoardSvg(state(p, [p.path[0]]));
      assert.ok(filled.includes(`fill="${COLORS.numberVisited}"`), 'a visited number is filled');
    }
  },
);

test(
  'play-pentagon: a point finds its cell — the centre, near each side, nothing outside; a ' +
    'pointer position maps into the view',
  FAST,
  () => {
    for (const n of PENTAGON_SIZES) {
      const p = makeSurfacePuzzle(PENTAGON_KIND, n);
      const centres = pentagonCentres(p);
      assert.deepStrictEqual(centres.length, PENTAGON_CELLS[n]);
      const view = pentagonView(p);
      assert.ok(view.w > 100 && view.h > 100, 'a view');
      centres.forEach(([x, y], cell) => {
        assert.deepStrictEqual(pentagonCellAt(p, x, y), cell, `n=${n} centre of ${cell}`);
      });
      assert.deepStrictEqual(pentagonCellAt(p, view.x - 50, view.y - 50), -1, 'outside');
      assert.deepStrictEqual(pentagonCellAt(p, view.x + view.w + 50, view.y + view.h + 50), -1);
      assert.ok(Math.abs(pentagonAcross(p) ** 2 - PENTAGON_CELLS[n]) < 1e-9);
      const rect = { left: 10, top: 20, width: 200, height: (200 * view.h) / view.w };
      const [x, y] = pentagonPoint(p, rect, 10 + 100, 20 + rect.height / 2);
      assert.ok(
        Math.abs(x - (view.x + view.w / 2)) < 1e-9 && Math.abs(y - (view.y + view.h / 2)) < 1e-9,
      );
    }
    const p = makeSurfacePuzzle(PENTAGON_KIND, 4);
    assert.deepStrictEqual(pentagonRouteD(p, [0, 1, 2]).match(/[ML]/g), ['M', 'L', 'L']);
    assert.deepStrictEqual(pentagonRouteD(p, []), '');
  },
);

test(
  'play-pentagon: walking — the solution is a run of pushes, one step back pops, a far ' +
    'cell is refused, the last push solves it',
  FAST,
  () => {
    const p = game(6, 4);
    const path = [];
    p.path.forEach((cell, i) => {
      assert.deepStrictEqual(surfaceStep(p, path, cell), 'push', `step ${i}`);
      assert.deepStrictEqual(
        surfaceSolved(p, path),
        i === p.path.length - 1,
        `solved after ${i + 1} cells`,
      );
    });
    assert.deepStrictEqual(surfaceStep(p, path, p.path[34]), 'pop', 'one step back');
    assert.deepStrictEqual(surfaceStep(p, path, p.path[35]), 'push');
    const walking = [];
    surfaceStep(p, walking, p.path[0]);
    assert.deepStrictEqual(
      surfaceStep(p, walking, p.path[20]),
      null,
      'a cell that is not next to the head',
    );
    assert.deepStrictEqual(surfaceStep(p, walking, p.path[0]), null, 'the head again');
    assert.deepStrictEqual(surfaceStep(p, [], p.path[1]), null, 'the first press has to be the 1');
  },
);

test(
  'play-pentagon: hints — the solution of a received puzzle is found, the hint says what is ' +
    'next and where the player went wrong',
  FAST,
  () => {
    const made = game(6, 5);
    const received = decodeShare(
      encodeShare(
        makeShareRecord({
          n: 6,
          timeS: 10,
          legs: [],
          K: maxNumber(made),
          variant: PENTAGON,
          puzzle: made,
        }),
      ),
    ).puzzle;
    assert.ok(!received.path, 'a link carries no solution');
    assert.deepStrictEqual(solutionOf(received), made.path, 'it is solved for the hint');
    assert.deepStrictEqual(computeHint(made.path, []), {
      correctCell: made.path[0],
      wrongCell: null,
    });
    const three = made.path.slice(0, 3);
    assert.deepStrictEqual(computeHint(made.path, three), {
      correctCell: made.path[3],
      wrongCell: null,
    });
    const wrong = [...made.path.slice(0, 3), made.path[10]];
    assert.deepStrictEqual(computeHint(made.path, wrong), {
      correctCell: made.path[3],
      wrongCell: made.path[10],
    });
    assert.ok(maxHints(made) >= 3 && maxHints(made) <= 6);
  },
);

test(
  'play-pentagon: links made earlier decode as they did, a stored shared game is read and ' +
    'written again in the current format, a damaged one or one of the dropped 96-cell board ' +
    'is dropped',
  FAST,
  () => {
    for (const { code, n, cells, edges } of OLD_LINKS) {
      const rec = decodeShare(code);
      assert.ok(rec && rec.variant === PENTAGON && rec.n === n, `${code} reads`);
      assert.deepStrictEqual(
        Array.from(rec.puzzle.cp)
          .flatMap((v, cell) => (v ? [[v, cell]] : []))
          .sort((a, b) => a[0] - b[0])
          .map(x => x[1]),
        cells,
        `${n}: numbers`,
      );
      const walls = Array.from(rec.puzzle.walls).flatMap((v, edge) => (v ? [edge] : []));
      assert.deepStrictEqual(walls, edges, `${n}: walls`);
      assert.deepStrictEqual(rec.timeS, 12.3);
      assert.deepStrictEqual(encodeShare(rec), code, `${n}: the same code again`);
    }
    // A link of the 96-cell board (size index 4, dropped): it does not open, and the index is not
    // another board (the 80-cell board has size 9 now, as the 96-cell one had).
    const code96 = 'w8BT1rkgGM';
    assert.deepStrictEqual(decodeShare(code96), null, 'the 96-cell board is gone');
    // the shared games of a device: codes, decoded on load, encoded on save
    const stored = {
      v: 1,
      items: [
        ...OLD_LINKS.map((link, i) => ({ c: link.code, a: 100 + i })),
        { c: code96, a: 200 },
        { c: `${OLD_LINKS[0].code}x`, a: 300 },
        { c: 'not a code', a: 400 },
      ],
    };
    const entries = sanitize(stored);
    assert.deepStrictEqual(
      entries.map(e => e.rec.n),
      [4, 6, 8, 10],
      'every good game, no damaged or dropped one',
    );
    assert.deepStrictEqual(
      JSON.parse(serializeShared(entries)).items.map(item => item.c),
      OLD_LINKS.map(link => link.code),
      'written again, the same codes',
    );
    assert.deepStrictEqual(
      sanitize(JSON.parse(serializeShared(entries))).map(e => e.key),
      entries.map(e => e.key),
    );
  },
);
