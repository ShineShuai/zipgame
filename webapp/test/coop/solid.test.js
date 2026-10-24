import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePentagon } from '../../src/core/gen/pentagon.js';
import { runSync } from '../../src/core/run.js';
import { topologyOf } from '../../src/core/surface/puzzle.js';
import { cellDirection, turn } from '../../src/view/proj.js';
import { createDrawing } from '../../src/coop/drawing.js';
import {
  IDENTITY, isSolid, layoutsFor, solidBoard, startRotation, turnBy, turnByKey, turnable,
} from '../../src/coop/solid.js';
import { COOP_VARIANTS } from '../../src/coop/variants.js';
import { solutionFor } from '../../src/coop/model.js';

const make = async (id, n = 2, seed = 3) => {
  const variant = COOP_VARIANTS.find(candidate => candidate.id === id);
  await variant.ready?.();
  return runSync(variant.generate(n, seed));
};
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('only the tetra, the cube and the ball are solids', async () => {
  for (const id of ['tetra', 'cube', 'ball']) {
    assert.equal(isSolid(await make(id)), true, id);
  }
  assert.equal(isSolid(runSync(generatePentagon(4, 1))), false);
  assert.equal(isSolid({ n: 5, cp: [] }), false);
});

test('the solid starts turned so that cell 1 faces the player', async () => {
  for (const id of ['tetra', 'cube', 'ball']) {
    const puzzle = await make(id);
    const top = topologyOf(puzzle);
    const facing = turn(startRotation(puzzle), cellDirection(top, puzzle.cp.indexOf(1)))[2];
    assert.ok(facing > 0.99, `${id}: ${facing}`);
  }
});

test('turning: a drag or an arrow key changes the rotation; a cube turns in 3D only', async () => {
  const cube = await make('cube');
  const turned = turnBy(IDENTITY, 30, 10);
  assert.notDeepEqual(turned, IDENTITY);
  assert.notDeepEqual(turnByKey(IDENTITY, 'ArrowLeft'), IDENTITY);
  assert.equal(turnable(cube, '3d'), true);
  assert.equal(turnable(cube, 'net'), false);
  assert.equal(turnable({ kind: 'ball' }, 'net'), true); // both views of a ball turn
});

test('the pictures: a cube is the solid with an inset net, or the net; a ball two', async () => {
  const cube = await make('cube');
  const rotation = startRotation(cube);
  const solid = layoutsFor(cube, '3d', rotation);
  assert.equal(solid.main.length, 1);
  assert.ok(solid.inset);
  const net = layoutsFor(cube, 'net', rotation);
  assert.equal(net.main.length, 1);
  assert.equal(net.inset, null);
  const ball = await make('ball');
  assert.equal(layoutsFor(ball, '3d', startRotation(ball)).main.length, 1);
  assert.ok(layoutsFor(ball, '3d', startRotation(ball)).inset);
  assert.equal(layoutsFor(ball, 'net', startRotation(ball)).main.length, 2); // the Map: two halves
});

test('the board: a cell per polygon, the drawn lines, the hint mark', async () => {
  const cube = await make('cube');
  const drawing = createDrawing(cube);
  const path = solutionFor(cube);
  const options = { view: 'net', rotation: startRotation(cube) };
  const empty = solidBoard(cube, drawing, options);
  assert.equal(count(empty.html, /data-cell=/g), 24);
  assert.equal(count(empty.html, /data-role="lines"/g), 0);
  assert.equal(empty.layouts.length, 1);
  assert.equal(empty.frames.length, 1);
  assert.equal(drawing.add(path[0], path[1]), null);
  const drawn = solidBoard(cube, drawing, options);
  assert.ok(count(drawn.html, /<polyline class="sf-path"/g) >= 1);
  assert.equal(count(drawn.html, /data-role="lines"/g), 1);
  const edge = [path[1], path[2]];
  const next = solidBoard(cube, drawing, { ...options, hint: { kind: 'next', edge } });
  assert.equal(count(next.html, /data-mark="hint"/g), 1);
  assert.equal(count(next.html, /class="sf-hint"/g), 1);
  const wrong = solidBoard(cube, drawing, { ...options, hint: { kind: 'wrong', edge } });
  assert.equal(count(wrong.html, /class="sf-wrong"/g), 1);
});
