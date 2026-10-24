import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { generatePentagon } from '../../src/core/gen/pentagon.js';
import { generateTwoPaths } from '../../src/core/gen/twopaths.js';
import { generateTeleport } from '../../src/core/gen/teleport.js';
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

test('a Wrap-around board has a margin and a dashed outline; a seam is two stubs', () => {
  const wrap = runSync(generate(5, 2, { wrap: true }));
  const drawing = createDrawing(wrap);
  const empty = boardMarkup(wrap, drawing);
  assert.match(empty, /viewBox="-\d+(\.\d+)? -\d+/);
  assert.ok(empty.includes('data-role="outline"'));
  assert.ok(empty.includes('class="zip-svg coop-svg wrap"'));
  drawing.add(4, 0); // the right seam of row 0
  const lines = text => count(
    text.slice(text.indexOf('data-role="lines"')).split('</g>')[0],
    /<line /g,
  );
  assert.equal(lines(boardMarkup(wrap, drawing)), 2);
});

test('a Teleport board shows its portals; a jump is one dotted curve; the partner pulses', () => {
  const tele = runSync(generateTeleport(6, 2));
  const drawing = createDrawing(tele);
  const inLines = text => count(
    text.slice(text.indexOf('data-role="lines"')).split('</g>')[0],
    /<line /g,
  );
  const [a, b] = tele.portals[0];
  const text = boardMarkup(tele, drawing);
  assert.equal(count(text, /data-portal-cell=/g), 2);
  assert.ok(text.includes('class="zip-svg coop-svg teleport"'));
  assert.equal(count(text, /data-mark="jump"/g), 0);
  drawing.add(a, b);
  assert.equal(count(boardMarkup(tele, drawing), /data-mark="jump"/g), 1);
  assert.equal(inLines(boardMarkup(tele, drawing)), 0);
  const ring = boardMarkup(tele, createDrawing(tele), null, { cell: b, player: 1 });
  assert.equal(count(ring, /data-mark="jump-ready"/g), 1);
  const none = boardMarkup(tele, createDrawing(tele));
  assert.equal(count(none, /data-mark="jump-ready"/g), 0);
});

test('a Pentagon board has a tile per cell, a badge per number and a line per drawn edge', () => {
  const pentagon = runSync(generatePentagon(6, 2));
  const drawing = createDrawing(pentagon);
  const text = boardMarkup(pentagon, drawing);
  assert.ok(text.includes('class="zip-svg coop-svg pentagon"'));
  assert.equal(count(text, /<polygon /g), 36);
  assert.equal(count(text, /data-num-cell=/g), maxNumber(pentagon));
  const inLines = markup => count(
    markup.slice(markup.indexOf('data-role="lines"')).split('</g>')[0],
    /<line /g,
  );
  assert.equal(inLines(text), 0);
  const path = solutionOf(pentagon);
  drawing.add(path[0], path[1]);
  drawing.add(path[4], path[5]);
  assert.equal(inLines(boardMarkup(pentagon, drawing)), 2);
  const hint = boardMarkup(pentagon, drawing, { kind: 'next', edge: [path[1], path[2]] });
  assert.ok(hint.length > text.length);
});

test('a Two paths board: red numbers are circles, blue ones rounded squares counted from 1', () => {
  const two = runSync(generateTwoPaths(6, 2));
  const text = boardMarkup(two, createDrawing(two));
  const reds = count(text, /data-colour="0"/g);
  const blues = count(text, /data-colour="1"/g);
  assert.equal(reds, two.split);
  assert.equal(blues, maxNumber(two) - two.split);
  const badges = text.slice(text.indexOf('data-num-cell'));
  assert.equal(count(badges, /<rect /g), blues);
  assert.ok(badges.includes('>1</text>'));
  // a standard board has neither
  const standard = boardMarkup(runSync(generate(6, 2)), createDrawing(runSync(generate(6, 2))));
  assert.equal(count(standard, /data-colour=/g), 0);
});
