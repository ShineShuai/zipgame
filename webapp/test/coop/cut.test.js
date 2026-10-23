import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL } from '../../src/apps/play/board.js';
import { makePuzzle } from '../../src/core/model.js';
import { makeSurfacePuzzle, topologyOf } from '../../src/core/surface/puzzle.js';
import { SLOTS } from '../../src/core/surface/topology.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { edgeAt } from '../../src/coop/cut.js';
import { edgeMiddleOf } from '../../src/coop/layout.js';

// 4x4 board; cell (column c, row r) is cell 4r + c and covers [c, c+1) x [r, r+1).
const drawn = edges => {
  const drawing = createDrawing(makePuzzle(4));
  edges.forEach(([a, b]) => drawing.add(a, b));
  return drawing;
};

test('a press on a line, between its two cells, points at that line', () => {
  const drawing = drawn([[5, 6], [6, 7], [10, 14]]);
  assert.deepEqual(edgeAt(drawing, 2.0, 1.5), [5, 6]); // the border of cells 5 and 6
  assert.deepEqual(edgeAt(drawing, 3.0, 1.5), [6, 7]);
  assert.deepEqual(edgeAt(drawing, 2.5, 3.0), [10, 14]); // vertical line, between rows 2 and 3
});

test('a press near a line (within the reach) points at it, one farther away at nothing', () => {
  const drawing = drawn([[5, 6]]);
  assert.deepEqual(edgeAt(drawing, 2.0, 1.5 + 0.25), [5, 6]);
  assert.equal(edgeAt(drawing, 2.0, 1.5 + 0.4), null);
  assert.equal(edgeAt(drawing, 0.5, 0.5), null);
  assert.equal(edgeAt(drawn([]), 2.0, 1.5), null);
});

test('the line ends at the cell centres: a press beyond them is not on the line', () => {
  const drawing = drawn([[5, 6]]);
  assert.deepEqual(edgeAt(drawing, 1.5, 1.5), [5, 6]); // on the centre of cell 5
  assert.equal(edgeAt(drawing, 0.9, 1.5), null); // 0.6 beyond the centre
});

test('at a cell centre, where two lines meet, the line whose middle is nearer wins', () => {
  const drawing = drawn([[5, 6], [5, 9]]);
  assert.deepEqual(edgeAt(drawing, 1.5 + 0.2, 1.5 + 0.05), [5, 6]); // right of the centre
  assert.deepEqual(edgeAt(drawing, 1.5 + 0.05, 1.5 + 0.2), [5, 9]); // below it
});

test('the nearest of several lines wins', () => {
  const drawing = drawn([[5, 6], [9, 10]]);
  assert.deepEqual(edgeAt(drawing, 2.0, 2.45), [9, 10]);
  assert.deepEqual(edgeAt(drawing, 2.0, 1.55), [5, 6]);
});

test('a press on the stub of a seam points at that line, not at the chord across the board', () => {
  const puzzle = makePuzzle(4);
  puzzle.wrap = true;
  const drawing = createDrawing(puzzle);
  drawing.add(7, 4); // across the right seam of row 1
  assert.deepEqual(edgeAt(drawing, 3.9, 1.5), [4, 7]); // the stub out of cell 7
  assert.deepEqual(edgeAt(drawing, 0.1, 1.5), [4, 7]); // the stub into cell 4
  assert.equal(edgeAt(drawing, 2.0, 1.5), null); // the middle of the row: no line there
});

test('a press on a jump points at it; the chord between the portals is no line', () => {
  const puzzle = makePuzzle(4);
  puzzle.portals = [[1, 14]];
  const drawing = createDrawing(puzzle);
  drawing.add(1, 14);
  const [x, y] = edgeMiddleOf(puzzle, 1, 14);
  assert.deepEqual(edgeAt(drawing, x, y), [1, 14]);
  assert.equal(edgeAt(drawing, 2, 2), null);
});

test('a press on a line of a Pentagon board points at it (units of CELL)', () => {
  const puzzle = makeSurfacePuzzle('pentagon', 6);
  const drawing = createDrawing(puzzle);
  const next = topologyOf(puzzle).nb[7 * SLOTS]; // a neighbour of cell 7
  assert.equal(drawing.add(7, next), null);
  const [x, y] = edgeMiddleOf(puzzle, 7, next, CELL);
  assert.deepEqual(edgeAt(drawing, x, y, 0.3 * CELL, CELL), [Math.min(7, next), Math.max(7, next)]);
  assert.equal(edgeAt(drawing, x + 3 * CELL, y, 0.3 * CELL, CELL), null);
});
