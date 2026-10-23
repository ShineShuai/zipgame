import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_SIZES } from '../../src/core/gen/generate.js';
import { ARROW_SIZES } from '../../src/core/gen/arrows.js';
import { EXACT_SIZES } from '../../src/core/gen/exact.js';
import { parse, serialize } from '../../src/core/format.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
import { createDrawing, unsupported } from '../../src/coop/drawing.js';
import {
  COOP_VARIANTS, nearestSize, sizesFor, statKey, variantById, variantOf,
} from '../../src/coop/variants.js';

test('the sizes on offer: every size, except Exact and arrows, which keep to their own', () => {
  assert.deepEqual(sizesFor('standard'), PLAY_SIZES);
  assert.deepEqual(sizesFor('cutout'), PLAY_SIZES);
  assert.deepEqual(sizesFor('exact'), PLAY_SIZES.filter(n => EXACT_SIZES.includes(n)));
  assert.ok(!sizesFor('exact').includes(16));
  assert.deepEqual(sizesFor('arrows'), PLAY_SIZES.filter(n => ARROW_SIZES.includes(n)));
  assert.deepEqual(sizesFor('no such type'), PLAY_SIZES); // falls back to standard
});

test('nearestSize: the offered size closest to the one chosen, the smaller one on a tie', () => {
  assert.equal(nearestSize(16, [5, 6, 7, 8, 9, 10, 11, 12]), 12);
  assert.equal(nearestSize(7, [5, 6, 7]), 7);
  assert.equal(nearestSize(6, [5, 7]), 5);
});

test('statistics keys: standard keeps the plain size, other types are told apart', () => {
  assert.equal(statKey({ n: 7 }, false), '7');
  assert.equal(statKey({ n: 7 }, true), '7x2');
  assert.equal(statKey({ n: 7, holes: [] }, false), 'cutout-7');
  assert.equal(statKey({ n: 8, exact: true }, true), 'exact-8x2');
  assert.equal(statKey({ n: 6, arrows: [] }, false), 'arrows-6');
});

for (const variant of COOP_VARIANTS) {
  test(`${variant.id}: its generator makes a puzzle Free draw plays, over the wire too`, () => {
    const n = variant.sizes()[0];
    const puzzle = runSync(variant.generate(n, 3));
    assert.equal(unsupported(puzzle), null);
    assert.equal(variantOf(puzzle), variant.id);
    assert.equal(variantById(variantOf(puzzle)), variant);
    // what the host sends is read back by the guest: same board, same solution
    const copy = parse(serialize(puzzle, { path: solutionOf(puzzle) }));
    assert.equal(variantOf(copy), variant.id);
    assert.deepEqual([...copy.cp], [...puzzle.cp]);
    const holes = puzzle.holes ? [...puzzle.holes] : null;
    assert.deepEqual(copy.holes ? [...copy.holes] : null, holes);
    const path = solutionOf(puzzle);
    const drawing = createDrawing(copy);
    path.slice(1).forEach((cell, i) => assert.equal(drawing.add(path[i], cell), null));
    assert.equal(drawing.solved(), true);
  });
}
