import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { maxNumber } from '../../src/core/model.js';
import { solutionOf } from '../../src/features/hints.js';
import { createDrawing } from '../../src/coop/drawing.js';
import { PLAYER_COLORS, boardMarkup, edgeMiddle } from '../../src/coop/view.js';

const puzzle = runSync(generate(6, 3));
const solution = solutionOf(puzzle);
const count = (text, pattern) => (text.match(pattern) || []).length;

test('the board has a badge per number and a line per drawn edge', () => {
  const drawing = createDrawing(puzzle);
  const empty = boardMarkup(puzzle, drawing);
  assert.equal(count(empty, /data-num-cell=/g), maxNumber(puzzle));
  const lines = text => count(
    text.slice(text.indexOf('data-role="lines"')).split('</g>')[0],
    /<line /g,
  );
  assert.equal(lines(empty), 0);
  drawing.add(solution[0], solution[1]);
  drawing.add(solution[5], solution[6]);
  assert.equal(lines(boardMarkup(puzzle, drawing)), 2);
});

test('a number is filled once a line touches its cell', () => {
  const drawing = createDrawing(puzzle);
  const before = boardMarkup(puzzle, drawing);
  drawing.add(solution[0], solution[1]);
  const after = boardMarkup(puzzle, drawing);
  assert.notEqual(before, after);
  assert.ok(after.includes('var(--b-num-on)'));
  assert.ok(!before.includes('var(--b-num-on)'));
});

test('a hint is drawn at the middle of its edge: a cross when wrong, a ring when next', () => {
  const drawing = createDrawing(puzzle);
  const [a, b] = [solution[0], solution[1]];
  const next = boardMarkup(puzzle, drawing, { kind: 'next', edge: [a, b] });
  const wrong = boardMarkup(puzzle, drawing, { kind: 'wrong', edge: [a, b] });
  assert.ok(next.includes('data-role="hint"'));
  assert.ok(wrong.includes('data-role="hint-wrong"'));
  assert.ok(!boardMarkup(puzzle, drawing, null).includes('data-role="hint'));
  const [x, y] = edgeMiddle(puzzle.n, a, b);
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test('lines are drawn in the colour of the player who drew them', () => {
  const drawing = createDrawing(puzzle);
  drawing.add(solution[0], solution[1], 0);
  drawing.add(solution[5], solution[6], 1);
  drawing.add(solution[6], solution[7], 1);
  const markup = boardMarkup(puzzle, drawing);
  const group = player => markup.match(
    new RegExp(`data-player="${player}"[^>]*>((?:<line [^>]*>)*)</g>`),
  );
  assert.equal(count(group(0)[1], /<line /g), 1);
  assert.equal(count(group(1)[1], /<line /g), 2);
  assert.ok(markup.includes(`data-player="0" stroke="${PLAYER_COLORS[0]}"`));
  assert.ok(markup.includes(`data-player="1" stroke="${PLAYER_COLORS[1]}"`));
  assert.notEqual(PLAYER_COLORS[0], PLAYER_COLORS[1]);
});
