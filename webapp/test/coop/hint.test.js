import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { coopHint } from '../../src/coop/hint.js';

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
