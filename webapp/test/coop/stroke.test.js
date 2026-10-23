import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle } from '../../src/core/model.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { changed, startStroke, strokeStep, undoStroke } from '../../src/coop/stroke.js';

// 4x4 board (see setup), numbers 1..4 on cells 0, 5, 10, 15, a wall between cells 1 and 2.
function setup() {
  const puzzle = makePuzzle(4);
  [0, 5, 10, 15].forEach((cell, i) => {
    puzzle.cp[cell] = i + 1;
  });
  puzzle.walls[1] |= 1;
  return createDrawing(puzzle);
}

const drawAll = (drawing, edges) => edges.forEach(([a, b]) => drawing.add(a, b));
const kinds = (drawing, stroke, cells) => cells.map(
  cell => strokeStep(drawing, stroke, cell).kind,
);

test('a drag draws a line per step, from any cell', () => {
  const drawing = setup();
  const stroke = startStroke(6);
  assert.deepEqual(kinds(drawing, stroke, [7, 11, 10]), ['add', 'add', 'add']);
  assert.deepEqual(drawing.edges(), [[6, 7], [7, 11], [10, 11]]);
  assert.equal(changed(stroke), true);
});

test('going back over the last line of the stroke takes it back', () => {
  const drawing = setup();
  const stroke = startStroke(6);
  assert.deepEqual(kinds(drawing, stroke, [7, 11, 7]), ['add', 'add', 'pop']);
  assert.deepEqual(drawing.edges(), [[6, 7]]);
  assert.equal(stroke.head, 7);
});

test('a refused step says why and leaves the head where it is', () => {
  const drawing = setup();
  const stroke = startStroke(1);
  assert.deepEqual(strokeStep(drawing, stroke, 2), { kind: 'blocked', reason: 'blocked' });
  assert.equal(stroke.head, 1);
  drawAll(drawing, [[10, 11], [11, 15]]);
  assert.deepEqual(strokeStep(drawing, startStroke(11), 7), { kind: 'blocked', reason: 'degree' });
});

test('cells that are not neighbours are ignored (a fast drag skipped a cell)', () => {
  const drawing = setup();
  const stroke = startStroke(6);
  assert.deepEqual(kinds(drawing, stroke, [15, 6, -1]), ['none', 'none', 'none']);
  assert.equal(stroke.head, 6);
});

test('backtracking from the end of a piece erases it, line by line', () => {
  const drawing = setup();
  drawAll(drawing, [[4, 5], [5, 6], [6, 7]]);
  const stroke = startStroke(7);
  assert.deepEqual(kinds(drawing, stroke, [6, 5]), ['retract', 'retract']);
  assert.deepEqual(drawing.edges(), [[4, 5]]);
  assert.equal(stroke.head, 5);
  assert.equal(changed(stroke), true);
  // from the new end the same drag goes on drawing, like the pen of the single-player game
  assert.deepEqual(kinds(drawing, stroke, [9]), ['add']);
});

test('a one-line piece is erased from either end, and the drag goes on from there', () => {
  const drawing = setup();
  drawing.add(8, 9);
  const stroke = startStroke(8);
  assert.deepEqual(kinds(drawing, stroke, [9, 10]), ['retract', 'add']);
  assert.deepEqual(drawing.edges(), [[9, 10]]);
});

test('along a line from inside a piece nothing is erased: the head follows, up to the end', () => {
  const drawing = setup();
  drawAll(drawing, [[4, 5], [5, 6], [6, 7]]);
  const stroke = startStroke(5);
  assert.deepEqual(kinds(drawing, stroke, [6, 7]), ['slide', 'slide']);
  assert.equal(drawing.count(), 3);
  // at the end of the piece, going back is backtracking
  assert.deepEqual(kinds(drawing, stroke, [6]), ['retract']);
  assert.deepEqual(drawing.edges(), [[4, 5], [5, 6]]);
});

test('joining two pieces and going on along the second one erases nothing', () => {
  const drawing = setup();
  drawing.add(10, 9);
  const stroke = startStroke(6);
  // 6-10 joins the piece at its end (10 now has two lines): the head then follows 10-9
  assert.deepEqual(kinds(drawing, stroke, [10, 9, 8]), ['add', 'slide', 'add']);
  assert.deepEqual(drawing.edges(), [[9, 10], [6, 10], [8, 9]]);
  // back over the new line (a pop), then the head stands on the end of the piece 6-10-9 again
  assert.deepEqual(kinds(drawing, stroke, [9, 10]), ['pop', 'retract']);
  assert.deepEqual(drawing.edges(), [[6, 10]]);
});

test('undoStroke takes back a whole stroke: its lines go, what it erased returns', () => {
  const drawing = setup();
  drawAll(drawing, [[4, 5], [5, 6]]);
  const stroke = startStroke(6);
  assert.deepEqual(kinds(drawing, stroke, [5, 4, 8]), ['retract', 'retract', 'add']);
  assert.deepEqual(drawing.edges(), [[4, 8]]);
  undoStroke(drawing, stroke);
  assert.deepEqual(drawing.edges().sort(), [[4, 5], [5, 6]]);
  assert.equal(drawing.degree(8), 0);
});

test('the lines of a stroke belong to its player', () => {
  const drawing = setup();
  kinds(drawing, startStroke(6, 1), [7, 11]);
  kinds(drawing, startStroke(8, 0), [9]);
  assert.equal(drawing.ownerOf(6, 7), 1);
  assert.equal(drawing.ownerOf(7, 11), 1);
  assert.equal(drawing.ownerOf(8, 9), 0);
  assert.equal(startStroke(3).player, 0);
});

test('erasing the other player\'s line is allowed; Undo gives it back to its owner', () => {
  const drawing = setup();
  kinds(drawing, startStroke(4, 1), [5, 6]);
  const mine = startStroke(6, 0);
  assert.deepEqual(kinds(drawing, mine, [5, 4]), ['retract', 'retract']);
  assert.equal(drawing.count(), 0);
  assert.deepEqual(mine.removed, [[6, 5, 1], [5, 4, 1]]);
  undoStroke(drawing, mine);
  assert.equal(drawing.ownerOf(4, 5), 1);
  assert.equal(drawing.ownerOf(5, 6), 1);
});

test('a drag leaving a Wrap-around board comes in on the other side', () => {
  const puzzle = makePuzzle(4);
  puzzle.wrap = true;
  const drawing = createDrawing(puzzle);
  const stroke = startStroke(2);
  assert.deepEqual(kinds(drawing, stroke, [3, 0, 1, 5, 9, 13, 1]), [
    'add', 'add', 'add', 'add', 'add', 'add', 'blocked']); // 13 to 1, across the seam: a cycle
  assert.deepEqual(drawing.edges().slice(0, 2), [[2, 3], [0, 3]]);
});

test('the head moves between two portals in one step, and nowhere else far', () => {
  const puzzle = makePuzzle(4);
  puzzle.portals = [[1, 14]];
  const drawing = createDrawing(puzzle);
  const stroke = startStroke(1);
  assert.equal(strokeStep(drawing, stroke, 13).kind, 'none');
  assert.equal(strokeStep(drawing, stroke, 14).kind, 'add');
  assert.equal(strokeStep(drawing, stroke, 1).kind, 'pop'); // back over the jump takes it back
  assert.deepEqual(drawing.edges(), []);
});
