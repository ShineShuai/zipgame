// The reference search of test/oracle.js, against numbers worked out by hand and against its own
// two views of the rules: a test that compares the solver with it is only as good as it is.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomPathPuzzle } from '../../src/core/gen/generate.js';
import { makePuzzle } from '../../src/core/model.js';
import { makeRng } from '../../src/core/rng.js';
import { FAST } from '../harness.js';
import { closes, gridMoves, keysOf, oracle, ruleMoves } from '../oracle.js';
import { randPuzzle } from './helpers.js';

// An n x n board with numbers on the given cells: { cell: number }.
const board = (n, numbers) => {
  const p = makePuzzle(n);
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[Number(cell)] = number;
  }
  return p;
};
const count = (p, options = {}) => oracle(p, { moves: gridMoves(p), ...options }).count;

test('oracle: a 3x3 board from corner to corner has the two snakes; a wall leaves one', () => {
  const p = board(3, { 0: 1, 8: 2 });
  assert.deepEqual(keysOf(oracle(p, { moves: gridMoves(p) })), [
    '0,1,2,5,4,3,6,7,8',
    '0,3,6,7,4,1,2,5,8',
  ]);
  const right = board(3, { 0: 1, 8: 2 });
  right.walls[0] |= 1; // between cells 0 and 1: only the snake that starts downwards
  assert.deepEqual(keysOf(oracle(right, { moves: gridMoves(right) })), ['0,3,6,7,4,1,2,5,8']);
  const both = board(3, { 0: 1, 8: 2 });
  both.walls[0] |= 1;
  both.walls[0] |= 2;
  assert.equal(count(both), 0, 'a corner with no way out');
});

test('oracle: numbers are visited in order; a number as a step is the step it is taken on', () => {
  const nine = (numbers, options) => count(board(3, numbers), options);
  assert.equal(nine({ 0: 1, 4: 2, 8: 3 }), 2, 'the centre before the end: both snakes');
  const spirals = board(3, { 0: 1, 8: 2, 4: 3 }); // the centre after the end: the two spirals
  assert.deepEqual(keysOf(oracle(spirals, { moves: gridMoves(spirals) })), [
    '0,1,2,5,8,7,6,3,4',
    '0,3,6,7,8,5,2,1,4',
  ]);
  assert.equal(nine({ 0: 1, 4: 5, 8: 9 }, { numbers: 'step' }), 2, 'steps 1, 5, 9');
  assert.equal(nine({ 0: 1, 3: 5, 8: 9 }, { numbers: 'step' }), 0, 'cell 3 is step 2 or 6');
  assert.equal(nine({ 0: 1, 4: 6, 8: 9 }, { numbers: 'step' }), 0, 'the centre is step 5');
});

test('oracle: a ring closes: none on a 3x3, 12 directed ones through a corner of a 4x4', () => {
  const odd = board(3, { 0: 1 });
  assert.equal(count(odd, { endOnLast: false, accept: closes(odd) }), 0, 'odd: no ring');
  const even = board(4, { 0: 1 });
  // 6 Hamiltonian cycles of the 4x4 grid, each walked in two directions
  assert.equal(count(even, { endOnLast: false, accept: closes(even) }), 12);
  assert.equal(count(even, { endOnLast: true, accept: closes(even) }), 0, 'K=1 is not last');
});

test('oracle: count only keeps no paths, and the same count', () => {
  const p = board(3, { 0: 1, 8: 2 });
  const counted = oracle(p, { moves: gridMoves(p), keep: false });
  assert.deepEqual([counted.count, counted.paths], [2, []]);
});

// A puzzle with a planted path and walls off it, so that it has at least one solution.
const planted = (seed, n, K, wallFrac) => {
  const rnd = makeRng(seed);
  const p = randomPathPuzzle(n, K, rnd);
  const used = new Set();
  p.path.slice(1).forEach((cell, i) => {
    const from = p.path[i];
    used.add(`${Math.min(from, cell)}:${Math.abs(from - cell) === 1 ? 1 : 2}`);
  });
  for (let cell = 0; cell < n * n; cell++) {
    for (const [bit, inside] of [
      [1, cell % n < n - 1],
      [2, cell < n * (n - 1)],
    ]) {
      if (inside && !used.has(`${cell}:${bit}`) && rnd() < wallFrac) {
        p.walls[cell] |= bit;
      }
    }
  }
  return p;
};

test('oracle: the rules written out here and the rules of core/rules.js agree', FAST, () => {
  let solvable = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const n = 3 + (seed % 2);
    const K = 2 + (seed % 4);
    const p =
      seed % 2 ? planted(seed, n, K, 0.1 * (seed % 5)) : randPuzzle(seed, n, K, 0.15 * (seed % 4));
    const mine = oracle(p, { moves: gridMoves(p) });
    const theirs = oracle(p, { moves: ruleMoves(p) });
    assert.deepEqual(keysOf(mine), keysOf(theirs), `seed ${seed}`);
    solvable += mine.count > 0 ? 1 : 0;
  }
  assert.ok(solvable >= 30, `${solvable} of 60 puzzles have a solution`);
});
