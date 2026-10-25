import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { solutionOf } from '../../src/features/hints.js';
import { createMqtt } from '../../src/coop/mqtt.js';
import { resumeRoom } from '../../src/coop/resume.js';
import { newSecret } from '../../src/coop/secret.js';
import { fromBase64Url } from '../../src/coop/invite.js';
import { createSession } from '../../src/coop/session.js';
import { createHub } from '../../src/coop/signal.js';
import { fakePair } from './fake-channel.js';
import { createNetwork, manualTimers, until } from './fake-broker.js';

// The whole way back after a break, without a browser: two sessions with a heartbeat, a channel
// that goes silent, resume rooms on fake brokers, and a fake WebRTC that connects what was offered
// to what answers. What each player's screen does (screen.js) is done here by `player`.
const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));

// The offer of one device meets the answer of the other: a fake pair of channels, opened when
// the answer is accepted.
function fakeRtc() {
  const shared = { wire: null, opened: [] };
  const connection = channel => ({
    channel,
    closed: false,
    close() {
      this.closed = true;
    },
  });
  return {
    createInvite: async () => {
      shared.wire = fakePair();
      const caller = connection(shared.wire.a);
      shared.opened = [caller];
      return { code: 'offer', connection: caller };
    },
    joinInvite: async () => {
      const callee = connection(shared.wire.b);
      shared.opened.push(callee);
      return { code: 'answer', connection: callee };
    },
    acceptReply: async () => {
      shared.opened.forEach(item => item.channel.onopen?.());
    },
    shared,
  };
}

function player(role, wire, secret, net, rtc, clock) {
  const timers = manualTimers();
  const hubTimers = manualTimers();
  const events = [];
  const state = { room: null, resumes: 0, connection: null };
  const { WebSocket } = net.device();
  const session = createSession({
    role,
    channel: wire,
    timers,
    heartbeat: true,
    now: () => clock.t,
    onEvent: event => {
      events.push(event.type);
      if (event.type === 'closed' && !state.room) {
        looking();
      }
    },
  });
  async function looking() {
    const hub = createHub({
      brokers,
      timers: hubTimers,
      random: () => 1,
      connect: (url, handlers) => createMqtt({
        url, clientId: 'c', WebSocketImpl: WebSocket, timers: hubTimers, ...handlers,
      }),
    });
    state.room = await resumeRoom({
      hub,
      secret,
      pid: session.pid,
      rtc,
      timers: hubTimers,
      now: () => clock.t,
      onConnection: connection => {
        connection.channel.onopen = () => {
          state.connection = connection;
          session.attach(connection.channel);
          state.room.close();
          state.room = null;
          state.resumes++;
          session.hello();
          session.resume({ elapsed: 30, hints: 0 });
        };
      },
    });
  }
  return {
    session, timers, events, state,
  };
}

test('a break is mended: silence, a new meeting, one drawing', async () => {
  const net = createNetwork(URLS);
  const clock = { t: 0 };
  const secret = fromBase64Url(newSecret());
  const rtc = fakeRtc();
  const wire = fakePair();
  const host = player('host', wire.a, secret, net, rtc, clock);
  const guest = player('guest', wire.b, secret, net, rtc, clock);
  const puzzle = runSync(generate(6, 5));
  const mine = host.session.newGame(puzzle, 5);
  wire.flush();
  const theirs = guest.session.replica;
  const solution = solutionOf(puzzle);
  const edge = i => [solution[i], solution[i + 1]];
  mine.add(...edge(0));
  theirs.add(...edge(1));
  wire.flush();
  assert.equal(mine.count(), 2);

  // the network is gone: nothing arrives, and both keep drawing
  mine.add(...edge(2));
  theirs.add(...edge(3));
  theirs.add(...edge(4));
  for (let i = 0; i < 4; i++) {
    clock.t += 5000;
    host.timers.advance(5000);
    guest.timers.advance(5000);
    wire.drop('a');
    wire.drop('b');
  }
  assert.ok(host.events.includes('closed') && guest.events.includes('closed'));
  assert.notDeepEqual(mine.edges().map(String).sort(), theirs.edges().map(String).sort());

  await until(() => host.state.resumes + guest.state.resumes === 2, 'both have a new channel');
  rtc.shared.wire.flush();
  assert.deepEqual(mine.edges().map(String).sort(), theirs.edges().map(String).sort());
  assert.equal(mine.count(), 5);
  assert.ok(host.events.includes('resume') && guest.events.includes('resume'));

  // and the game goes on over the new channel
  theirs.add(...edge(5));
  rtc.shared.wire.flush();
  assert.equal(mine.count(), 6);
});

test('a break that was only silence: heard again, nothing more is done', async () => {
  const net = createNetwork(URLS);
  const clock = { t: 0 };
  const secret = fromBase64Url(newSecret());
  const wire = fakePair();
  const host = player('host', wire.a, secret, net, fakeRtc(), clock);
  const guest = player('guest', wire.b, secret, net, fakeRtc(), clock);
  host.session.newGame(runSync(generate(6, 5)), 5);
  wire.flush();
  for (let i = 0; i < 4; i++) {
    clock.t += 5000;
    host.timers.advance(5000);
    wire.drop('a'); // the host hears nothing
  }
  assert.ok(host.events.includes('closed'));
  guest.timers.advance(5000);
  clock.t += 5000;
  host.timers.advance(5000);
  wire.flush();
  assert.ok(host.events.includes('alive'));
});
