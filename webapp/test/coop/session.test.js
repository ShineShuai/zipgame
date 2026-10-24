import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { solutionOf } from '../../src/features/hints.js';
import { GUEST, HOST, createSession } from '../../src/coop/session.js';
import { fakePair } from './fake-channel.js';

// Timers by hand: fire() runs the oldest waiting one (the session's resend clock).
function manualTimers() {
  const waiting = new Map();
  let id = 0;
  return {
    set: fn => {
      waiting.set(++id, fn);
      return id;
    },
    clear: key => waiting.delete(key),
    fire() {
      const [first] = [...waiting];
      if (first) {
        waiting.delete(first[0]);
        first[1]();
      }
      return Boolean(first);
    },
    get size() {
      return waiting.size;
    },
  };
}

function connect(extra = {}) {
  const wire = fakePair();
  const events = { host: [], guest: [] };
  const host = createSession({
    role: 'host', channel: wire.a, onEvent: e => events.host.push(e), ...extra,
  });
  const guest = createSession({
    role: 'guest', channel: wire.b, onEvent: e => events.guest.push(e), ...extra,
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

test('a channel `closed` report does not stop the session: the game still starts', () => {
  // A browser can call a connection failed while the host has not pasted the reply yet, and
  // the channel opens after all; the session must not stay mute then.
  const { wire, host, guest, events } = connect();
  wire.b.onclose();
  wire.a.onclose();
  host.newGame(runSync(generate(5, 4)), 4);
  wire.flush();
  assert.ok(types(events.host).includes('start'));
  assert.ok(types(events.guest).includes('start'));
});

test('a puzzle that was lost on the way is sent again until the guest is ready', () => {
  const timers = manualTimers();
  const { wire, host, events } = connect({ timers });
  host.newGame(runSync(generate(5, 6)), 6);
  assert.equal(wire.drop('b'), 1);
  timers.fire(); // the host sends it again
  wire.flush();
  assert.deepEqual(types(events.guest), ['puzzle', 'start']);
  assert.deepEqual(types(events.host), ['start']);
  assert.equal(timers.size, 0); // nobody keeps asking once the game has started
});

test('a ready or start that was lost is asked for again; repeats change nothing', () => {
  const timers = manualTimers();
  const { wire, host, events } = connect({ timers });
  host.newGame(runSync(generate(5, 7)), 7);
  wire.step('b'); // the guest has the puzzle and says ready
  assert.equal(wire.drop('a'), 1); // ... which is lost
  timers.fire(); // the host (no ready yet) sends the puzzle again
  timers.fire(); // the guest asks again
  wire.flush();
  const count = (list, type) => types(list).filter(each => each === type).length;
  assert.equal(count(events.guest, 'start'), 1);
  assert.equal(count(events.host, 'start'), 1);
  assert.equal(count(events.guest, 'puzzle'), 1);
  assert.equal(timers.size, 0);
});

test('a late repeat of the same puzzle keeps the guest drawing', () => {
  const { wire, host, guest } = connect({ timers: manualTimers() });
  const sent = [];
  const send = wire.a.send;
  wire.a.send = text => {
    sent.push(text);
    send.call(wire.a, text);
  };
  const puzzle = runSync(generate(5, 8));
  host.newGame(puzzle, 8);
  wire.flush();
  const replica = guest.replica;
  const solution = solutionOf(puzzle);
  assert.equal(replica.add(solution[0], solution[1]), null);
  wire.b.onmessage(sent.find(text => JSON.parse(text).t === 'puzzle'));
  assert.equal(guest.replica, replica);
  assert.equal(replica.count(), 1);
});

test('the host gives up when the guest never answers: stalled, and no more timers', () => {
  const timers = manualTimers();
  const { wire, host, events } = connect({ timers, resends: 2 });
  host.newGame(runSync(generate(5, 3)), 3);
  while (timers.fire()) {
    wire.drop('b');
  }
  assert.deepEqual(types(events.host), ['stalled']);
  assert.equal(timers.size, 0);
});

test('a ready for another game is ignored', () => {
  const { wire, host, events } = connect({ timers: manualTimers() });
  host.newGame(runSync(generate(5, 2)), 2);
  wire.drop('b');
  wire.a.onmessage(JSON.stringify({ t: 'ready', seed: 1 }));
  assert.deepEqual(types(events.host), []);
  wire.a.onmessage(JSON.stringify({ t: 'ready', seed: 2 }));
  assert.deepEqual(types(events.host), ['start']);
});
