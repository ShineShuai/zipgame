// Tests of the Two paths puzzle: the core (model, helpers, rules, plain-text format, share code,
// and the solver checked against a plain brute-force search of the two paths), the generator
// (gen/twopaths.js, gen/twopaths-layout.js and the `twopaths` option of generate and walls), the
// variant in the play app (the rules of the two drawn paths, the board, icon, registry entry,
// texts in both languages, share code and record, grade) and the support in the design app that
// runs without a page (number editing, colour-wise validity, generator hooks, the broken line of
// a route, the technique ladder's refusal, walkColour with step options, what design.html
// offers).
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePuzzle, clonePuzzle, validate, maxNumber } from '../../src/core/model.js';
import { isSolved, isSolvedPaths, step, canStep } from '../../src/core/rules.js';
import { serialize, parse } from '../../src/core/format.js';
import { solve } from '../../src/core/solver/solve.js';
import { FAST, sampled, SLOW } from '../harness.js';
import {
  bridgeCells,
  splitPath,
  colourView,
  colourNumber,
  colourOfCell,
  colourCounts,
  colourNumberOf,
  colourProblems,
  markTwoPaths,
  setColourNumber,
} from '../../src/core/twopaths.js';
import {
  allEdges,
  edgeCells,
  hasWall,
  hasWallId,
  setWallId,
  wallCount,
  pathEdgeIds,
} from '../../src/core/edges.js';
import { backbite } from '../../src/core/gen/hampath.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { gridDist } from '../../src/core/geom.js';
import { symmetryKey, transformPuzzle } from '../../src/core/ratings-io.js';
import {
  encodeShare,
  decodeShare,
  SHARE_VERSION_SPLIT,
  TWO_PATHS,
  SHARE_VERSION_PORTAL,
} from '../../src/core/share-code.js';
import { runSync } from '../../src/core/run.js';
import {
  generate,
  tryGenerate,
  TWOPATHS_CANDIDATES,
  randomPathPuzzle,
  generateUnique,
} from '../../src/core/gen/generate.js';
import { generateTwoPaths, TWOPATHS_SIZES } from '../../src/core/gen/twopaths.js';
import { twoPathsLayout, redNumbers, CUT_SHARE } from '../../src/core/gen/twopaths-layout.js';
import { boardSvg, badgeColorsTwo, COLORS } from '../../src/apps/play/board.js';
import { variantById } from '../../src/apps/play/variants.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import {
  RED,
  BLUE,
  newPaths,
  pickColour,
  walkColour,
  solvedPaths,
  reached,
  legsUndoTwo,
  hintTwo,
} from '../../src/features/twopaths-play.js';
import { made } from '../fixtures/made.js';
import { ladder } from '../../src/core/ladder.js';
import { splitD } from '../../src/apps/design/board.js';
import { REFUSED } from '../errors.js';

// ---- the core: model, rules, format, share code, solver

// A random Two paths puzzle: a Hamiltonian path cut at a random place, each piece turned at random,
// 2 to 4 numbers on each piece (its ends included), random walls off the planted path.
// -> { p, red, blue } (the two planted paths).
function randomTwoPaths(n, seed, wallShare = 0.3) {
  const rnd = makeRng(seed * 7919 + n);
  const T = n * n;
  const base = backbite(n, rnd);
  const cut = 4 + Math.floor(rnd() * (T - 8));
  let red = base.slice(0, cut);
  let blue = base.slice(cut);
  if (rnd() < 0.5) red = red.reverse();
  if (rnd() < 0.5) blue = blue.reverse();
  const numbers = (piece, count) => {
    const mid = [];
    for (let i = 1; i < piece.length - 1; i++) mid.push(i);
    const at = [
      0,
      ...shuffle(mid, rnd)
        .slice(0, count - 2)
        .sort((a, b) => a - b),
      piece.length - 1,
    ];
    return at.map(i => piece[i]);
  };
  const redCells = numbers(red, 2 + Math.floor(rnd() * 3));
  const blueCells = numbers(blue, 2 + Math.floor(rnd() * 3));
  const p = makePuzzle(n);
  [...redCells, ...blueCells].forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  p.split = redCells.length;
  const planted = new Set();
  for (const piece of [red, blue]) {
    for (let i = 1; i < piece.length; i++) {
      planted.add(
        Math.min(piece[i - 1], piece[i]) * 2 + (Math.abs(piece[i] - piece[i - 1]) === 1 ? 0 : 1),
      );
    }
  }
  for (const e of allEdges(n)) {
    if (!planted.has(e) && rnd() < wallShare) p.walls[e >> 1] |= 1 << (e & 1);
  }
  p.path = [...red, ...blue];
  return { p, red, blue };
}

// Every solution of a Two paths puzzle by plain enumeration: the red path, then the blue path,
// each a self-avoiding walk over open edges that takes its own numbers in order, none of the other
// colour's, and ends on its last number; together they cover every cell. -> the merged paths
// (red cells, then blue cells), as strings, sorted.
function bruteTwoPaths(p) {
  const { n, split } = p;
  const T = n * n;
  const K = maxNumber(p);
  const at = new Array(K);
  p.cp.forEach((v, cell) => {
    if (v) at[v - 1] = cell;
  });
  const seen = new Uint8Array(T);
  const open = cell =>
    [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]
      .map(([dr, dc]) => {
        const r = ((cell / n) | 0) + dr;
        const c = (cell % n) + dc;
        return r < 0 || r >= n || c < 0 || c >= n ? -1 : r * n + c;
      })
      .filter(v => v >= 0 && !hasWall(p, cell, v));
  const found = [];
  // walk one colour: numbers first..last, `trail` = its cells so far
  const walk = (cell, first, last, next, trail, done) => {
    if (cell === at[last - 1]) {
      if (next === last + 1) done();
      return;
    }
    for (const v of open(cell)) {
      if (seen[v]) continue;
      const number = p.cp[v];
      if (number && number !== next) continue;
      seen[v] = 1;
      trail.push(v);
      walk(v, first, last, number ? next + 1 : next, trail, done);
      trail.pop();
      seen[v] = 0;
    }
  };
  const red = [at[0]];
  const blue = [at[split]];
  seen[at[0]] = 1;
  seen[at[split]] = 1;
  walk(at[0], 1, split, 2, red, () => {
    walk(at[split], split + 1, K, split + 2, blue, () => {
      if (red.length + blue.length === T) found.push([...red, ...blue].join(','));
    });
  });
  return found.sort();
}

const FLAG_SETS = [
  {},
  { prop: true },
  { prop: true, pocket: true, parity: true, prune2: true },
  { prop: true, seg: 'all', legCollide: true },
  { prop: true, incr: false },
  { prop: true, lconn: false },
];

test(
  'twopaths: solve finds exactly the two-path covers of a brute-force search (all flag sets)',
  FAST,
  () => {
    let compared = 0;
    let multi = 0;
    let adjacent = 0;
    const seeds = sampled(Array.from({ length: 40 }, (_, i) => i + 1));
    for (const n of [3, 4, 5]) {
      for (const seed of seeds) {
        const { p } = randomTwoPaths(n, seed, 0.15 + 0.05 * (seed % 6));
        const want = bruteTwoPaths(p);
        if (want.length > 1) multi++;
        const [a, b] = bridgeCells(p);
        if (gridDist(n, false, a, b) === 1) adjacent++;
        for (const flags of FLAG_SETS) {
          const r = solve(p, { ...flags, limit: 1e9, nodeCap: 1e7, capture: true });
          assert.ok(!r.exceeded, 'no cap hit');
          assert.deepStrictEqual(
            r.paths.map(String).sort(),
            want,
            `n=${n} seed=${seed} ${JSON.stringify(flags)}`,
          );
          compared++;
        }
      }
    }
    const share = seeds.length / 40; // the guards below scale with the sample
    assert.ok(
      compared > 600 * share && multi > 20 * share,
      `compared ${compared}, ${multi} puzzles with several solutions`,
    );
    assert.ok(
      adjacent > 0,
      `${adjacent} puzzles whose bridge cells touch (that grid edge is never walked)`,
    );
  },
);

test(
  'twopaths: the planted paths are a solution, and isSolved accepts every solution',
  FAST,
  () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { p, red, blue } = randomTwoPaths(5, seed, 0.5);
      const want = bruteTwoPaths(p);
      assert.ok(want.includes(p.path.join(',')), `seed ${seed}: the planted paths are a solution`);
      for (const text of want) {
        const merged = text.split(',').map(Number);
        assert.ok(isSolved(p, merged), `seed ${seed}: ${text}`);
        const [r, b] = splitPath(p, merged);
        assert.ok(isSolvedPaths(p, r, b));
      }
      assert.ok(isSolvedPaths(p, red, blue), `seed ${seed}: the planted paths`);
    }
  },
);

test(
  'twopaths: mustUse as a list finds exactly the solutions that walk every edge of it',
  FAST,
  () => {
    let cmp = 0;
    for (let s = 1; s <= 40; s++) {
      const n = 3 + (s % 3);
      const rnd = makeRng(s);
      const p = makePuzzle(n);
      const path = backbite(n, rnd);
      const count = 3 + (s % 3);
      const pick = [
        0,
        path.length - 1,
        ...shuffle(
          [...Array(path.length - 2).keys()].map(i => i + 1),
          rnd,
        ).slice(0, count - 2),
      ].sort((a, b) => a - b);
      pick.forEach((at, i) => {
        p.cp[path[at]] = i + 1;
      });
      for (const e of allEdges(n)) if (rnd() < 0.1 * (s % 4)) p.walls[e >> 1] |= 1 << (e & 1);
      for (let i = 1; i < path.length; i++) {
        const lo = Math.min(path[i - 1], path[i]);
        p.walls[lo] &= Math.abs(path[i] - path[i - 1]) === 1 ? ~1 : ~2;
      }
      const all = solve(p, { limit: 1e9, nodeCap: 1e7, capture: true });
      assert.ok(!all.exceeded);
      const open = allEdges(n)
        .filter(e => !hasWallId(p.walls, e))
        .map(e => edgeCells(n, e));
      const walks = (w, [a, b]) =>
        w.some((c, i) => i > 0 && ((w[i - 1] === a && c === b) || (w[i - 1] === b && c === a)));
      for (let k = 0; k < 12; k++) {
        const two = shuffle([...open], rnd).slice(0, 2);
        const want = all.paths.filter(w => two.every(edge => walks(w, edge))).map(String);
        for (const extra of [
          {},
          { prop: true },
          { prop: true, pocket: true, parity: true },
          { prop: true, incr: false },
        ]) {
          const r = solve(p, { ...extra, limit: 1e9, nodeCap: 1e7, capture: true, mustUse: two });
          assert.ok(!r.exceeded);
          assert.deepStrictEqual(
            r.paths.map(String),
            want,
            `case ${s} edges ${two} ${JSON.stringify(extra)}`,
          );
          cmp++;
        }
      }
    }
    assert.ok(cmp > 1500, `compared ${cmp}`);
  },
);

test(
  'twopaths: mustUse on a Two paths puzzle (the wall check) walks that grid edge too',
  FAST,
  () => {
    let cmp = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { p } = randomTwoPaths(5, seed, 0.4);
      const all = solve(p, { limit: 1e9, nodeCap: 1e7, capture: true, prop: true });
      const [a0, b0] = bridgeCells(p);
      for (const e of allEdges(5)) {
        if (hasWallId(p.walls, e)) continue;
        const [a, b] = edgeCells(5, e);
        const walks = w => {
          const [red, blue] = splitPath(p, w);
          return [red, blue].some(path =>
            path.some(
              (c, i) =>
                i > 0 && ((path[i - 1] === a && c === b) || (path[i - 1] === b && c === a)),
            ),
          );
        };
        const want = all.paths.filter(walks).map(String);
        for (const extra of [{ prop: true }, { prop: true, pocket: true, parity: true }]) {
          const r = solve(p, {
            ...extra,
            limit: 1e9,
            nodeCap: 1e7,
            capture: true,
            mustUse: [a, b],
          });
          assert.deepStrictEqual(
            r.paths.map(String),
            want,
            `seed ${seed} edge ${e} (${a}-${b}, bridge ${a0}-${b0})`,
          );
          cmp++;
        }
      }
    }
    assert.ok(cmp > 300, `compared ${cmp}`);
  },
);

test('twopaths: bridgeCells, splitPath, colour helpers and colourView', FAST, () => {
  const { p, red, blue } = randomTwoPaths(5, 3);
  const [a, b] = bridgeCells(p);
  assert.deepStrictEqual([a, b], [red[red.length - 1], blue[0]]);
  const [r, bl] = splitPath(p, p.path);
  assert.deepStrictEqual([r, bl], [red, blue]);
  assert.deepStrictEqual(splitPath(p, blue), null, 'no last red number on it');
  const K = maxNumber(p);
  assert.deepStrictEqual(colourCounts(p), [p.split, K - p.split]);
  assert.deepStrictEqual(colourNumber(p, p.split), p.split);
  assert.deepStrictEqual(colourNumber(p, p.split + 1), 1);
  assert.deepStrictEqual(colourNumber(p, K), K - p.split);
  assert.deepStrictEqual([colourOfCell(p, a), colourOfCell(p, b)], [0, 1]);
  assert.deepStrictEqual(colourOfCell(p, red[1]) === -1 || p.cp[red[1]] > 0, true);
  const redView = colourView(p, 0);
  const blueView = colourView(p, 1);
  assert.deepStrictEqual(maxNumber(redView), p.split);
  assert.deepStrictEqual(maxNumber(blueView), K - p.split);
  assert.deepStrictEqual(blueView.cp[blue[0]], 1);
  assert.deepStrictEqual(redView.cp[blue[0]], 0, 'a blue number is not on the red view');
  assert.ok(validate(redView).ok && validate(blueView).ok, 'each view is a standard puzzle');
  // playing one colour with step() on its view
  const path = [];
  for (const cell of red)
    assert.ok(step(redView, path, cell, { strictOrder: true }) === 'push', `red step to ${cell}`);
  assert.deepStrictEqual(path, red);
  const blueTrail = [];
  for (const cell of blue)
    assert.ok(step(blueView, blueTrail, cell, { strictOrder: true }) === 'push');
  assert.deepStrictEqual(blueTrail, blue);
});

test('twopaths: isSolved and isSolvedPaths refuse everything that is not a solution', FAST, () => {
  const { p, red, blue } = randomTwoPaths(5, 11, 0.6);
  assert.ok(isSolved(p, [...red, ...blue]));
  assert.ok(isSolvedPaths(p, red, blue));
  assert.ok(!isSolved(p, [...blue, ...red]), 'blue first is not the order of a path');
  assert.ok(!isSolvedPaths(p, blue, red), 'the colours are not interchangeable');
  assert.ok(!isSolvedPaths(p, red.slice(0, -1), blue), 'a cell short');
  assert.ok(!isSolvedPaths(p, red, blue.slice(1)), 'a cell short, and no start');
  assert.ok(!isSolvedPaths(p, [...red].reverse(), blue), 'red backwards');
  assert.ok(!isSolved(p, p.path.slice(0, -1)));
  assert.ok(!isSolved(p, []));
  const [, b] = bridgeCells(p);
  assert.ok(!isSolvedPaths(p, [...red, b], blue), 'a cell twice');
  // a step over a wall
  const walled = clonePuzzle(p);
  const [x, y] = [red[0], red[1]];
  const lo = Math.min(x, y);
  walled.walls[lo] |= Math.abs(x - y) === 1 ? 1 : 2;
  assert.ok(!isSolved(walled, [...red, ...blue]), 'the first red step crosses a wall');
  // a jump (two cells that do not touch)
  const jump = [...red];
  [jump[1], jump[2]] = [jump[2], jump[1]];
  assert.ok(!isSolvedPaths(p, jump, blue), 'two cells swapped');
});

test(
  'twopaths: validate — each colour needs 2 numbers, no other variant comes with it',
  FAST,
  () => {
    const base = () => {
      const p = makePuzzle(4);
      [0, 3, 12, 15, 5].forEach((cell, i) => {
        p.cp[cell] = i + 1;
      });
      return p;
    };
    const p = base();
    p.split = 2;
    assert.deepStrictEqual(validate(p), { ok: true, max: 5 });
    for (const bad of [1, 4, 5, 0.5, -1, '2']) {
      const q = base();
      q.split = bad;
      assert.ok(!validate(q).ok, `split ${bad} refused`);
    }
    const q = base();
    q.split = 3;
    assert.ok(validate(q).ok, '3 red, 2 blue');
    for (const extra of [
      { wrap: true },
      { loop: true },
      { exact: true },
      { portals: [[1, 14]] },
      { holes: new Uint8Array(16).fill(0, 0, 16) },
      { arrows: new Uint8Array(16) },
    ]) {
      const w = { ...base(), split: 2, ...extra };
      assert.ok(!validate(w).ok, `refused with ${Object.keys(extra)}`);
    }
    assert.throws(
      () => solve({ ...base(), split: 2, wrap: true }),
      REFUSED,
      'the solver refuses a combination',
    );
    assert.throws(() => solve({ ...base(), split: 2, portals: [[1, 14]] }), REFUSED);
    assert.deepStrictEqual(clonePuzzle(p).split, 2, 'clonePuzzle keeps split');
    assert.deepStrictEqual(clonePuzzle(base()).split, undefined);
    // numbering with a gap is still refused
    const gap = base();
    gap.split = 2;
    gap.cp[5] = 7;
    assert.ok(!validate(gap).ok);
  },
);

test('twopaths: the text format keeps split, and a path line may cross the bridge', FAST, () => {
  const { p } = randomTwoPaths(5, 4, 0.5);
  const text = serialize(p);
  assert.ok(/^split \d+$/m.test(text), 'a split line');
  const back = parse(text);
  assert.deepStrictEqual(back.split, p.split);
  assert.deepStrictEqual(serialize(back), text);
  const withPath = parse(serialize(p, { path: p.path }));
  assert.deepStrictEqual(withPath.path, p.path, 'the path line crosses the bridge');
  assert.ok(isSolved(withPath, withPath.path));
  for (const bad of [
    'size 4\nsplit\ncheckpoints 0,0=1',
    'size 4\nsplit 0',
    'size 4\nsplit x',
    'size 4\nsplit 2 3',
    'size 4\nsplit 2\nwrap',
    'size 4\nsplit 2\nloop',
    'size 4\nsplit 2\nexact',
    'size 4\nsplit 2\nportals 0,0~3,3',
    'size 4\nsplit 2\nholes 1,1',
    'size 4\nsplit 2\narrows',
  ]) {
    assert.throws(() => parse(bad), REFUSED, `refused: ${bad.replace(/\n/g, ' / ')}`);
  }
  assert.ok(
    !/^split/m.test(serialize(parse('size 4\ncheckpoints 0,0=1 3,3=2\nwalls'))),
    'a standard puzzle has none',
  );
  // a jump that is not the bridge is still refused: swap two cells of the red path
  const jumpy = p.path.slice();
  [jumpy[1], jumpy[3]] = [jumpy[3], jumpy[1]];
  assert.throws(
    () => parse(serialize(p, { path: jumpy })),
    REFUSED,
    'a path that jumps elsewhere',
  );
});

test(
  'twopaths: share code round trip, canonical, own version, refuses an unsound record',
  FAST,
  () => {
    let coded = 0;
    for (const n of [4, 5, 6, 7, 8]) {
      for (let seed = 1; seed <= 12; seed++) {
        const { p } = randomTwoPaths(n, seed, 0.3);
        delete p.path;
        const rec = {
          kind: 'local',
          variant: TWO_PATHS,
          n,
          grade: null,
          timeS: 12.3,
          levels: [],
          puzzle: p,
        };
        const code = encodeShare(rec);
        assert.ok(code, `n=${n} seed=${seed} encodes`);
        const back = decodeShare(code);
        assert.deepStrictEqual(back.variant, TWO_PATHS);
        assert.deepStrictEqual(back.puzzle.split, p.split);
        assert.deepStrictEqual(Array.from(back.puzzle.cp), Array.from(p.cp));
        assert.deepStrictEqual(Array.from(back.puzzle.walls), Array.from(p.walls));
        assert.deepStrictEqual(back.timeS, 12.3);
        assert.deepStrictEqual(encodeShare(back), code, 'canonical');
        coded++;
        // the version is its own
        const bits = [...code].map(ch =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(ch),
        );
        assert.deepStrictEqual(bits[0] >> 3, SHARE_VERSION_SPLIT, 'first 3 bits = the version');
      }
    }
    assert.ok(coded === 60);
    const { p } = randomTwoPaths(5, 2);
    delete p.path;
    const good = {
      kind: 'local',
      variant: TWO_PATHS,
      n: 5,
      grade: null,
      timeS: 3,
      levels: [],
      puzzle: p,
    };
    assert.ok(encodeShare(good));
    for (const [name, rec] of Object.entries({
      'split 1': { ...good, puzzle: { ...p, split: 1 } },
      'split too big': { ...good, puzzle: { ...p, split: maxNumber(p) - 1 } },
      'no split': {
        ...good,
        puzzle: (() => {
          const q = clonePuzzle(p);
          delete q.split;
          return q;
        })(),
      },
      'wrap too': { ...good, puzzle: { ...p, wrap: true } },
      'a grade': { ...good, grade: 2 },
    })) {
      assert.ok(encodeShare(rec) === null, name);
    }
    // a standard record carrying a split is not a standard puzzle
    assert.ok(encodeShare({ ...good, variant: null }) === null, 'split on a standard record');
    // another version's code does not read as Two paths, and the numbers differ per split
    assert.ok(SHARE_VERSION_SPLIT !== SHARE_VERSION_PORTAL);
    const a = clonePuzzle(p);
    const b = clonePuzzle(p);
    b.split = p.split === 2 ? 3 : 2;
    if (maxNumber(p) >= 5)
      assert.ok(encodeShare({ ...good, puzzle: a }) !== encodeShare({ ...good, puzzle: b }));
  },
);

test(
  'twopaths: transformPuzzle keeps the puzzle, reversed numbering swaps the colours',
  FAST,
  () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { p } = randomTwoPaths(5, seed, 0.5);
      const K = maxNumber(p);
      const count = solve(p, { limit: 1e9, nodeCap: 1e7, prop: true }).count;
      for (let k = 0; k < 8; k++) {
        for (const reverse of [false, true]) {
          const q = transformPuzzle(p, k, reverse);
          assert.deepStrictEqual(q.split, reverse ? K - p.split : p.split);
          assert.deepStrictEqual(
            solve(q, { limit: 1e9, nodeCap: 1e7, prop: true }).count,
            count,
            `seed ${seed} k=${k} ${reverse}`,
          );
        }
      }
    }
    const { p } = randomTwoPaths(5, 1, 0.5);
    assert.ok(
      symmetryKey(p) === symmetryKey(transformPuzzle(p, 5, true)),
      'one key for equivalent puzzles',
    );
    const other = clonePuzzle(p);
    other.split = p.split === 2 ? 3 : 2;
    assert.ok(
      symmetryKey(other) !== symmetryKey(p) || maxNumber(p) < 5,
      'another split is another puzzle',
    );
  },
);

// ---- the generator

const generated = (n, seed, o = {}) => runSync(generateTwoPaths(n, seed, o));

// A path of the board: every cell once, every step to a neighbour.
const isGridPath = (n, path) =>
  new Set(path).size === path.length &&
  path.every((cell, i) => i === 0 || gridDist(n, false, path[i - 1], cell) === 1);

test(
  'twopaths-gen: redNumbers — its share of the numbers, 2 at least for each colour',
  FAST,
  () => {
    assert.deepStrictEqual(redNumbers(10, 50, 100), 5);
    assert.deepStrictEqual(redNumbers(10, 10, 100), 2);
    assert.deepStrictEqual(redNumbers(10, 95, 100), 8);
    assert.deepStrictEqual(redNumbers(4, 50, 100), 2);
    for (let K = 4; K <= 20; K++) {
      for (const share of [0.1, 0.35, 0.5, 0.65, 0.9]) {
        const k = redNumbers(K, Math.round(share * 100), 100);
        assert.ok(k >= 2 && K - k >= 2, `K=${K} share=${share}: ${k}`);
      }
    }
  },
);

test(
  'twopaths-gen: layout — two grid paths that cover the board, ends apart, numbers ordered',
  FAST,
  () => {
    let made = 0;
    for (const n of [4, 5, 6, 7, 8, 10]) {
      for (const cps of ['gap', 'random']) {
        for (let seed = 1; seed <= 25; seed++) {
          const K = Math.max(4, n + (seed % 4));
          const layout = twoPathsLayout(n, K, makeRng(seed * 13 + n), cps);
          if (!layout) continue;
          made++;
          const { path, positions, split } = layout;
          const cells = n * n;
          assert.deepStrictEqual(path.length, cells);
          assert.deepStrictEqual(new Set(path).size, cells, 'every cell once');
          assert.ok(split >= 2 && K - split >= 2, `split ${split} of ${K}`);
          assert.deepStrictEqual(positions.length, K);
          // the one step that is not to a neighbour is the bridge (there has to be one)
          const redLength = path.findIndex(
            (cell, i) => i > 0 && gridDist(n, false, path[i - 1], cell) !== 1,
          );
          assert.ok(redLength > 0, 'a bridge between the pieces');
          const red = path.slice(0, redLength);
          const blue = path.slice(redLength);
          assert.ok(isGridPath(n, red) && isGridPath(n, blue), 'each piece is a grid path');
          assert.ok(
            gridDist(n, false, red[red.length - 1], blue[0]) > 1,
            'the bridge ends do not touch',
          );
          assert.deepStrictEqual(positions[0], 0, 'red starts at its first cell');
          assert.deepStrictEqual(positions[split - 1], redLength - 1, 'red ends at its last cell');
          assert.deepStrictEqual(positions[split], redLength, 'blue starts at its first cell');
          assert.deepStrictEqual(positions[K - 1], cells - 1, 'blue ends at its last cell');
          for (let i = 1; i < K; i++)
            if (i !== split) assert.ok(positions[i] > positions[i - 1], 'ascending');
          const share = redLength / cells;
          assert.ok(
            share >= CUT_SHARE[0] - 0.05 && share <= CUT_SHARE[1] + 0.05,
            `cut at ${share}`,
          );
        }
      }
    }
    assert.ok(made > 250, `${made} layouts`);
    assert.deepStrictEqual(
      twoPathsLayout(5, 3, makeRng(1)),
      null,
      'fewer than 4 numbers cannot be two paths',
    );
  },
);

test('twopaths-gen: layout is repeatable, and varies with the seed', FAST, () => {
  const a = twoPathsLayout(6, 7, makeRng(5));
  const b = twoPathsLayout(6, 7, makeRng(5));
  assert.deepStrictEqual(a, b);
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++)
    seen.add(JSON.stringify(twoPathsLayout(6, 7, makeRng(seed))));
  assert.ok(seen.size > 15, `${seen.size} different layouts of 20`);
});

test(
  'twopaths-gen: generate — valid, one solution, the stored path solves it, walls off its edges',
  SLOW,
  () => {
    for (const n of [4, 5, 6, 7]) {
      for (let seed = 1; seed <= 5; seed++) {
        const p = generated(n, seed);
        const tag = `n=${n} seed=${seed}`;
        assert.ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
        assert.ok(p.split >= 2 && maxNumber(p) - p.split >= 2, `${tag}: split ${p.split}`);
        assert.deepStrictEqual(p.seed, seed);
        const r = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true });
        assert.ok(!r.exceeded, `${tag}: no cap hit`);
        assert.deepStrictEqual(r.count, 1, `${tag}: one solution`);
        assert.deepStrictEqual(r.paths[0], p.path, `${tag}: it is the stored path`);
        assert.ok(isSolved(p, p.path), `${tag}: isSolved`);
        const [red, blue] = splitPath(p, p.path);
        assert.ok(isGridPath(n, red) && isGridPath(n, blue), `${tag}: two grid paths`);
        const [a, b] = bridgeCells(p);
        assert.ok(gridDist(n, false, a, b) > 1, `${tag}: the bridge ends do not touch`);
        // no wall on an edge a path walks
        for (const path of [red, blue]) {
          for (let i = 1; i < path.length; i++)
            assert.ok(canStep(p, path[i - 1], path[i]), `${tag}: wall on the path`);
        }
      }
    }
  },
);

test(
  'twopaths-gen: every wall left is needed (taking any one out makes a second solution)',
  SLOW,
  () => {
    for (const n of [5, 6]) {
      for (let seed = 1; seed <= 6; seed++) {
        const p = generated(n, seed);
        for (const e of allEdges(n)) {
          if (!hasWallId(p.walls, e)) continue;
          const q = clonePuzzle(p);
          setWallId(q.walls, e, false);
          const r = solve(q, { limit: 2, nodeCap: 5e6, prop: true });
          assert.ok(!r.exceeded && r.count === 2, `n=${n} seed=${seed} wall ${e} could go`);
        }
      }
    }
  },
);

test('twopaths-gen: same seed, same puzzle; other seeds, other puzzles', SLOW, () => {
  assert.deepStrictEqual(serialize(generated(6, 9)), serialize(generated(6, 9)));
  const seen = new Set();
  for (let seed = 1; seed <= 8; seed++) seen.add(serialize(generated(6, seed)));
  assert.ok(seen.size >= 7, `${seen.size} different puzzles of 8`);
});

test(
  'twopaths-gen: sizes offered are measured ones; sizes below 4 and other variants are refused',
  FAST,
  () => {
    for (const n of TWOPATHS_SIZES) assert.ok(TWOPATHS_CANDIDATES[n] > 0, `candidates for ${n}`);
    assert.throws(() => generated(3, 1), REFUSED, 'n = 3');
    assert.throws(
      () => runSync(generate(6, 1, { twopaths: true, wrap: true })),
      REFUSED,
      'with wrap',
    );
    assert.throws(
      () => runSync(generate(6, 1, { twopaths: true, loop: true })),
      REFUSED,
      'with loop',
    );
    assert.throws(
      () => runSync(generate(6, 1, { twopaths: true, teleport: true })),
      REFUSED,
      'with teleport',
    );
  },
);

test(
  'twopaths-gen: tryGenerate with twopaths gives a split puzzle, unique, with its paths',
  FAST,
  () => {
    let got = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = makeRng(seed);
      const p = runSync(tryGenerate(6, 7, rnd, 100000, 36, 0.4, { prop: true, twopaths: true }));
      if (!p) continue;
      got++;
      assert.ok(p.split >= 2 && p.path.length === 36);
      assert.deepStrictEqual(solve(p, { limit: 2, nodeCap: 1e6, prop: true }).count, 1);
      assert.deepStrictEqual(wallCount(p), p.order.length);
    }
    assert.ok(got >= 4, `${got} of 6`);
  },
);

// ---- the variant in the play app

const game = (n, seed) => made('twopaths', n, seed);
const stateOf = (p, paths, extra = {}) => ({
  puzzle: p,
  paths,
  path: paths[RED],
  colour: RED,
  hintCell: null,
  hintWrongCell: null,
  finished: false,
  ...extra,
});
// Draws `cells` as one drag of the colour a press on the first one picks, the way the app does.
const draw = (p, paths, cells, current = RED) => {
  const colour = pickColour(p, paths, cells[0], current);
  const kinds = cells.map(cell => walkColour(p, paths, colour, cell));
  return { colour, kinds };
};
const placeholders = text => (text.match(/\{\d\}/g) || []).sort().join('');
const CJK = /[\u4e00-\u9fff]/;

test('twopaths-play: texts — every key in both languages, the hint button too', FAST, () => {
  const v = variantById('twopaths');
  const keys = [
    ...Object.values(v.keys),
    'game.twopathsHint',
    'game.twopathsRed',
    'game.twopathsBlue',
    'game.hint',
  ];
  for (const key of keys) {
    assert.ok(typeof EN[key] === 'string' && EN[key], `EN ${key}`);
    assert.ok(typeof ZH[key] === 'string' && ZH[key], `ZH ${key}`);
    assert.deepStrictEqual(
      placeholders(ZH[key]),
      placeholders(EN[key]),
      `${key}: the same placeholders`,
    );
  }
  assert.deepStrictEqual(
    placeholders(EN['game.hint']),
    '{0}{1}',
    'the hint button shows used and allowed',
  );
  for (const key of ['game.hint', 'mode.twopaths', 'mode.twopathsRules']) {
    assert.ok(CJK.test(ZH[key]), `${key} is Chinese`);
  }
  assert.deepStrictEqual(
    Object.keys(EN).sort(),
    Object.keys(ZH).sort(),
    'both dictionaries have the same keys',
  );
  const label = EN['game.hint'].replace('{0}', 2).replace('{1}', 7);
  assert.deepStrictEqual(label, 'Hint (2/7)', 'the English label as before');
});

test(
  'twopaths-play: boardSvg — a line and a badge shape per colour, blue numbers from 1',
  FAST,
  () => {
    const p = game(6, 3);
    const [red, blue] = splitPath(p, p.path);
    const K = maxNumber(p);
    const svg = boardSvg(stateOf(p, newPaths()));
    assert.ok(/class="zip-svg[^"]*twopaths/.test(svg), 'twopaths class');
    assert.deepStrictEqual(
      (svg.match(/<path data-role="path" data-colour="\d"/g) || []).length,
      2,
      'two lines',
    );
    for (const ink of COLORS.twoPath)
      assert.ok(svg.includes(`stroke="${ink}"`), `a line in ${ink}`);
    assert.deepStrictEqual(
      (svg.match(/<circle class="num-shape"/g) || []).length,
      p.split,
      'a circle per red number',
    );
    const squares = (svg.match(/<rect class="num-shape"/g) || []).length;
    assert.deepStrictEqual(squares, K - p.split, 'a square per blue number');
    const blueNumbers = [...svg.matchAll(/data-colour="1">[\s\S]*?<text[^>]*>(\d+)<\/text>/g)]
      .map(m => +m[1])
      .sort((a, b) => a - b);
    assert.deepStrictEqual(
      blueNumbers,
      Array.from({ length: K - p.split }, (_, i) => i + 1),
      'blue counts from 1',
    );
    const redNumbers = [...svg.matchAll(/data-colour="0">[\s\S]*?<text[^>]*>(\d+)<\/text>/g)]
      .map(m => +m[1])
      .sort((a, b) => a - b);
    assert.deepStrictEqual(
      redNumbers,
      Array.from({ length: p.split }, (_, i) => i + 1),
      'red counts from 1',
    );
    assert.deepStrictEqual(
      (svg.match(/data-role="path" data-colour="\d" d=""/g) || []).length,
      2,
      'nothing drawn yet',
    );
    // a drawn red line, a reached red number is filled with red, a blue one stays an idle ring
    const drawn = stateOf(p, [red.slice(0, 3), []]);
    const withLine = boardSvg(drawn);
    assert.ok(/data-colour="0" d="M[^"]+L/.test(withLine), 'the red line is drawn');
    assert.ok(/data-colour="1" d=""/.test(withLine), 'the blue one is not');
    const cell0 = `data-num-cell="${red[0]}" data-colour="0"`;
    const lit = ink => ink.replace(/[()]/g, '\\$&'); // var(--x) in a regular expression
    const start = new RegExp(`${cell0}><circle[^>]*fill="${lit(COLORS.twoPath[RED])}"`);
    assert.ok(start.test(withLine), 'red 1 is filled red');
    const idle = new RegExp(
      `data-num-cell="${blue[0]}" data-colour="1"><rect[^>]*fill="${lit(COLORS.numberFill)}"`,
    );
    assert.ok(idle.test(withLine), 'blue 1 is still a white square');
    assert.deepStrictEqual(badgeColorsTwo(BLUE, true).fill, COLORS.twoPath[BLUE]);
    assert.deepStrictEqual(badgeColorsTwo(RED, false).stroke, COLORS.twoPath[RED]);
    // a standard board is what it was
    const std = made('std', 5, 2);
    const bare = { puzzle: std, path: [], hintCell: null, hintWrongCell: null, finished: false };
    const plain = boardSvg(bare);
    assert.ok(!/num-shape|data-colour|twopaths/.test(plain), 'a standard board has none of it');
    assert.deepStrictEqual((plain.match(/data-role="path"/g) || []).length, 1, 'one line');
  },
);

test(
  'twopaths-play: a whole game — red, then blue, interleaved; every move accepted',
  FAST,
  () => {
    for (const seed of [1, 2, 3]) {
      const p = game(6, seed);
      const [red, blue] = splitPath(p, p.path);
      const paths = newPaths();
      const a = draw(p, paths, red);
      assert.deepStrictEqual(
        [a.colour, a.kinds.every(k => k === 'push')],
        [RED, true],
        `seed ${seed}: red`,
      );
      assert.ok(!solvedPaths(p, paths), 'half is not solved');
      const b = draw(p, paths, blue, a.colour);
      assert.deepStrictEqual(
        [b.colour, b.kinds.every(k => k === 'push')],
        [BLUE, true],
        `seed ${seed}: blue`,
      );
      assert.ok(solvedPaths(p, paths), `seed ${seed}: solved`);
      assert.deepStrictEqual(paths, [red, blue]);
    }
    // interleaved: a bit of red, a bit of blue, red goes on from its head, blue from its head
    const p = game(7, 4);
    const [red, blue] = splitPath(p, p.path);
    const paths = newPaths();
    let colour = RED;
    const turns = [
      [RED, 0, 4],
      [BLUE, 0, 3],
      [RED, 4, red.length],
      [BLUE, 3, blue.length],
    ];
    for (const [c, from, to] of turns) {
      const part = (c === RED ? red : blue).slice(from, to);
      // a press on the head cell goes on with that path (pickColour: a path's own cell)
      const press = from === 0 ? part[0] : (c === RED ? red : blue)[from - 1];
      assert.deepStrictEqual(pickColour(p, paths, press, colour), c, 'the press picks its colour');
      colour = c;
      for (const cell of part)
        assert.deepStrictEqual(walkColour(p, paths, c, cell), 'push', `cell ${cell}`);
    }
    assert.ok(solvedPaths(p, paths), 'interleaved: solved');
  },
);

test('twopaths-play: walkColour refuses what the rules refuse', SLOW, () => {
  let touching = 0;
  let numbers = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const p = game(6, seed);
    const [red, blue] = splitPath(p, p.path);
    // a path starts on its own 1 only
    assert.deepStrictEqual(
      walkColour(p, newPaths(), RED, blue[0]),
      null,
      'red cannot start on blue 1',
    );
    assert.deepStrictEqual(
      walkColour(p, newPaths(), BLUE, red[0]),
      null,
      'blue cannot start on red 1',
    );
    assert.deepStrictEqual(walkColour(p, newPaths(), RED, red[1]), null, 'a path starts on a 1');
    // one step back is an undo
    const paths = [red.slice(0, 3), []];
    assert.deepStrictEqual(walkColour(p, paths, RED, red[1]), 'pop');
    assert.deepStrictEqual(paths[RED], red.slice(0, 2));
    // a cell of the other path
    for (let i = 0; i < red.length; i++) {
      for (let j = 0; j < blue.length; j++) {
        if (!canStep(p, red[i], blue[j])) continue;
        const both = [red.slice(0, i + 1), blue.slice(0, j + 1)];
        if (colourOfCell(p, blue[j]) < 0 && i > 0) {
          assert.deepStrictEqual(
            walkColour(p, both, RED, blue[j]),
            null,
            `seed ${seed}: red onto blue's cell`,
          );
          assert.deepStrictEqual(both[RED], red.slice(0, i + 1), 'nothing moved');
          touching++;
        }
        if (colourOfCell(p, blue[j]) === BLUE && !both[BLUE].includes(blue[j])) numbers++;
      }
    }
    // a number of the other colour, though no path is on it yet
    for (let i = 1; i < red.length; i++) {
      for (const cell of blue) {
        if (colourOfCell(p, cell) !== BLUE || !canStep(p, red[i], cell)) continue;
        const paths2 = [red.slice(0, i + 1), []];
        assert.deepStrictEqual(
          walkColour(p, paths2, RED, cell),
          null,
          `seed ${seed}: red onto a blue number`,
        );
        numbers++;
      }
    }
  }
  assert.ok(
    touching > 5 && numbers > 0,
    `${touching} touching cells, ${numbers} blue numbers checked`,
  );
});

test(
  "twopaths-play: pickColour — a path's cell, a number, the head that can step there",
  FAST,
  () => {
    const p = game(7, 5);
    const [red, blue] = splitPath(p, p.path);
    const none = newPaths();
    assert.deepStrictEqual(pickColour(p, none, red[0], BLUE), RED, 'a press on red 1 draws red');
    assert.deepStrictEqual(
      pickColour(p, none, blue[0], RED),
      BLUE,
      'a press on blue 1 draws blue',
    );
    const free = p.cp.findIndex((v, cell) => !v && cell !== red[1]);
    assert.deepStrictEqual(
      pickColour(p, none, free, BLUE),
      BLUE,
      'a free cell: the colour drawn now',
    );
    assert.deepStrictEqual(pickColour(p, none, free), RED, 'the default is red');
    const paths = [red.slice(0, 3), blue.slice(0, 3)];
    assert.deepStrictEqual(pickColour(p, paths, red[1], BLUE), RED, 'a cell of the red path');
    assert.deepStrictEqual(pickColour(p, paths, blue[2], RED), BLUE, 'a cell of the blue path');
    // a free cell next to the red head only: red, whatever was drawn last
    const next = red[3];
    if (colourOfCell(p, next) < 0 && !canStep(p, blue[2], next)) {
      assert.deepStrictEqual(
        pickColour(p, paths, next, BLUE),
        RED,
        'the head that can step there',
      );
    }
    const blueNumber = blue.find((cell, i) => i > 0 && colourOfCell(p, cell) === BLUE);
    assert.deepStrictEqual(
      pickColour(p, [red.slice(0, 1), []], blueNumber, RED),
      BLUE,
      'a blue number is blue',
    );
  },
);

test('twopaths-play: reached, solvedPaths refuse a half or a swapped solution', FAST, () => {
  const p = game(6, 2);
  const [red, blue] = splitPath(p, p.path);
  assert.deepStrictEqual(reached(p, newPaths()), [0, 0]);
  assert.deepStrictEqual(reached(p, [red, blue]), [p.split, maxNumber(p) - p.split]);
  assert.deepStrictEqual(reached(p, [red.slice(0, 1), []]), [1, 0]);
  assert.ok(solvedPaths(p, [red, blue]));
  assert.ok(!solvedPaths(p, [blue, red]), 'swapped');
  assert.ok(!solvedPaths(p, [red, blue.slice(0, -1)]), 'a cell short');
  assert.ok(!solvedPaths(p, newPaths()));
});

test(
  'twopaths-play: legsUndoTwo — the legs of the blue path come after the red ones',
  SLOW,
  () => {
    const found = { [RED]: 0, [BLUE]: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const p = game(7, seed);
      const parts = splitPath(p, p.path);
      for (const colour of [RED, BLUE]) {
        const part = parts[colour];
        const second = part.findIndex((cell, i) => i > 0 && colourOfCell(p, cell) === colour);
        if (second < 0 || second >= part.length - 1) continue;
        // the head one cell past the colour's 2nd number, and takes that cell back
        const prev = part.slice(0, second + 2);
        const legs = [];
        legsUndoTwo(legs, p, colour, prev, second + 1);
        const offset = colour === RED ? 0 : p.split;
        const filled = legs.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
        assert.deepStrictEqual(
          filled,
          [offset + 1],
          `seed ${seed} colour ${colour}: leg after the 2nd number`,
        );
        assert.deepStrictEqual(legs[offset + 1], 1);
        found[colour]++;
      }
    }
    assert.ok(found[RED] > 0 && found[BLUE] > 0, `checked ${found[RED]} red, ${found[BLUE]} blue`);
    // nothing taken back, nothing counted
    const p = game(6, 1);
    const legs = [];
    legsUndoTwo(legs, p, RED, splitPath(p, p.path)[0], splitPath(p, p.path)[0].length);
    assert.deepStrictEqual(legs, []);
  },
);

test(
  'twopaths-play: hintTwo — next cell, wrong cell, the other colour once one is done',
  FAST,
  () => {
    const p = game(6, 4);
    const [red, blue] = splitPath(p, p.path);
    assert.deepStrictEqual(hintTwo(p, newPaths(), RED), {
      colour: RED,
      correctCell: red[0],
      wrongCell: null,
    });
    assert.deepStrictEqual(hintTwo(p, newPaths(), BLUE), {
      colour: BLUE,
      correctCell: blue[0],
      wrongCell: null,
    });
    assert.deepStrictEqual(
      hintTwo(p, [red.slice(0, 3), []], RED).correctCell,
      red[3],
      'on track: the next cell',
    );
    // red is finished: the hint is for blue
    assert.deepStrictEqual(hintTwo(p, [red, blue.slice(0, 2)], RED), {
      colour: BLUE,
      correctCell: blue[2],
      wrongCell: null,
    });
    // red went wrong at its 2nd cell
    const stray = p.cp.findIndex((_v, cell) => cell !== red[0] && cell !== red[1]);
    assert.deepStrictEqual(hintTwo(p, [[red[0], stray], []], RED), {
      colour: RED,
      correctCell: red[1],
      wrongCell: stray,
    });
    assert.deepStrictEqual(
      hintTwo(p, [red, blue], RED),
      { colour: RED, correctCell: null, wrongCell: null },
      'done',
    );
    // a solution that is not stored is found by the solver
    const bare = { ...p };
    delete bare.path;
    assert.deepStrictEqual(
      hintTwo(bare, newPaths(), RED).correctCell,
      red[0],
      'the solver finds it',
    );
  },
);

// (the grade by trap only, with the model of the type, is a row of variant-contract.test.js)
test('twopaths-play: colourNumber counts each colour from 1', FAST, () => {
  const p = game(6, 1);
  assert.deepStrictEqual(colourNumber(p, p.split + 1), 1, 'colourNumber');
});

// ---- the design app

// A model of the typed numbers, to compare setColourNumber with: per colour a Map number -> cell.
function modelSet(model, cell, colour, value) {
  for (const m of model) for (const [v, c] of m) if (c === cell) m.delete(v);
  if (value > 0) model[colour].set(value, cell);
}
const modelCells = (p, model) => {
  const split = Math.max(1, ...model[RED].keys());
  const cp = new Array(p.cp.length).fill(0);
  for (const [v, c] of model[RED]) cp[c] = v;
  for (const [v, c] of model[BLUE]) cp[c] = split + v;
  return { cp, split };
};

test('design-twopaths: setColourNumber — a number of a colour; blue follows red', FAST, () => {
  const p = makePuzzle(5);
  markTwoPaths(p);
  assert.deepStrictEqual(p.split, 1, 'an empty Two paths board has split 1');
  setColourNumber(p, 0, RED, 1);
  setColourNumber(p, 4, RED, 2);
  assert.deepStrictEqual(p.split, 2);
  setColourNumber(p, 20, BLUE, 1);
  setColourNumber(p, 24, BLUE, 2);
  assert.deepStrictEqual(
    [p.cp[0], p.cp[4], p.cp[20], p.cp[24]],
    [1, 2, 3, 4],
    'blue 1 and 2 after red 2',
  );
  assert.deepStrictEqual(colourProblems(p), null);
  // a third red number: every blue one moves up, and is still blue 1 and blue 2
  setColourNumber(p, 12, RED, 3);
  assert.deepStrictEqual(p.split, 3);
  assert.deepStrictEqual([p.cp[20], p.cp[24]], [4, 5]);
  assert.deepStrictEqual(
    [colourNumberOf(p, 20), colourNumberOf(p, 24)],
    [
      { colour: BLUE, number: 1 },
      { colour: BLUE, number: 2 },
    ],
  );
  assert.deepStrictEqual(colourNumberOf(p, 12), { colour: RED, number: 3 });
  assert.deepStrictEqual(colourNumberOf(p, 1), null);
  // taking it away again
  setColourNumber(p, 12, RED, 0);
  assert.deepStrictEqual([p.split, p.cp[20], p.cp[24], p.cp[12]], [2, 3, 4, 0]);
  // a number typed again moves: red 1 to another cell leaves the old cell empty
  setColourNumber(p, 6, RED, 1);
  assert.deepStrictEqual([p.cp[0], p.cp[6]], [0, 1]);
  // a cell given the other colour loses its old number
  setColourNumber(p, 6, BLUE, 3);
  assert.deepStrictEqual(colourNumberOf(p, 6), { colour: BLUE, number: 3 });
  assert.deepStrictEqual(
    p.split,
    2,
    'red lost its 1: red has only 2 left, so split stays at the highest red number',
  );
  assert.ok(colourProblems(p).includes('red 1 is missing'), colourProblems(p));
  setColourNumber(p, 0, RED, 1);
  assert.deepStrictEqual(colourProblems(p), null, 'red 1, red 2, blue 1, 2, 3');
  assert.deepStrictEqual(maxNumber(p), 5);
});

test('design-twopaths: setColourNumber agrees with a plain model over random edits', FAST, () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = makeRng(seed);
    const p = makePuzzle(5);
    markTwoPaths(p);
    const model = [new Map(), new Map()];
    for (let step = 0; step < 60; step++) {
      const cell = Math.floor(rnd() * 25);
      const colour = rnd() < 0.5 ? RED : BLUE;
      const value = rnd() < 0.2 ? 0 : 1 + Math.floor(rnd() * 5);
      setColourNumber(p, cell, colour, value);
      modelSet(model, cell, colour, value);
      const want = modelCells(p, model);
      assert.deepStrictEqual(Array.from(p.cp), want.cp, `seed ${seed} step ${step}`);
      assert.deepStrictEqual(p.split, want.split);
    }
  }
});

test("design-twopaths: colourProblems — in the board's words (red 3 is missing)", FAST, () => {
  const p = makePuzzle(4);
  markTwoPaths(p);
  assert.ok(/red path needs at least 2/.test(colourProblems(p)), 'empty');
  setColourNumber(p, 0, RED, 1);
  setColourNumber(p, 1, RED, 2);
  assert.ok(/blue path needs at least 2/.test(colourProblems(p)), 'no blue yet');
  setColourNumber(p, 8, BLUE, 1);
  setColourNumber(p, 9, BLUE, 3);
  assert.deepStrictEqual(colourProblems(p), 'Invalid: blue 2 is missing.');
  setColourNumber(p, 10, BLUE, 2);
  assert.deepStrictEqual(colourProblems(p), null);
  // two cells with the same number (a hand-edited list)
  p.cp[11] = p.cp[10];
  assert.deepStrictEqual(colourProblems(p), 'Invalid: blue 2 is on 2 cells.');
  const standard = makePuzzle(4);
  [0, 5, 10].forEach((cell, i) => {
    standard.cp[cell] = i + 1;
  });
  markTwoPaths(standard);
  assert.deepStrictEqual(standard.split, 3, 'a board that was standard: all its numbers are red');
  assert.ok(/blue path needs at least 2/.test(colourProblems(standard)));
});

test('design-twopaths: a board built by hand solves, exports and imports', FAST, () => {
  const p = makePuzzle(4);
  markTwoPaths(p);
  // red: 0 1 2 3, blue: 15 14 13 12 8 9 10 11 4 5 6 7 (the rows 1 and 2 and 3 as a snake)
  const red = [0, 1, 2, 3];
  const blue = [7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
  setColourNumber(p, red[0], RED, 1);
  setColourNumber(p, red[3], RED, 2);
  setColourNumber(p, blue[0], BLUE, 1);
  setColourNumber(p, blue[11], BLUE, 2);
  assert.ok(validate(p).ok, validate(p).msg);
  const r = solve(p, { limit: 5, nodeCap: 1e6, capture: true, prop: true });
  const planted = [...red, ...blue].join();
  assert.ok(r.count >= 1 && r.paths.some(path => path.join() === planted), 'it has this solution');
  assert.ok(isSolved(p, [...red, ...blue]));
  const back = parse(serialize(p, { path: [...red, ...blue] }));
  assert.deepStrictEqual([back.split, back.path], [p.split, [...red, ...blue]]);
  assert.deepStrictEqual(Array.from(back.cp), Array.from(p.cp));
});

test(
  'design-twopaths: randomPathPuzzle with twopaths — a split board and its solving path',
  FAST,
  () => {
    for (const n of [4, 5, 6, 7, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const p = randomPathPuzzle(n, n + 1, makeRng(seed * 11 + n), false, false, 0, true);
        const tag = `n=${n} seed=${seed}`;
        assert.ok(p.split >= 2 && maxNumber(p) - p.split >= 2, `${tag}: split ${p.split}`);
        assert.ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
        assert.ok(isSolved(p, p.path), `${tag}: the path solves it`);
        assert.deepStrictEqual(colourProblems(p), null, tag);
        const [red, blue] = splitPath(p, p.path);
        assert.deepStrictEqual([colourOfCell(p, red[0]), colourOfCell(p, blue[0])], [RED, BLUE]);
      }
    }
    // fewer than 4 numbers is raised to 4; without the flag it is the same standard puzzle as ever
    assert.deepStrictEqual(
      maxNumber(randomPathPuzzle(6, 2, makeRng(3), false, false, 0, true)),
      4,
    );
    const plain = randomPathPuzzle(6, 5, makeRng(3));
    assert.deepStrictEqual(plain.split, undefined);
  },
);

test(
  'design-twopaths: generateUnique with twopaths — one solution, within the walls',
  FAST,
  () => {
    for (const n of [5, 6, 7]) {
      const r = runSync(
        generateUnique(n, n + 1, makeRng(n), {
          maxWalls: 12,
          tries: 20,
          twopaths: true,
        }),
      );
      assert.ok(r.unique, `n=${n}: unique`);
      assert.ok(r.puzzle.split >= 2, 'a Two paths puzzle');
      assert.deepStrictEqual(
        solve(r.puzzle, { limit: 2, nodeCap: 1e6, prop: true }).count,
        1,
        `n=${n}: one solution`,
      );
      assert.ok(r.walls <= 12, `n=${n}: ${r.walls} walls`);
    }
    let failed = 0;
    for (const o of [{ wrap: true }, { loop: true }, { pairs: 1 }]) {
      try {
        runSync(generateUnique(6, 6, makeRng(1), { twopaths: true, ...o }));
      } catch {
        failed++;
      }
    }
    assert.deepStrictEqual(failed, 3, 'not together with wrap, loop or portals');
    let small = false;
    try {
      runSync(generateUnique(3, 4, makeRng(1), { twopaths: true }));
    } catch {
      small = true;
    }
    assert.ok(small, 'a 3x3 board is too small');
  },
);

test(
  'design-twopaths: a failed unique search still gives a Two paths puzzle (type kept)',
  FAST,
  () => {
    // no walls and 4 numbers: no retry can come out unique, so the wall-free fallback is returned;
    // the design app adopts it, and a puzzle without its split would switch the type to Standard
    for (const n of [5, 6, 8]) {
      for (const seed of [1, 2]) {
        const o = { maxWalls: 0, tries: 2, twopaths: true };
        const r = runSync(generateUnique(n, 4, makeRng(seed), o));
        assert.ok(!r.unique, `n=${n} seed=${seed}: the search fails, as this test needs`);
        assert.ok(r.puzzle.split >= 2, `n=${n} seed=${seed}: the fallback keeps its split`);
        const p = r.puzzle;
        assert.ok(validate(p).ok && isSolved(p, p.path), 'and is a puzzle with a path');
      }
    }
  },
);

test(
  'design-twopaths: the bridge is a link no wall stands on; a route has two pieces',
  FAST,
  () => {
    const p = randomPathPuzzle(6, 7, makeRng(5), false, false, 0, true);
    const ids = pathEdgeIds(p.n, p.path, false, false, [bridgeCells(p)]);
    assert.deepStrictEqual(ids.length, p.path.length - 1, 'one edge per step');
    assert.deepStrictEqual(
      ids.filter(e => e >= 2 * p.n * p.n).length,
      1,
      'the bridge is the one link edge',
    );
    const d = splitD(p.n, p.path, p);
    assert.deepStrictEqual((d.match(/M/g) || []).length, 2, 'two pieces');
    assert.deepStrictEqual(
      (d.match(/L/g) || []).length,
      p.path.length - 2,
      'every other step is a line',
    );
    const half = splitPath(p, p.path);
    assert.ok(d.startsWith('M'), 'it starts with a move');
    assert.deepStrictEqual(half[0].length + half[1].length, p.path.length);
  },
);

test('design-twopaths: the technique ladder says it does not know Two paths', FAST, () => {
  const p = randomPathPuzzle(6, 7, makeRng(2), false, false, 0, true);
  assert.ok(/Two paths/.test(ladder(p).error), ladder(p).error);
  const standard = randomPathPuzzle(6, 7, makeRng(2));
  assert.ok(!ladder(standard).error, 'a standard puzzle still has its ladder');
});

test(
  'design-twopaths: walkColour with step options — rewind, stop at the last number',
  FAST,
  () => {
    const p = randomPathPuzzle(6, 6, makeRng(4), false, false, 0, true);
    const [red] = splitPath(p, p.path);
    const opts = { truncate: true, strictOrder: true };
    const paths = newPaths();
    for (const cell of red)
      assert.deepStrictEqual(walkColour(p, paths, RED, cell, opts), 'push', `cell ${cell}`);
    // on its last number a path goes no further (strictOrder)
    const last = red[red.length - 1];
    const around = [last - 1, last + 1, last - 6, last + 6].filter(
      c => c >= 0 && c < 36 && !paths[RED].includes(c) && colourOfCell(p, c) !== BLUE,
    );
    for (const cell of around) {
      assert.deepStrictEqual(
        walkColour(p, paths, RED, cell, opts),
        null,
        `nothing after red's last number (${cell})`,
      );
    }
    // a press on an earlier cell rewinds the path to it
    assert.deepStrictEqual(walkColour(p, paths, RED, red[1], opts), 'trunc');
    assert.deepStrictEqual(paths[RED], red.slice(0, 2));
  },
);
