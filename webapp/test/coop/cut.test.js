import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle } from '../../src/core/model.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { edgeAt } from '../../src/coop/cut.js';

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
