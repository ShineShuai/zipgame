import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { generateLoop } from '../../src/core/gen/loop.js';
import { generateTwoPaths } from '../../src/core/gen/twopaths.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { coopHint } from '../../src/coop/hint.js';
import { solutionEdges } from '../../src/coop/model.js';

const puzzle = runSync(generate(6, 11));
const solution = solutionOf(puzzle);

test('an empty drawing: the hint is the first edge of the solution', () => {
  const hint = coopHint(puzzle, createDrawing(puzzle));
  assert.deepEqual(hint, { kind: 'next', edge: [solution[0], solution[1]] });
});

test('the hint skips the edges already drawn, wherever they are', () => {
  const drawing = createDrawing(puzzle);
  drawing.add(solution[0], solution[1]);
  drawing.add(solution[10], solution[11]);
  assert.deepEqual(coopHint(puzzle, drawing).edge, [solution[1], solution[2]]);
});

test('a drawn edge that is not part of the solution is reported first, oldest first', () => {
  const drawing = createDrawing(puzzle);
  const onSolution = new Set(solution.slice(1).map((cell, i) => drawing.key(solution[i], cell)));
  const cells = puzzle.n * puzzle.n;
  const wrong = [];
  for (let a = 0; a < cells && wrong.length < 2; a++) {
    for (const b of [a + 1, a + puzzle.n]) {
      const sideways = b % puzzle.n === 0 && b === a + 1;
      const fresh = !onSolution.has(drawing.key(a, b));
      if (b < cells && !sideways && fresh && drawing.check(a, b) === null) {
        wrong.push([a, b]);
        drawing.add(a, b);
        break;
      }
    }
  }
  assert.ok(wrong.length >= 1);
  assert.deepEqual(coopHint(puzzle, drawing), { kind: 'wrong', edge: wrong[0] });
});

test('nothing to hint once the solution is drawn', () => {
  const drawing = createDrawing(puzzle);
  solution.slice(1).forEach((cell, i) => drawing.add(solution[i], cell));
  assert.equal(drawing.solved(), true);
  assert.deepEqual(coopHint(puzzle, drawing), { kind: 'none', edge: null });
});

test('Loop: the line that closes the ring is part of the solution, and the last hint', () => {
  const ring = runSync(generateLoop(6, 3));
  const edges = solutionEdges(ring);
  assert.equal(edges.length, 36); // as many lines as cells
  const drawing = createDrawing(ring);
  edges.slice(0, -1).forEach(([a, b]) => assert.equal(drawing.add(a, b), null));
  assert.deepEqual(coopHint(ring, drawing), { kind: 'next', edge: edges[35] });
  assert.equal(drawing.add(...edges[35]), null);
  assert.equal(coopHint(ring, drawing).kind, 'none');
});

test('Two paths: the bridge between the paths is no line, so no hint asks for it', () => {
  const two = runSync(generateTwoPaths(5, 2));
  const edges = solutionEdges(two);
  assert.equal(edges.length, 23); // 25 cells, two paths
  const path = solutionOf(two);
  const bridge = [path.indexOf(two.cp.indexOf(two.split)) ].filter(at => at >= 0);
  assert.equal(bridge.length, 1);
  const [at] = bridge;
  const isBridge = ([a, b]) => a === path[at] && b === path[at + 1];
  assert.equal(edges.some(isBridge), false);
  const drawing = createDrawing(two);
  edges.forEach(([a, b]) => assert.equal(drawing.add(a, b), null));
  assert.equal(coopHint(two, drawing).kind, 'none');
  assert.equal(drawing.solved(), true);
});
