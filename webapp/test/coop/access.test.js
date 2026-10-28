import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstShown, hasSolidTab, isShown, levelOf, offeredSizes,
} from '../../src/coop/access.js';
import { FLAT_IDS, isSolidId, SOLID_IDS, sizesFor } from '../../src/coop/variants.js';

const INFO = {
  access: { standard: 'all', cutout: 'none', tetra: 'part', cube: 'none', ball: 'none' },
  sizes: { tetra: [4] },
  solid: true,
};

test('without a menu to ask nothing is locked', () => {
  assert.equal(levelOf(null, 'cutout'), 'all');
  assert.ok(isShown(null, 'cutout'));
  assert.ok(hasSolidTab(null));
  assert.deepEqual(offeredSizes(null, 'cube'), sizesFor('cube'));
});

test('a type the menu does not list is locked', () => {
  assert.equal(levelOf(INFO, 'standard'), 'all');
  assert.equal(levelOf(INFO, 'cutout'), 'none');
  assert.equal(levelOf(INFO, 'wrap'), 'none');
});

test('a locked type shows while revealed or once picked, an open one always', () => {
  assert.ok(isShown(INFO, 'standard') && isShown(INFO, 'tetra'));
  assert.ok(!isShown(INFO, 'cutout'));
  assert.ok(isShown(INFO, 'cutout', { revealed: true }));
  assert.ok(isShown(INFO, 'cutout', { held: new Set(['cutout']) }));
});

test('the 3D tab: when a solid is on offer, while revealed, or once a solid is picked', () => {
  const none = { ...INFO, solid: false };
  assert.ok(hasSolidTab(INFO));
  assert.ok(!hasSolidTab(none));
  assert.ok(hasSolidTab(none, { revealed: true }));
  assert.ok(hasSolidTab(none, { held: new Set(['cube']) }));
  assert.ok(!hasSolidTab(none, { held: new Set(['cutout']) }));
});

test('a type open in part keeps to its open sizes, until revealed', () => {
  assert.deepEqual(offeredSizes(INFO, 'tetra'), [4]);
  assert.deepEqual(offeredSizes(INFO, 'tetra', true), sizesFor('tetra'));
  assert.deepEqual(offeredSizes(INFO, 'cube'), sizesFor('cube'));
  const stale = { ...INFO, sizes: { tetra: [99] } };
  assert.deepEqual(offeredSizes(stale, 'tetra'), sizesFor('tetra'), 'sizes that do not exist: all');
});

test('the type to start from is the one asked for if shown, else the first that is', () => {
  assert.equal(firstShown(FLAT_IDS, 'standard', INFO, {}), 'standard');
  assert.equal(firstShown(FLAT_IDS, 'cutout', INFO, {}), 'standard');
  assert.equal(firstShown(FLAT_IDS, 'cutout', INFO, { revealed: true }), 'cutout');
  assert.equal(firstShown(SOLID_IDS, 'ball', INFO, {}), 'tetra');
});

test('the solids are the three of the play app, the rest is flat', () => {
  assert.deepEqual(SOLID_IDS, ['tetra', 'cube', 'ball']);
  assert.ok(SOLID_IDS.every(isSolidId) && FLAT_IDS.every(id => !isSolidId(id)));
  assert.equal(FLAT_IDS[0], 'standard');
});
