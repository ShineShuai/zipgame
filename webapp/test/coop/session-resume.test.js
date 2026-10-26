import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
import { createSession } from '../../src/coop/session.js';
import { fakePair } from './fake-channel.js';
import { manualTimers } from './fake-broker.js';

// A game on two devices over `wire`; `extra` goes to both sessions.
function play(extra = {}) {
  const wire = fakePair();
  const events = { host: [], guest: [] };
  const timers = manualTimers();
  const make = (role, channel) => createSession({
    role, channel, timers, onEvent: e => events[role].push(e), ...extra,
  });
  const host = make('host', wire.a);
  const guest = make('guest', wire.b);
  host.hello();
  guest.hello();
  const puzzle = runSync(generate(6, 5));
  const mine = host.newGame(puzzle, 5);
  wire.flush();
  return {
    wire, host, guest, events, timers, puzzle, mine, theirs: guest.replica,
  };
}
const types = list => list.map(event => event.type);
const edgesOf = replica => replica.edges().map(String).sort();
const wireTypes = (wire, side) => {
  const seen = [];
  while (wire.pending(side)) {
    const before = wire.pending(side);
    wire.step(side);
    seen.push(before);
  }
  return seen.length;
};

test('after a break both devices send what they have: the drawings meet', () => {
  const {
    wire, host, guest, events, puzzle, mine, theirs,
  } = play();
  const solution = solutionOf(puzzle);
  const edge = i => [solution[i], solution[i + 1]];
  mine.add(...edge(0));
  theirs.add(...edge(1));
  wire.flush();
  wire.drop('a');
  wire.drop('b');
  mine.add(...edge(2)); // drawn while the channel was down: lost on its way
  theirs.add(...edge(3));
  theirs.add(...edge(4));
  assert.notDeepEqual(edgesOf(mine), edgesOf(theirs));

  const again = fakePair();
  host.attach(again.a);
  guest.attach(again.b);
  host.hello();
  guest.hello();
  assert.equal(host.resume({ elapsed: 12.5, hints: 2 }), true);
  assert.equal(guest.resume({ elapsed: 12.4, hints: 1 }), true);
  again.flush();
  assert.deepEqual(edgesOf(mine), edgesOf(theirs));
  assert.equal(mine.count(), 5);
  const heard = events.guest.find(event => event.type === 'resume');
  assert.deepEqual(heard, { type: 'resume', game: 5, elapsed: 12.5, hints: 2 });
  assert.ok(types(events.host).includes('op') && types(events.guest).includes('op'));
});

test('a drawing solved while the other device was away is solved there after the sync', () => {
  const { wire, host, guest, puzzle, mine, theirs } = play();
  const solution = solutionOf(puzzle);
  wire.drop('a');
  wire.drop('b');
  solution.slice(1).forEach((cell, i) => mine.add(solution[i], cell));
  assert.equal(mine.solved(), true);
  assert.equal(theirs.solved(), false);
  const again = fakePair();
  host.attach(again.a);
  guest.attach(again.b);
  host.resume({ elapsed: 30, hints: 0 });
  again.flush();
  assert.equal(theirs.solved(), true);
});

test('the lines are sent in chunks of at most 100, and a repeat changes nothing', () => {
  const { host, guest, puzzle, mine, theirs, wire } = play();
  const [a, b] = solutionOf(puzzle);
  for (let i = 0; i < 130; i++) {
    mine.add(a, b);
    mine.remove(a, b);
  }
  wire.drop('b');
  assert.equal(mine.ops().length, 260);
  const again = fakePair();
  host.attach(again.a);
  guest.attach(again.b);
  host.resume({ elapsed: 1, hints: 0 });
  assert.equal(again.pending('b'), 1 + 3, 'resume, then 100 + 100 + 60 lines');
  again.flush();
  assert.equal(theirs.ops().length, 260);
  host.resume({ elapsed: 1, hints: 0 }); // sent twice: harmless
  again.flush();
  assert.equal(theirs.ops().length, 260);
});

test('a kept game is restored, and the device gets back its own lost lines', async () => {
  const { host, guest, puzzle, mine, theirs, wire } = play();
  const solution = solutionOf(puzzle);
  mine.add(solution[0], solution[1]);
  theirs.add(solution[1], solution[2]);
  theirs.add(solution[2], solution[3]);
  wire.flush();
  const kept = { ...host.current, ops: mine.ops() };
  const keptGuest = { ...guest.current, ops: theirs.ops().slice(0, -1) }; // saved a moment early

  const events = { host: [], guest: [] };
  const timers = manualTimers();
  const host2 = createSession({
    role: 'host', timers, onEvent: e => events.host.push(e),
  });
  const guest2 = createSession({
    role: 'guest', timers, onEvent: e => events.guest.push(e),
  });
  const mine2 = await host2.restore(kept);
  const theirs2 = await guest2.restore(keptGuest);
  assert.equal(mine2.puzzle.seed, 5);
  assert.equal(mine2.count(), 3);
  assert.equal(theirs2.count(), 2, 'the saved game had lost a line');
  assert.equal(host2.resume({ elapsed: 1, hints: 0 }), true, 'no channel yet: no error');

  const wire2 = fakePair();
  host2.attach(wire2.a);
  guest2.attach(wire2.b);
  host2.resume({ elapsed: 40, hints: 1 });
  guest2.resume({ elapsed: 40, hints: 1 });
  wire2.flush();
  assert.deepEqual(edgesOf(mine2), edgesOf(theirs2));
  assert.equal(theirs2.count(), 3);
  assert.equal(theirs2.add(solution[3], solution[4]), null);
  wire2.flush();
  assert.equal(mine2.count(), 4, 'the guest\'s next line has a number of its own');
});

test('a device without a game has nothing to resume; one without a channel does not fail', () => {
  const lone = createSession({ role: 'guest', onEvent() {} });
  assert.equal(lone.resume({ elapsed: 0, hints: 0 }), false);
  assert.equal(lone.hello(), false);
  assert.equal(lone.current, null);
});

test('the host\'s game wins: a guest that comes back with another game gets it', async () => {
  const {
    wire, host, guest, events, theirs,
  } = play();
  const oldGame = guest.current.seed;
  wire.flush();
  const second = host.newGame(runSync(generate(5, 8)), 8); // while the guest was away
  wire.drop('b');
  const again = fakePair();
  host.attach(again.a);
  guest.attach(again.b);
  guest.resume({ elapsed: 5, hints: 0 }); // the guest still says game 5
  host.resume({ elapsed: 5, hints: 0 });
  again.flush();
  assert.equal(oldGame, 5);
  assert.equal(guest.current.seed, 8);
  assert.notEqual(guest.replica, theirs);
  assert.equal(guest.replica.puzzle.n, 5);
  assert.equal(second.puzzle.n, 5);
  assert.ok(types(events.guest).filter(type => type === 'puzzle').length >= 2);
});

test('a silent channel is reported once, and again as alive when the other is heard', () => {
  const clock = { at: 0 };
  const { wire, events, timers } = play({ heartbeat: true, now: () => clock.at });
  const advance = ms => {
    clock.at += ms;
    timers.advance(ms);
  };
  advance(5000);
  assert.ok(wireTypes(wire, 'a') >= 1, 'the guest pings the host');
  wire.flush();
  assert.equal(types(events.host).includes('closed'), false);
  // nothing arrives any more
  for (let i = 0; i < 4; i++) {
    advance(5000);
    wire.drop('a');
    wire.drop('b');
  }
  assert.equal(types(events.host).filter(type => type === 'closed').length, 1);
  assert.equal(types(events.guest).filter(type => type === 'closed').length, 1);
  advance(15000);
  assert.equal(types(events.host).filter(type => type === 'closed').length, 1, 'reported once');
  advance(5000); // the guest's ping gets through again
  wire.flush();
  assert.equal(types(events.host).filter(type => type === 'alive').length, 1);
});

// A running game goes to a friend who has just connected: the friend takes the free place.
async function shared(ownPid, ownRole = 'host') {
  const first = createSession({ role: 'host', onEvent() {} });
  const puzzle = runSync(generate(6, 5));
  const early = first.newGame(puzzle, 5);
  const solution = solutionOf(puzzle);
  early.add(solution[0], solution[1]); // pid 0
  const wire = fakePair();
  const events = { host: [], guest: [] };
  const timers = manualTimers();
  const host = createSession({
    role: ownRole, pid: ownPid, channel: wire.a, timers, info: () => ({ elapsed: 33, hints: 2 }),
    onEvent: e => events.host.push(e),
  });
  const mine = await host.restore({
    text: first.current.text, seed: 5, ops: early.ops(),
  });
  const guest = createSession({
    role: 'guest', channel: wire.b, timers, onEvent: e => events.guest.push(e),
  });
  return {
    wire, host, guest, events, mine, solution,
  };
}

test('a friend joins a game that is on: lines, time, and the other place', async () => {
  const {
    wire, host, guest, events, mine, solution,
  } = await shared(0);
  mine.add(solution[1], solution[2]);
  assert.equal(host.share(), true);
  wire.flush();
  assert.equal(guest.pid, 1);
  assert.equal(guest.current.seed, 5);
  const order = types(events.guest).filter(type => type !== 'op');
  assert.deepEqual(order, ['puzzle', 'start', 'resume']);
  const start = events.guest.find(event => event.type === 'start');
  assert.deepEqual(start, { type: 'start', seed: 5, shared: false });
  const hostStart = events.host.find(event => event.type === 'start');
  assert.deepEqual(hostStart, { type: 'start', seed: 5, shared: true });
  assert.deepEqual(events.guest.find(event => event.type === 'resume'),
    { type: 'resume', game: 5, elapsed: 33, hints: 2 });
  assert.deepEqual(edgesOf(guest.replica), edgesOf(mine));
  assert.equal(guest.replica.add(solution[2], solution[3]), null);
  wire.flush();
  assert.equal(mine.count(), 3);
});

test('a guest that takes a game over keeps its number; the friend takes number 0', async () => {
  const {
    wire, host, guest, mine, solution,
  } = await shared(1);
  assert.equal(host.pid, 1);
  assert.equal(host.role, 'host');
  assert.equal(mine.count(), 1, 'the line of the player that left is there');
  mine.add(solution[1], solution[2]); // number 1 now
  assert.equal(host.share(), true);
  wire.flush();
  assert.equal(guest.pid, 0, 'the friend takes the place that the first host had');
  assert.equal(guest.replica.pid, 0);
  assert.equal(guest.replica.add(solution[2], solution[3]), null, 'its first line does not clash');
  wire.flush();
  assert.equal(mine.count(), 3);
  const numbers = guest.replica.ops().filter(op => op.pid === 0).map(op => op.seq);
  assert.equal(new Set(numbers).size, numbers.length, 'no two lines of number 0 share a seq');
});

test('a solo game is shared from the start: nothing to restore but the lines', async () => {
  const wire = fakePair();
  const host = createSession({ role: 'host', channel: wire.a, onEvent() {} });
  assert.equal(host.share(), false, 'no game, nothing to share');
  const guest = createSession({ role: 'guest', channel: wire.b, onEvent() {} });
  assert.equal(guest.share(), false, 'only a host shares');
});

test('on a connection made by hand the host gives the guest the secret to find it again', () => {
  const { wire, host, guest, events } = play();
  host.sendSecret('abcdefghijklmnopqrstuv');
  host.sendSecret('short'); // refused by the receiver
  wire.flush();
  assert.deepEqual(events.guest.filter(event => event.type === 'secret'), [
    { type: 'secret', secret: 'abcdefghijklmnopqrstuv' },
  ]);
  guest.sendSecret('abcdefghijklmnopqrstuv'); // the host does not take one
  wire.flush();
  assert.equal(events.host.some(event => event.type === 'secret'), false);
});
