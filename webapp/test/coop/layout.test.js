import test from 'node:test';
import assert from 'node:assert/strict';
import { SEAM_STUB, WRAP_PAD } from '../../src/view/geometry.js';
import {
  edgeMiddleOf, edgeSegments, jumpCurve, padOf,
} from '../../src/coop/layout.js';

const plain = { n: 4 };
const wrap = { n: 4, wrap: true };
const portals = { n: 4, portals: [[1, 14]] };

test('a plain edge is one chord between the cell centres', () => {
  assert.deepEqual(edgeSegments(plain, 5, 6), [[1.5, 1.5, 2.5, 1.5]]);
  assert.deepEqual(edgeSegments(wrap, 5, 6), [[1.5, 1.5, 2.5, 1.5]]);
  assert.deepEqual(edgeMiddleOf(wrap, 5, 9), [1.5, 2]);
});

test('an edge across a seam is two stubs: out at one border, in at the other', () => {
  const out = 4 + SEAM_STUB;
  const into = -SEAM_STUB;
  assert.deepEqual(edgeSegments(wrap, 7, 4), [[3.5, 1.5, out, 1.5], [into, 1.5, 0.5, 1.5]]);
  assert.deepEqual(edgeSegments(wrap, 4, 7), [[0.5, 1.5, into, 1.5], [out, 1.5, 3.5, 1.5]]);
  assert.deepEqual(edgeSegments(wrap, 13, 1), [[1.5, 3.5, 1.5, out], [1.5, into, 1.5, 0.5]]);
  // a mark goes on the stub of the first cell named
  assert.deepEqual(edgeMiddleOf(wrap, 7, 4), [(3.5 + out) / 2, 1.5]);
});

test('the margin of a Wrap-around board is the play app\'s; other boards have none', () => {
  assert.equal(padOf(wrap), WRAP_PAD);
  assert.equal(padOf(plain), 0);
  assert.equal(padOf(portals), 0);
});

test('a jump is a curve between the portals, the same whichever way round it is named', () => {
  assert.deepEqual(jumpCurve(4, 1, 14), jumpCurve(4, 14, 1));
  const { from, to } = jumpCurve(4, 14, 1);
  assert.deepEqual(from, [1.5, 0.5]);
  assert.deepEqual(to, [2.5, 3.5]);
  const pieces = edgeSegments(portals, 14, 1);
  assert.equal(pieces.length > 4, true);
  assert.deepEqual(pieces[0].slice(0, 2), from);
  assert.deepEqual(pieces.at(-1).slice(2), to);
  pieces.slice(1).forEach((piece, i) => assert.deepEqual(piece.slice(0, 2), pieces[i].slice(2)));
});

test('a mark on a jump sits on the curve, off the chord that would cross other cells', () => {
  const [x, y] = edgeMiddleOf(portals, 1, 14);
  const [mx, my] = [2, 2]; // the middle of the chord
  assert.ok(Math.hypot(x - mx, y - my) > 0.3);
  const { via } = jumpCurve(4, 1, 14);
  assert.ok(Math.abs(x - (mx + via[0]) / 2) < 1e-9 && Math.abs(y - (my + via[1]) / 2) < 1e-9);
});
