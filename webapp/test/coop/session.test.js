import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { solutionOf } from '../../src/features/hints.js';
import { GUEST, HOST, createSession } from '../../src/coop/session.js';
import { fakePair } from './fake-channel.js';

function connect() {
  const wire = fakePair();
  const events = { host: [], guest: [] };
  const host = createSession({ role: 'host', channel: wire.a, onEvent: e => events.host.push(e) });
  const guest = createSession({
    role: 'guest', channel: wire.b, onEvent: e => events.guest.push(e),
  });
  return { wire, host, guest, events };
}
const types = list => list.map(event => event.type);

test('hello, puzzle, ready, start: the same puzzle on both sides, and a started game', () => {
  const { wire, host, guest, events } = connect();
  host.hello();
  guest.hello();
  wire.flush();
  assert.deepEqual(events.host[0], { type: 'peer', compatible: true });
  assert.deepEqual(events.guest[0], { type: 'peer', compatible: true });
  const puzzle = runSync(generate(6, 5));
  host.newGame(puzzle, 5);
  wire.flush();
  assert.deepEqual(types(events.guest), ['peer', 'puzzle', 'start']);
  assert.deepEqual(types(events.host), ['peer', 'start']);
  const got = events.guest[1].puzzle;
  assert.equal(got.n, 6);
  assert.deepEqual([...got.cp], [...puzzle.cp]);
  assert.deepEqual([...got.walls], [...puzzle.walls]);
  assert.deepEqual(got.path, puzzle.path);
  assert.equal(got.seed, 5);
  assert.equal(host.pid, HOST);
  assert.equal(guest.pid, GUEST);
});

test('a different protocol version is reported', () => {
  const wire = fakePair();
  const seen = [];
  createSession({ role: 'guest', channel: wire.b, onEvent: e => seen.push(e) });
  wire.a.send(JSON.stringify({ t: 'hello', v: 99 }));
  wire.flush();
  assert.deepEqual(seen, [{ type: 'peer', compatible: false }]);
});

test('lines drawn on one side appear on the other; the two draw the solution together', () => {
  const rnd = makeRng(3);
  const { wire, host, guest } = connect();
  const puzzle = runSync(generate(6, 9));
  const mineReplica = host.newGame(puzzle, 9);
  wire.flush();
  const theirReplica = guest.replica;
  const solution = solutionOf(puzzle);
  const edges = shuffle(solution.slice(1).map((cell, i) => [solution[i], cell]), rnd);
  edges.forEach(([a, b], i) => {
    assert.equal((i % 3 === 0 ? theirReplica : mineReplica).add(a, b), null);
    if (rnd() < 0.4) {
      wire.step(rnd() < 0.5 ? 'a' : 'b'); // some messages arrive while the players still draw
    }
  });
  wire.flush();
  assert.equal(mineReplica.solved(), true);
  assert.equal(theirReplica.solved(), true);
  const owners = edges.map(([a, b]) => mineReplica.ownerOf(a, b));
  assert.deepEqual(owners, edges.map(([a, b]) => theirReplica.ownerOf(a, b)));
  assert.ok(owners.includes(0) && owners.includes(1));
});

test('a hint reaches the other side; a second game replaces the first', () => {
  const { wire, host, guest, events } = connect();
  host.newGame(runSync(generate(5, 1)), 1);
  wire.flush();
  guest.sendHint({ kind: 'next', edge: [1, 2], used: 1 });
  wire.flush();
  const heard = events.host.find(e => e.type === 'hint');
  assert.deepEqual(heard.hint, { kind: 'next', edge: [1, 2], used: 1 });
  const second = host.newGame(runSync(generate(5, 2)), 2);
  wire.flush();
  assert.notEqual(guest.replica, null);
  assert.equal(guest.replica.count(), 0);
  assert.equal(second.count(), 0);
  assert.equal(events.guest.filter(e => e.type === 'puzzle').length, 2);
});

test('leaving tells the other side, and the channel closing is reported', () => {
  const { wire, host, guest, events } = connect();
  guest.leave();
  wire.flush();
  assert.deepEqual(types(events.host), ['left', 'closed']);
  host.sendHint({ kind: 'next', edge: [1, 2], used: 1 }); // sending after the end does nothing
  wire.flush();
});

test('a message that makes no sense is ignored, not fatal', () => {
  const { wire, events } = connect();
  wire.b.send('not json');
  wire.b.send(JSON.stringify({ t: 'op', op: { kind: 'add' } })); // no puzzle yet
  wire.b.send(JSON.stringify({ t: 'nonsense' }));
  wire.flush();
  assert.deepEqual(events.host, []);
});

test('a channel that cannot send (not open yet) does not break leaving or hello', () => {
  const wire = fakePair();
  wire.a.send = () => {
    throw new Error('InvalidStateError: the channel is not open');
  };
  const session = createSession({ role: 'host', channel: wire.a, onEvent: () => {} });
  session.hello();
  session.sendHint({ kind: 'next', edge: [1, 2], used: 1 });
  assert.doesNotThrow(() => session.leave());
  assert.equal(wire.a.closed, true);
});
