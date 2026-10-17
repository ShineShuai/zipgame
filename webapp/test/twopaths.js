// Tests of the "Two paths" core: the model (core/model.js), the helpers (core/twopaths.js), the
// rules (core/rules.js), the plain-text format (core/format.js), the share code
// (core/share-code.js) and the solver (core/solver/solve-two.js, solve.js mustUse list), checked
// against a plain brute-force search of the two paths. Registered by tests.js:
// twoPathsTests(t, ok, eq).
import { makePuzzle, clonePuzzle, validate, maxNumber } from '../src/core/model.js';
import { isSolved, isSolvedPaths, step } from '../src/core/rules.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import {
  bridgeCells, splitPath, colourView, colourNumber, colourOfCell, colourCounts,
} from '../src/core/twopaths.js';
import { allEdges, edgeCells, hasWall, hasWallId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { gridDist } from '../src/core/geom.js';
import { symmetryKey, transformPuzzle } from '../src/core/ratings-io.js';
import {
  encodeShare, decodeShare, SHARE_VERSION_SPLIT, TWO_PATHS, SHARE_VERSION_PORTAL,
} from '../src/core/share-code.js';

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A random Two paths puzzle: a Hamiltonian path cut at a random place, each piece turned at random,
// 2 to 4 numbers on each piece (its ends included), random walls off the planted path.
// -> { p, red, blue } (the two planted paths).
export function randomTwoPaths(n, seed, wallShare = 0.3) {
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
    const at = [0, ...shuffle(mid, rnd).slice(0, count - 2).sort((a, b) => a - b), piece.length - 1];
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
      planted.add(Math.min(piece[i - 1], piece[i]) * 2 + (Math.abs(piece[i] - piece[i - 1]) === 1 ? 0 : 1));
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
export function bruteTwoPaths(p) {
  const { n, split } = p;
  const T = n * n;
  const K = maxNumber(p);
  const at = new Array(K);
  p.cp.forEach((v, cell) => {
    if (v) at[v - 1] = cell;
  });
  const seen = new Uint8Array(T);
  const open = cell => [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dr, dc]) => {
    const r = ((cell / n) | 0) + dr;
    const c = (cell % n) + dc;
    return r < 0 || r >= n || c < 0 || c >= n ? -1 : r * n + c;
  }).filter(v => v >= 0 && !hasWall(p, cell, v));
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

export function twoPathsTests(t, ok, eq) {
  t('twopaths: solve finds exactly the two-path covers of a brute-force search (all flag sets)', () => {
    let compared = 0;
    let multi = 0;
    let adjacent = 0;
    for (const n of [3, 4, 5]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { p } = randomTwoPaths(n, seed, 0.15 + 0.05 * (seed % 6));
        const want = bruteTwoPaths(p);
        if (want.length > 1) multi++;
        const [a, b] = bridgeCells(p);
        if (gridDist(n, false, a, b) === 1) adjacent++;
        for (const flags of FLAG_SETS) {
          const r = solve(p, { ...flags, limit: 1e9, nodeCap: 1e7, capture: true });
          ok(!r.exceeded, 'no cap hit');
          eq(r.paths.map(String).sort(), want, `n=${n} seed=${seed} ${JSON.stringify(flags)}`);
          compared++;
        }
      }
    }
    ok(compared > 600 && multi > 20, `compared ${compared}, ${multi} puzzles with several solutions`);
    ok(adjacent > 0, `${adjacent} puzzles whose bridge cells touch (that grid edge is never walked)`);
  });

  t('twopaths: the planted paths are a solution, and isSolved accepts every solution', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { p, red, blue } = randomTwoPaths(5, seed, 0.5);
      const want = bruteTwoPaths(p);
      ok(want.includes(p.path.join(',')), `seed ${seed}: the planted paths are a solution`);
      for (const text of want) {
        const merged = text.split(',').map(Number);
        ok(isSolved(p, merged), `seed ${seed}: ${text}`);
        const [r, b] = splitPath(p, merged);
        ok(isSolvedPaths(p, r, b));
      }
      ok(isSolvedPaths(p, red, blue), `seed ${seed}: the planted paths`);
    }
  });

  t('twopaths: mustUse as a list finds exactly the solutions that walk every edge of it', () => {
    let cmp = 0;
    for (let s = 1; s <= 40; s++) {
      const n = 3 + (s % 3);
      const rnd = makeRng(s);
      const p = makePuzzle(n);
      const path = backbite(n, rnd);
      const count = 3 + (s % 3);
      const pick = [0, path.length - 1, ...shuffle([...Array(path.length - 2).keys()].map(i => i + 1), rnd)
        .slice(0, count - 2)].sort((a, b) => a - b);
      pick.forEach((at, i) => {
        p.cp[path[at]] = i + 1;
      });
      for (const e of allEdges(n)) if (rnd() < 0.1 * (s % 4)) p.walls[e >> 1] |= 1 << (e & 1);
      for (let i = 1; i < path.length; i++) {
        const lo = Math.min(path[i - 1], path[i]);
        p.walls[lo] &= Math.abs(path[i] - path[i - 1]) === 1 ? ~1 : ~2;
      }
      const all = solve(p, { limit: 1e9, nodeCap: 1e7, capture: true });
      ok(!all.exceeded);
      const open = allEdges(n).filter(e => !hasWallId(p.walls, e)).map(e => edgeCells(n, e));
      const walks = (w, [a, b]) => w.some((c, i) => i > 0 && ((w[i - 1] === a && c === b) || (w[i - 1] === b && c === a)));
      for (let k = 0; k < 12; k++) {
        const two = shuffle([...open], rnd).slice(0, 2);
        const want = all.paths.filter(w => two.every(edge => walks(w, edge))).map(String);
        for (const extra of [{}, { prop: true }, { prop: true, pocket: true, parity: true }, { prop: true, incr: false }]) {
          const r = solve(p, { ...extra, limit: 1e9, nodeCap: 1e7, capture: true, mustUse: two });
          ok(!r.exceeded);
          eq(r.paths.map(String), want, `case ${s} edges ${two} ${JSON.stringify(extra)}`);
          cmp++;
        }
      }
    }
    ok(cmp > 1500, `compared ${cmp}`);
  });

  t('twopaths: mustUse on a Two paths puzzle (the wall check) walks that grid edge too', () => {
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
          return [red, blue].some(path => path.some((c, i) => i > 0
            && ((path[i - 1] === a && c === b) || (path[i - 1] === b && c === a))));
        };
        const want = all.paths.filter(walks).map(String);
        for (const extra of [{ prop: true }, { prop: true, pocket: true, parity: true }]) {
          const r = solve(p, { ...extra, limit: 1e9, nodeCap: 1e7, capture: true, mustUse: [a, b] });
          eq(r.paths.map(String), want, `seed ${seed} edge ${e} (${a}-${b}, bridge ${a0}-${b0})`);
          cmp++;
        }
      }
    }
    ok(cmp > 300, `compared ${cmp}`);
  });

  t('twopaths: bridgeCells, splitPath, colour helpers and colourView', () => {
    const { p, red, blue } = randomTwoPaths(5, 3);
    const [a, b] = bridgeCells(p);
    eq([a, b], [red[red.length - 1], blue[0]]);
    const [r, bl] = splitPath(p, p.path);
    eq([r, bl], [red, blue]);
    eq(splitPath(p, blue), null, 'no last red number on it');
    const K = maxNumber(p);
    eq(colourCounts(p), [p.split, K - p.split]);
    eq(colourNumber(p, p.split), p.split);
    eq(colourNumber(p, p.split + 1), 1);
    eq(colourNumber(p, K), K - p.split);
    eq([colourOfCell(p, a), colourOfCell(p, b)], [0, 1]);
    eq(colourOfCell(p, red[1]) === -1 || p.cp[red[1]] > 0, true);
    const redView = colourView(p, 0);
    const blueView = colourView(p, 1);
    eq(maxNumber(redView), p.split);
    eq(maxNumber(blueView), K - p.split);
    eq(blueView.cp[blue[0]], 1);
    eq(redView.cp[blue[0]], 0, 'a blue number is not on the red view');
    ok(validate(redView).ok && validate(blueView).ok, 'each view is a standard puzzle');
    // playing one colour with step() on its view
    const path = [];
    for (const cell of red) ok(step(redView, path, cell, { strictOrder: true }) === 'push', `red step to ${cell}`);
    eq(path, red);
    const blueTrail = [];
    for (const cell of blue) ok(step(blueView, blueTrail, cell, { strictOrder: true }) === 'push');
    eq(blueTrail, blue);
  });

  t('twopaths: isSolved and isSolvedPaths refuse everything that is not a solution', () => {
    const { p, red, blue } = randomTwoPaths(5, 11, 0.6);
    ok(isSolved(p, [...red, ...blue]));
    ok(isSolvedPaths(p, red, blue));
    ok(!isSolved(p, [...blue, ...red]), 'blue first is not the order of a path');
    ok(!isSolvedPaths(p, blue, red), 'the colours are not interchangeable');
    ok(!isSolvedPaths(p, red.slice(0, -1), blue), 'a cell short');
    ok(!isSolvedPaths(p, red, blue.slice(1)), 'a cell short, and no start');
    ok(!isSolvedPaths(p, [...red].reverse(), blue), 'red backwards');
    ok(!isSolved(p, p.path.slice(0, -1)));
    ok(!isSolved(p, []));
    const [, b] = bridgeCells(p);
    ok(!isSolvedPaths(p, [...red, b], blue), 'a cell twice');
    // a step over a wall
    const walled = clonePuzzle(p);
    const [x, y] = [red[0], red[1]];
    const lo = Math.min(x, y);
    walled.walls[lo] |= Math.abs(x - y) === 1 ? 1 : 2;
    ok(!isSolved(walled, [...red, ...blue]), 'the first red step crosses a wall');
    // a jump (two cells that do not touch)
    const jump = [...red];
    [jump[1], jump[2]] = [jump[2], jump[1]];
    ok(!isSolvedPaths(p, jump, blue), 'two cells swapped');
  });

  t('twopaths: validate — each colour needs 2 numbers, no other variant comes with it', () => {
    const base = () => {
      const p = makePuzzle(4);
      [0, 3, 12, 15, 5].forEach((cell, i) => {
        p.cp[cell] = i + 1;
      });
      return p;
    };
    const p = base();
    p.split = 2;
    eq(validate(p), { ok: true, max: 5 });
    for (const bad of [1, 4, 5, 0.5, -1, '2']) {
      const q = base();
      q.split = bad;
      ok(!validate(q).ok, `split ${bad} refused`);
    }
    const q = base();
    q.split = 3;
    ok(validate(q).ok, '3 red, 2 blue');
    for (const extra of [{ wrap: true }, { loop: true }, { exact: true }, { portals: [[1, 14]] },
      { holes: new Uint8Array(16).fill(0, 0, 16) }, { arrows: new Uint8Array(16) }]) {
      const w = { ...base(), split: 2, ...extra };
      ok(!validate(w).ok, `refused with ${Object.keys(extra)}`);
    }
    ok(threw(() => solve({ ...base(), split: 2, wrap: true })), 'the solver refuses a combination');
    ok(threw(() => solve({ ...base(), split: 2, portals: [[1, 14]] })));
    eq(clonePuzzle(p).split, 2, 'clonePuzzle keeps split');
    eq(clonePuzzle(base()).split, undefined);
    // numbering with a gap is still refused
    const gap = base();
    gap.split = 2;
    gap.cp[5] = 7;
    ok(!validate(gap).ok);
  });

  t('twopaths: the text format keeps split, and a path line may cross the bridge', () => {
    const { p } = randomTwoPaths(5, 4, 0.5);
    const text = serialize(p);
    ok(/^split \d+$/m.test(text), 'a split line');
    const back = parse(text);
    eq(back.split, p.split);
    eq(serialize(back), text);
    const withPath = parse(serialize(p, { path: p.path }));
    eq(withPath.path, p.path, 'the path line crosses the bridge');
    ok(isSolved(withPath, withPath.path));
    for (const bad of ['size 4\nsplit\ncheckpoints 0,0=1', 'size 4\nsplit 0', 'size 4\nsplit x',
      'size 4\nsplit 2 3', 'size 4\nsplit 2\nwrap', 'size 4\nsplit 2\nloop', 'size 4\nsplit 2\nexact',
      'size 4\nsplit 2\nportals 0,0~3,3', 'size 4\nsplit 2\nholes 1,1', 'size 4\nsplit 2\narrows']) {
      ok(threw(() => parse(bad)), `refused: ${bad.replace(/\n/g, ' / ')}`);
    }
    ok(!/^split/m.test(serialize(parse('size 4\ncheckpoints 0,0=1 3,3=2\nwalls'))), 'a standard puzzle has none');
    // a jump that is not the bridge is still refused: swap two cells of the red path
    const jumpy = p.path.slice();
    [jumpy[1], jumpy[3]] = [jumpy[3], jumpy[1]];
    ok(threw(() => parse(serialize(p, { path: jumpy }))), 'a path that jumps elsewhere');
  });

  t('twopaths: share code round trip, canonical, own version, refuses an unsound record', () => {
    let coded = 0;
    for (const n of [4, 5, 6, 7, 8]) {
      for (let seed = 1; seed <= 12; seed++) {
        const { p } = randomTwoPaths(n, seed, 0.3);
        delete p.path;
        const rec = { kind: 'local', variant: TWO_PATHS, n, grade: null, timeS: 12.3, levels: [], puzzle: p };
        const code = encodeShare(rec);
        ok(code, `n=${n} seed=${seed} encodes`);
        const back = decodeShare(code);
        eq(back.variant, TWO_PATHS);
        eq(back.puzzle.split, p.split);
        eq(Array.from(back.puzzle.cp), Array.from(p.cp));
        eq(Array.from(back.puzzle.walls), Array.from(p.walls));
        eq(back.timeS, 12.3);
        eq(encodeShare(back), code, 'canonical');
        coded++;
        // the version is its own
        const bits = [...code].map(ch => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(ch));
        eq(bits[0] >> 3, SHARE_VERSION_SPLIT, 'first 3 bits = the version');
      }
    }
    ok(coded === 60);
    const { p } = randomTwoPaths(5, 2);
    delete p.path;
    const good = { kind: 'local', variant: TWO_PATHS, n: 5, grade: null, timeS: 3, levels: [], puzzle: p };
    ok(encodeShare(good));
    for (const [name, rec] of Object.entries({
      'split 1': { ...good, puzzle: { ...p, split: 1 } },
      'split too big': { ...good, puzzle: { ...p, split: maxNumber(p) - 1 } },
      'no split': { ...good, puzzle: (() => { const q = clonePuzzle(p); delete q.split; return q; })() },
      'wrap too': { ...good, puzzle: { ...p, wrap: true } },
      'a grade': { ...good, grade: 2 },
    })) {
      ok(encodeShare(rec) === null, name);
    }
    // a standard record carrying a split is not a standard puzzle
    ok(encodeShare({ ...good, variant: null }) === null, 'split on a standard record');
    // another version's code does not read as Two paths, and the numbers differ per split
    ok(SHARE_VERSION_SPLIT !== SHARE_VERSION_PORTAL);
    const a = clonePuzzle(p);
    const b = clonePuzzle(p);
    b.split = p.split === 2 ? 3 : 2;
    if (maxNumber(p) >= 5) ok(encodeShare({ ...good, puzzle: a }) !== encodeShare({ ...good, puzzle: b }));
  });

  t('twopaths: transformPuzzle keeps the puzzle, reversed numbering swaps the colours', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { p } = randomTwoPaths(5, seed, 0.5);
      const K = maxNumber(p);
      const count = solve(p, { limit: 1e9, nodeCap: 1e7, prop: true }).count;
      for (let k = 0; k < 8; k++) {
        for (const reverse of [false, true]) {
          const q = transformPuzzle(p, k, reverse);
          eq(q.split, reverse ? K - p.split : p.split);
          eq(solve(q, { limit: 1e9, nodeCap: 1e7, prop: true }).count, count, `seed ${seed} k=${k} ${reverse}`);
        }
      }
    }
    const { p } = randomTwoPaths(5, 1, 0.5);
    ok(symmetryKey(p) === symmetryKey(transformPuzzle(p, 5, true)), 'one key for equivalent puzzles');
    const other = clonePuzzle(p);
    other.split = p.split === 2 ? 3 : 2;
    ok(symmetryKey(other) !== symmetryKey(p) || maxNumber(p) < 5, 'another split is another puzzle');
  });
}
