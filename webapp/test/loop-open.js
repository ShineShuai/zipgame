// Tests of the Loop puzzle's "the ring is not closed" indicator in the play app (apps/play/board.js
// loopOpen / loopOpenMarks): a path that has visited every cell but does not close. Registered by
// tests.js: loopOpenTests(t, ok, eq).
import { makePuzzle } from '../src/core/model.js';
import { setWallId, edgeId } from '../src/core/edges.js';
import { isSolved } from '../src/core/rules.js';
import { makeRng } from '../src/core/rng.js';
import { ringPath } from '../src/core/gen/hampath.js';
import { loopOpen, loopOpenMarks, CELL } from '../src/apps/play/board.js';
import { EN, ZH } from '../src/ui/i18n.js';

// A 4x4 loop puzzle with the numbers 1, 2, 3 at the 1st, 6th and 10th cell of `path`.
function loopOn(path) {
  const p = makePuzzle(4);
  p.loop = true;
  [0, 5, 9].forEach((at, i) => { p.cp[path[at]] = i + 1; });
  return p;
}
// a snake: it covers the board, but its last cell is 3 rows from its first
const SNAKE = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];

export function loopOpenTests(t, ok, eq) {
  t('loopOpen: a full path that does not close is open, a closed ring, a partial path and other puzzles are not', () => {
    const snake = loopOn(SNAKE);
    ok(loopOpen(snake, SNAKE), 'covers every cell, ends far from cell 1');
    ok(!isSolved(snake, SNAKE));
    ok(!loopOpen(snake, SNAKE.slice(0, 15)), 'one cell short: still being drawn');
    ok(!loopOpen(snake, []), 'nothing drawn');

    const ring = ringPath(4, makeRng(2));
    const closed = loopOn(ring);
    ok(isSolved(closed, ring), 'a ring through the numbers in order is solved');
    ok(!loopOpen(closed, ring), 'closed: nothing to report');

    const standard = makePuzzle(4);
    standard.cp[0] = 1; standard.cp[12] = 2;
    ok(!loopOpen(standard, SNAKE), 'only Loop puzzles have a ring');
  });

  t('loopOpen: a wall on the closing edge keeps a ring open', () => {
    const ring = ringPath(4, makeRng(2));
    const walled = loopOn(ring);
    setWallId(walled.walls, edgeId(4, ring[ring.length - 1], ring[0]), true);
    ok(!isSolved(walled, ring));
    ok(loopOpen(walled, ring));
  });

  t('loopOpenMarks: nothing unless open; then a ring on the last cell and one on cell 1', () => {
    const snake = loopOn(SNAKE);
    eq(loopOpenMarks(snake, SNAKE.slice(0, 15)), '');
    const marks = loopOpenMarks(snake, SNAKE);
    eq((marks.match(/<circle/g) || []).length, 2);
    // cell 12 (row 3, column 0) is the head, cell 0 the start
    ok(marks.includes(`cx="${CELL * 0.5}" cy="${CELL * 3.5}"`), 'on the last cell');
    ok(marks.includes(`cx="${CELL * 0.5}" cy="${CELL * 0.5}"`), 'on cell 1');
    eq(loopOpenMarks(makePuzzle(4), SNAKE), '', 'not a Loop puzzle');
  });

  t('the loop notes have a text in both languages', () => {
    for (const dict of [EN, ZH]) {
      for (const key of ['game.loopHint', 'game.loopOpen', 'game.loopClosed']) ok(dict[key], key);
    }
  });
}
