// Tests of the Two paths support of the design app that run without a page: the number editing
// and the colour-wise validity (core/twopaths.js), the generator hooks (gen/generate.js
// randomPathPuzzle and generateUnique), the broken line of a route (apps/design/board.js), the
// technique ladder's refusal, walkColour with step options (features/twopaths-play.js), and what
// design.html offers. Registered by tests.js: designTwoPathsTests(t, ok, eq).
import { readFileSync } from 'node:fs';
import { makePuzzle, validate, maxNumber } from '../src/core/model.js';
import { serialize, parse } from '../src/core/format.js';
import { isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { pathEdgeIds } from '../src/core/edges.js';
import { ladder } from '../src/core/ladder.js';
import { randomPathPuzzle, generateUnique } from '../src/core/gen/generate.js';
import {
  bridgeCells, colourNumberOf, colourOfCell, colourProblems, markTwoPaths, setColourNumber,
  splitPath,
} from '../src/core/twopaths.js';
import { newPaths, walkColour } from '../src/features/twopaths-play.js';
import { splitD } from '../src/apps/design/board.js';

const RED = 0;
const BLUE = 1;
const html = readFileSync(new URL('../design.html', import.meta.url), 'utf8');

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

export function designTwoPathsTests(t, ok, eq) {
  t('design-twopaths: setColourNumber — a number of a colour; blue follows red', () => {
    const p = makePuzzle(5);
    markTwoPaths(p);
    eq(p.split, 1, 'an empty Two paths board has split 1');
    setColourNumber(p, 0, RED, 1);
    setColourNumber(p, 4, RED, 2);
    eq(p.split, 2);
    setColourNumber(p, 20, BLUE, 1);
    setColourNumber(p, 24, BLUE, 2);
    eq([p.cp[0], p.cp[4], p.cp[20], p.cp[24]], [1, 2, 3, 4], 'blue 1 and 2 after red 2');
    eq(colourProblems(p), null);
    // a third red number: every blue one moves up, and is still blue 1 and blue 2
    setColourNumber(p, 12, RED, 3);
    eq(p.split, 3);
    eq([p.cp[20], p.cp[24]], [4, 5]);
    eq([colourNumberOf(p, 20), colourNumberOf(p, 24)],
      [{ colour: BLUE, number: 1 }, { colour: BLUE, number: 2 }]);
    eq(colourNumberOf(p, 12), { colour: RED, number: 3 });
    eq(colourNumberOf(p, 1), null);
    // taking it away again
    setColourNumber(p, 12, RED, 0);
    eq([p.split, p.cp[20], p.cp[24], p.cp[12]], [2, 3, 4, 0]);
    // a number typed again moves: red 1 to another cell leaves the old cell empty
    setColourNumber(p, 6, RED, 1);
    eq([p.cp[0], p.cp[6]], [0, 1]);
    // a cell given the other colour loses its old number
    setColourNumber(p, 6, BLUE, 3);
    eq(colourNumberOf(p, 6), { colour: BLUE, number: 3 });
    eq(p.split, 2, 'red lost its 1: red has only 2 left, so split stays at the highest red number');
    ok(colourProblems(p).includes('red 1 is missing'), colourProblems(p));
    setColourNumber(p, 0, RED, 1);
    eq(colourProblems(p), null, 'red 1, red 2, blue 1, 2, 3');
    eq(maxNumber(p), 5);
  });

  t('design-twopaths: setColourNumber agrees with a plain model over random edits', () => {
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
        eq(Array.from(p.cp), want.cp, `seed ${seed} step ${step}`);
        eq(p.split, want.split);
      }
    }
  });

  t('design-twopaths: colourProblems — in the board\'s words (red 3 is missing)', () => {
    const p = makePuzzle(4);
    markTwoPaths(p);
    ok(/red path needs at least 2/.test(colourProblems(p)), 'empty');
    setColourNumber(p, 0, RED, 1);
    setColourNumber(p, 1, RED, 2);
    ok(/blue path needs at least 2/.test(colourProblems(p)), 'no blue yet');
    setColourNumber(p, 8, BLUE, 1);
    setColourNumber(p, 9, BLUE, 3);
    eq(colourProblems(p), 'Invalid: blue 2 is missing.');
    setColourNumber(p, 10, BLUE, 2);
    eq(colourProblems(p), null);
    // two cells with the same number (a hand-edited list)
    p.cp[11] = p.cp[10];
    eq(colourProblems(p), 'Invalid: blue 2 is on 2 cells.');
    const standard = makePuzzle(4);
    [0, 5, 10].forEach((cell, i) => {
      standard.cp[cell] = i + 1;
    });
    markTwoPaths(standard);
    eq(standard.split, 3, 'a board that was standard: all its numbers are red');
    ok(/blue path needs at least 2/.test(colourProblems(standard)));
  });

  t('design-twopaths: a board built by hand solves, exports and imports', () => {
    const p = makePuzzle(4);
    markTwoPaths(p);
    // red: 0 1 2 3, blue: 15 14 13 12 8 9 10 11 4 5 6 7 (the rows 1 and 2 and 3 as a snake)
    const red = [0, 1, 2, 3];
    const blue = [7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
    setColourNumber(p, red[0], RED, 1);
    setColourNumber(p, red[3], RED, 2);
    setColourNumber(p, blue[0], BLUE, 1);
    setColourNumber(p, blue[11], BLUE, 2);
    ok(validate(p).ok, validate(p).msg);
    const r = solve(p, { limit: 5, nodeCap: 1e6, capture: true, prop: true });
    const planted = [...red, ...blue].join();
    ok(r.count >= 1 && r.paths.some(path => path.join() === planted), 'it has this solution');
    ok(isSolved(p, [...red, ...blue]));
    const back = parse(serialize(p, { path: [...red, ...blue] }));
    eq([back.split, back.path], [p.split, [...red, ...blue]]);
    eq(Array.from(back.cp), Array.from(p.cp));
  });

  t('design-twopaths: randomPathPuzzle with twopaths — a split board and its solving path', () => {
    for (const n of [4, 5, 6, 7, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const p = randomPathPuzzle(n, n + 1, makeRng(seed * 11 + n), false, false, 0, true);
        const tag = `n=${n} seed=${seed}`;
        ok(p.split >= 2 && maxNumber(p) - p.split >= 2, `${tag}: split ${p.split}`);
        ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
        ok(isSolved(p, p.path), `${tag}: the path solves it`);
        eq(colourProblems(p), null, tag);
        const [red, blue] = splitPath(p, p.path);
        eq([colourOfCell(p, red[0]), colourOfCell(p, blue[0])], [RED, BLUE]);
      }
    }
    // fewer than 4 numbers is raised to 4; without the flag it is the same standard puzzle as ever
    eq(maxNumber(randomPathPuzzle(6, 2, makeRng(3), false, false, 0, true)), 4);
    const plain = randomPathPuzzle(6, 5, makeRng(3));
    eq(plain.split, undefined);
  });

  t('design-twopaths: generateUnique with twopaths — one solution, within the walls', () => {
    for (const n of [5, 6, 7]) {
      const r = runSync(generateUnique(n, n + 1, makeRng(n), {
        maxWalls: 12, tries: 20, twopaths: true,
      }));
      ok(r.unique, `n=${n}: unique`);
      ok(r.puzzle.split >= 2, 'a Two paths puzzle');
      eq(solve(r.puzzle, { limit: 2, nodeCap: 1e6, prop: true }).count, 1, `n=${n}: one solution`);
      ok(r.walls <= 12, `n=${n}: ${r.walls} walls`);
    }
    let failed = 0;
    for (const o of [{ wrap: true }, { loop: true }, { pairs: 1 }]) {
      try {
        runSync(generateUnique(6, 6, makeRng(1), { twopaths: true, ...o }));
      } catch {
        failed++;
      }
    }
    eq(failed, 3, 'not together with wrap, loop or portals');
    let small = false;
    try {
      runSync(generateUnique(3, 4, makeRng(1), { twopaths: true }));
    } catch {
      small = true;
    }
    ok(small, 'a 3x3 board is too small');
  });

  t('design-twopaths: a failed unique search still gives a Two paths puzzle (type kept)', () => {
    // no walls and 4 numbers: no retry can come out unique, so the wall-free fallback is returned;
    // the design app adopts it, and a puzzle without its split would switch the type to Standard
    for (const n of [5, 6, 8]) {
      for (const seed of [1, 2]) {
        const o = { maxWalls: 0, tries: 2, twopaths: true };
        const r = runSync(generateUnique(n, 4, makeRng(seed), o));
        ok(!r.unique, `n=${n} seed=${seed}: the search fails, as this test needs`);
        ok(r.puzzle.split >= 2, `n=${n} seed=${seed}: the fallback keeps its split`);
        const p = r.puzzle;
        ok(validate(p).ok && isSolved(p, p.path), 'and is a puzzle with a path');
      }
    }
  });

  t('design-twopaths: the bridge is a link no wall stands on; a route has two pieces', () => {
    const p = randomPathPuzzle(6, 7, makeRng(5), false, false, 0, true);
    const ids = pathEdgeIds(p.n, p.path, false, false, [bridgeCells(p)]);
    eq(ids.length, p.path.length - 1, 'one edge per step');
    eq(ids.filter(e => e >= 2 * p.n * p.n).length, 1, 'the bridge is the one link edge');
    const d = splitD(p.n, p.path, p);
    eq((d.match(/M/g) || []).length, 2, 'two pieces');
    eq((d.match(/L/g) || []).length, p.path.length - 2, 'every other step is a line');
    const half = splitPath(p, p.path);
    ok(d.startsWith('M'), 'it starts with a move');
    eq(half[0].length + half[1].length, p.path.length);
  });

  t('design-twopaths: the technique ladder says it does not know Two paths', () => {
    const p = randomPathPuzzle(6, 7, makeRng(2), false, false, 0, true);
    ok(/Two paths/.test(ladder(p).error), ladder(p).error);
    const standard = randomPathPuzzle(6, 7, makeRng(2));
    ok(!ladder(standard).error, 'a standard puzzle still has its ladder');
  });

  t('design-twopaths: walkColour with step options — rewind, stop at the last number', () => {
    const p = randomPathPuzzle(6, 6, makeRng(4), false, false, 0, true);
    const [red] = splitPath(p, p.path);
    const opts = { truncate: true, strictOrder: true };
    const paths = newPaths();
    for (const cell of red) eq(walkColour(p, paths, RED, cell, opts), 'push', `cell ${cell}`);
    // on its last number a path goes no further (strictOrder)
    const last = red[red.length - 1];
    const around = [last - 1, last + 1, last - 6, last + 6].filter(c => c >= 0 && c < 36
      && !paths[RED].includes(c) && colourOfCell(p, c) !== BLUE);
    for (const cell of around) {
      eq(walkColour(p, paths, RED, cell, opts), null, `nothing after red's last number (${cell})`);
    }
    // a press on an earlier cell rewinds the path to it
    eq(walkColour(p, paths, RED, red[1], opts), 'trunc');
    eq(paths[RED], red.slice(0, 2));
  });

  t('design-twopaths: design.html offers the type and the colour toggle, with the Teleport tools', () => {
    ok(html.includes('<option value="twopaths">Two paths</option>'), 'the type option');
    ok(/id="colRed"/.test(html) && /id="colBlue"/.test(html), 'the colour buttons');
    const lists = [...html.matchAll(/data-variants="([^"]*)"/g)].map(m => m[1].split(' '));
    // every group that holds several types and has Teleport has Two paths: both are a board of
    // numbers and walls (a group of one type only is the portals, the arrows, the colours)
    for (const list of lists.filter(l => l.length > 1 && l.includes('teleport'))) {
      ok(list.includes('twopaths'), `twopaths missing from "${list.join(' ')}"`);
    }
    // the groups that are not for it stay without it: the A/B comparison, the target grades
    ok(lists.some(l => l.join(' ') === 'standard wrap exact loop'), 'compare group unchanged');
    ok(lists.some(l => l.join(' ') === 'standard exact'), 'target grade group unchanged');
    eq(lists.filter(l => l.length === 1 && l[0] === 'twopaths').length, 1, 'one colour toggle');
  });
}
