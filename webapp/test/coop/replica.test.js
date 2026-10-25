import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { makePuzzle } from '../../src/core/model.js';
import { solutionOf } from '../../src/features/hints.js';
import { createReplica } from '../../src/coop/replica.js';

// 4x4, numbers 1..4 on cells 0, 5, 10, 15, no walls
function board() {
  const puzzle = makePuzzle(4);
  [0, 5, 10, 15].forEach((cell, i) => {
    puzzle.cp[cell] = i + 1;
  });
  return puzzle;
}

// Two replicas whose operations are held back until the test delivers them.
function pair(puzzle) {
  const toA = [];
  const toB = [];
  const rejectedA = [];
  const rejectedB = [];
  const a = createReplica(puzzle, {
    pid: 0, send: op => toB.push(op), onRejected: op => rejectedA.push(op),
  });
  const b = createReplica(puzzle, {
    pid: 1, send: op => toA.push(op), onRejected: op => rejectedB.push(op),
  });
  const deliver = (queue, target) => {
    while (queue.length) {
      target.receive(queue.shift());
    }
  };
  const sync = () => {
    deliver(toA, a);
    deliver(toB, b);
  };
  return { a, b, toA, toB, rejectedA, rejectedB, sync };
}

const view = replica => replica.edges()
  .map(([x, y]) => `${x}-${y}@${replica.ownerOf(x, y)}`)
  .sort();

test('lines drawn by one player reach the other, with their owner', () => {
  const { a, b, sync } = pair(board());
  assert.equal(a.add(1, 2), null);
  assert.equal(b.add(5, 6), null);
  sync();
  assert.deepEqual(view(a), ['1-2@0', '5-6@1']);
  assert.deepEqual(view(b), view(a));
  assert.equal(b.remove(1, 2), true); // anyone may erase anyone's line
  sync();
  assert.deepEqual(view(a), ['5-6@1']);
});

test('the rules apply to the combined drawing', () => {
  const { a, b, sync } = pair(board());
  a.add(1, 2);
  sync();
  b.add(2, 3);
  sync();
  assert.equal(a.add(2, 6), 'degree'); // cell 2 has the two lines of the two players
  assert.equal(b.add(1, 5), null);
  sync();
  assert.equal(a.add(3, 7), null);
  assert.equal(a.add(6, 7), null);
  sync();
  assert.deepEqual(view(a), view(b));
});

test('two lines that cannot both stand: the older stamp wins on both devices, once', () => {
  const { a, b, rejectedA, rejectedB, sync } = pair(board());
  a.add(1, 2); // clock 1, player 0
  a.add(2, 3); // clock 2: cell 2 has two lines now
  b.add(2, 6); // clock 1, player 1, at the same time: a third line into cell 2
  sync();
  // the stamps are (1,0) a 1-2, (1,1) b 2-6, (2,0) a 2-3: 2-3 comes last and is refused
  assert.deepEqual(view(a), ['1-2@0', '2-6@1']);
  assert.deepEqual(view(b), view(a));
  assert.deepEqual(rejectedA.map(op => [op.a, op.b]), [[2, 3]]);
  assert.deepEqual(rejectedB, []);
});

test('the result does not depend on the order or the number of deliveries', () => {
  const rnd = makeRng(31);
  const puzzle = board();
  const cells = 16;
  for (let trial = 0; trial < 150; trial++) {
    const sent = [];
    const a = createReplica(puzzle, { pid: 0, send: op => sent.push(op) });
    const b = createReplica(puzzle, { pid: 1, send: op => sent.push(op) });
    // both players draw and erase at random, without hearing from each other
    for (let step = 0; step < 14; step++) {
      const replica = rnd() < 0.5 ? a : b;
      const x = Math.floor(rnd() * cells);
      const y = rnd() < 0.5 ? x + 1 : x + 4;
      if (y < cells) {
        (rnd() < 0.75 ? replica.add(x, y) : replica.remove(x, y));
      }
    }
    // a third replica hears all operations in a random order, some twice
    const orders = [0, 1].map(() => shuffle([...sent, ...sent.filter(() => rnd() < 0.3)], rnd));
    const fresh = () => createReplica(puzzle, { pid: 7 });
    const [c, d] = [fresh(), fresh()];
    orders[0].forEach(op => c.receive(op));
    orders[1].forEach(op => d.receive(op));
    assert.deepEqual(view(c), view(d), `trial ${trial}`);
    // and the two players themselves end up with the same drawing after hearing each other
    sent.forEach(op => (op.pid === 0 ? b : a).receive(op));
    assert.deepEqual(view(a), view(b), `trial ${trial}`);
    assert.deepEqual(view(a), view(c), `trial ${trial}`);
  }
});

test('two players draw the whole solution, in pieces and at the same time: solved on both', () => {
  const rnd = makeRng(8);
  for (const n of [5, 6, 7]) {
    const puzzle = runSync(generate(n, 40 + n));
    const solution = solutionOf(puzzle);
    const { a, b, sync } = pair(puzzle);
    const edges = shuffle(solution.slice(1).map((cell, i) => [solution[i], cell]), rnd);
    edges.forEach(([x, y], i) => {
      assert.equal((i % 2 ? b : a).add(x, y), null);
      if (rnd() < 0.3) {
        sync();
      }
    });
    sync();
    assert.equal(a.solved(), true);
    assert.equal(b.solved(), true);
    assert.deepEqual(view(a), view(b));
  }
});

test('Clear erases only the lines of the player who clears', () => {
  const { a, b, sync } = pair(board());
  a.add(1, 2);
  b.add(5, 6);
  a.add(9, 10);
  sync();
  a.clear();
  sync();
  assert.deepEqual(view(b), ['5-6@1']);
  assert.deepEqual(view(a), ['5-6@1']);
});

test('malformed or foreign operations are ignored', () => {
  const replica = createReplica(board(), { pid: 0 });
  const good = { kind: 'add', a: 1, b: 2, owner: 1, clock: 1, pid: 1, seq: 0 };
  for (const bad of [null, {}, { ...good, kind: 'x' }, { ...good, a: 99 }, { ...good, b: -1 },
    { ...good, clock: 'z' }, { ...good, pid: 99 }, { ...good, owner: 99 }]) {
    assert.equal(replica.receive(bad), false);
  }
  assert.equal(replica.count(), 0);
  assert.equal(replica.receive(good), true);
  assert.equal(replica.receive(good), false); // a duplicate
  assert.equal(replica.count(), 1);
  assert.equal(replica.info().ops, 1);
});

test('ops() lists every operation, oldest first, as copies', () => {
  const a = createReplica(board(), { pid: 0 });
  a.add(0, 1);
  a.add(1, 2);
  a.remove(0, 1);
  const ops = a.ops();
  const shape = ops.map(op => [op.kind, op.a, op.b]);
  assert.deepEqual(shape, [['add', 0, 1], ['add', 1, 2], ['remove', 0, 1]]);
  ops[0].kind = 'x';
  assert.equal(a.ops()[0].kind, 'add', 'a copy: changing it changes nothing');
});

test('a device gets back its own operations that it lost, and does not reuse their numbers', () => {
  const puzzle = board();
  const before = createReplica(puzzle, { pid: 1 });
  before.add(0, 1);
  before.add(1, 2);
  const lost = before.ops();
  const restored = createReplica(puzzle, { pid: 1 });
  assert.equal(restored.receive(lost[0]), true, 'its own operation, unknown to it: taken');
  assert.equal(restored.receive(lost[1]), true);
  assert.equal(restored.receive(lost[1]), false, 'a duplicate');
  assert.deepEqual(restored.edges().map(String).sort(), before.edges().map(String).sort());
  const sent = [];
  const again = createReplica(puzzle, { pid: 1, send: op => sent.push(op) });
  lost.forEach(op => again.receive(op));
  again.add(2, 3);
  assert.deepEqual(sent.map(op => op.seq), [2], 'the next number follows the last one');
  assert.equal(again.count(), 3);
});

test('after a break both devices send everything: the drawings meet whatever each missed', () => {
  const puzzle = board();
  const { a, b } = pair(puzzle);
  a.add(0, 1);
  b.add(15, 14);
  a.add(1, 2); // none of it was delivered: the channel was down
  b.add(14, 13);
  b.ops().forEach(op => a.receive(op));
  a.ops().forEach(op => b.receive(op));
  assert.deepEqual(a.edges().map(String).sort(), b.edges().map(String).sort());
  assert.equal(a.count(), 4);
});
