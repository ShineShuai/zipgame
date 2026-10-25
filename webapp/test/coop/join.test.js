import test from 'node:test';
import assert from 'node:assert/strict';
import { createMqtt } from '../../src/coop/mqtt.js';
import { createHub } from '../../src/coop/signal.js';
import {
  ASK_MS, GREETING_MAX, HUB_WAIT_MS, ROOM_MS, SEEN_WAIT_MS, cleanGreeting, hostRoom, joinRoom,
} from '../../src/coop/join.js';
import {
  deriveRoom, newId, newPair, pairKey, seal, splitToken, unseal,
} from '../../src/coop/secret.js';
import {
  createNetwork, manualTimers, settle, until,
} from './fake-broker.js';

const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));

// One device on the fake network: a hub, its clock, and the view of the network it has.
function device(net, blocked = []) {
  const timers = manualTimers();
  const { WebSocket, gate } = net.device();
  blocked.forEach(url => gate.blocked.add(url));
  const hub = createHub({
    brokers,
    timers,
    random: () => 1,
    connect: (url, handlers) => createMqtt({
      url, clientId: 'c', WebSocketImpl: WebSocket, timers, ...handlers,
    }),
  });
  return { hub, timers, gate };
}

// What rtc.js does, without WebRTC: codes are made up, and every call is written down.
function fakeRtc(log, name) {
  return {
    createInvite: async () => {
      const connection = {
        name: `${name}-connection`,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      log.push(`${name}: createInvite`);
      return { code: 'offer-code-123', connection };
    },
    acceptReply: async (connection, text) => {
      log.push(`${name}: acceptReply ${connection.name} ${text}`);
    },
    joinInvite: async text => {
      log.push(`${name}: joinInvite ${text}`);
      return { code: `answer-to-${text}`, connection: { name: `${name}-connection`, close() {} } };
    },
  };
}

async function openHost(net, options = {}) {
  const dev = device(net, options.blocked);
  const log = options.log ?? [];
  const requests = [];
  const room = await hostRoom({
    hub: dev.hub,
    timers: dev.timers,
    rtc: fakeRtc(log, 'host'),
    onRequest: list => requests.push(list),
    onConnection: connection => log.push(`host: onConnection ${connection.name}`),
    ...options.handlers,
    ...options.room,
  });
  return {
    ...dev, room, log, requests, last: () => requests.at(-1) ?? [],
  };
}

async function openGuest(net, token, options = {}) {
  const dev = device(net, options.blocked);
  const log = options.log ?? [];
  const stages = [];
  const infos = [];
  const room = await joinRoom({
    hub: dev.hub,
    token,
    timers: dev.timers,
    rtc: fakeRtc(log, 'guest'),
    onState: (stage, info) => {
      stages.push(stage);
      infos.push(info);
    },
    onConnection: connection => log.push(`guest: onConnection ${connection.name}`),
    ...options.room,
  });
  return {
    ...dev, room, log, stages, infos, stage: () => stages.at(-1), info: () => infos.at(-1),
  };
}

const everything = net => JSON.stringify([...net.brokers.values()].map(broker => broker.log));

test('greetings: no control characters, trimmed, at most 80 characters, emoji count 1', () => {
  assert.equal(cleanGreeting('  Anna \n\t here '), 'Anna    here');
  assert.equal(cleanGreeting(undefined), '');
  assert.equal(cleanGreeting('x'.repeat(200)).length, GREETING_MAX);
  assert.equal([...cleanGreeting('😀'.repeat(100))].length, GREETING_MAX);
});

test('the whole handshake: greeting, accept, offer and answer cross', async () => {
  const net = createNetwork(URLS);
  const log = [];
  const host = await openHost(net, { log });
  const guest = await openGuest(net, host.room.token, { log });
  await until(() => guest.stage() === 'ready', 'the guest sees the room');
  assert.equal(guest.info().needGreeting, false);
  assert.equal(await guest.room.ask('  Anna \n'), true);
  await until(() => host.last().length === 1, 'the host sees the request');
  assert.equal(host.last()[0].greeting, 'Anna');
  await until(() => guest.stage() === 'seen', 'the guest is told it arrived');
  assert.ok(!log.some(line => line.includes('createInvite')), 'no offer before the host decides');
  assert.ok(!everything(net).includes('offer-code-123'));

  assert.equal(await host.room.accept(host.last()[0].id), true);
  await until(() => log.some(line => line.startsWith('host: acceptReply')), 'the answer');
  assert.deepEqual(log, [
    'host: createInvite',
    'host: onConnection host-connection',
    'guest: joinInvite offer-code-123',
    'guest: onConnection guest-connection',
    'host: acceptReply host-connection answer-to-offer-code-123',
  ]);
  assert.equal(guest.stage(), 'connecting');
  assert.deepEqual(host.last(), [], 'the request list is empty once someone is accepted');
  const wire = everything(net);
  for (const secret of ['offer-code-123', 'answer-to-', 'Anna']) {
    assert.ok(!wire.includes(secret), `${secret} never crosses a broker in the clear`);
  }

  host.room.close();
  guest.room.close();
  await settle();
  net.brokers.forEach(broker => assert.equal(broker.retained.size, 0, `${broker.url} is clean`));
});

test('declining tells the guest, and nothing is offered', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready', 'ready');
  await guest.room.ask('Bob');
  await until(() => host.last().length === 1, 'request');
  await host.room.decline(host.last()[0].id);
  await until(() => guest.stage() === 'declined', 'declined');
  assert.deepEqual(host.last(), []);
  assert.ok(!host.log.some(line => line.includes('createInvite')));
  const declined = host.requests[0][0].id;
  assert.equal(await host.room.accept(declined), false, 'a declined request stays declined');
});

test('a required greeting: the guest is told and cannot ask without one', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net, { room: { needGreeting: true } });
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready' && guest.info().needGreeting, 'told: needed');
  assert.equal(await guest.room.ask('   '), false);
  assert.equal(guest.stage(), 'ready');
  assert.equal(guest.info().error, 'greeting');
  assert.ok(!everything(net).includes('/req/'), 'nothing was sent');
  await host.room.setNeedGreeting(false);
  await until(() => guest.info().needGreeting === false, 'told: no greeting needed');
  assert.equal(await guest.room.ask(''), true);
  await until(() => host.last().length === 1, 'request without a greeting');
  assert.equal(host.last()[0].greeting, '');
});

test('the host enforces the greeting itself, whatever a guest sends', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net, { room: { needGreeting: true } });
  const { secret } = splitToken(host.room.token);
  const { room, key } = await deriveRoom(secret);
  const rogue = device(net);
  const id = newId();
  const pair = await newPair();
  const refusals = [];
  rogue.hub.subscribe(`zipcoop/1/${room}/ok/${id}`, (topic, text) => refusals.push([topic, text]));
  const to = `zipcoop/1/${room}/req/${id}`;
  rogue.hub.publish(to, await seal(key, to, { pub: pair.pub, greeting: '' }));
  await until(() => refusals.length === 1, 'an answer');
  assert.equal(refusals[0][1][0], 'N');
  assert.deepEqual(await unseal(key, refusals[0][0], refusals[0][1].slice(1)), { why: 'greeting' });
  assert.deepEqual(host.last(), []);
});

test('after an accept, the others waiting and late guests are told it is taken', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const first = await openGuest(net, host.room.token);
  const second = await openGuest(net, host.room.token);
  const third = await openGuest(net, host.room.token);
  await until(() => [first, second, third].every(g => g.stage() === 'ready'), 'ready');
  await first.room.ask('first');
  await second.room.ask('second');
  await until(() => host.last().length === 2, 'two requests');
  await host.room.accept(host.last().find(request => request.greeting === 'first').id);
  await until(() => second.stage() === 'taken', 'the other waiting guest is released');
  await third.room.ask('late');
  await until(() => third.stage() === 'taken', 'a late guest is refused');
  assert.equal(first.stage() === 'taken', false);
});

test('at most three requests wait at once', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const guests = [];
  for (let i = 0; i < 4; i++) {
    guests.push(await openGuest(net, host.room.token));
  }
  await until(() => guests.every(g => g.stage() === 'ready'), 'ready');
  for (const [i, g] of guests.entries()) {
    await g.room.ask(`guest ${i}`);
    await until(() => ['seen', 'taken'].includes(g.stage()), `guest ${i} heard back`);
  }
  assert.equal(host.last().length, 3);
  assert.equal(guests[3].stage(), 'taken');
});

test('someone else with the link cannot pose as the host: its offer is ignored', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready', 'ready');
  const { secret } = splitToken(host.room.token);
  const { room, key } = await deriveRoom(secret);
  const attacker = device(net);
  const forged = [];
  attacker.hub.subscribe(`zipcoop/1/${room}/req/+`, async (topic, text) => {
    const body = await unseal(key, topic, text);
    const id = topic.slice(topic.lastIndexOf('/') + 1);
    const mine = await newPair();
    const shared = await pairKey(mine.priv, body.pub, room);
    const to = `zipcoop/1/${room}/ok/${id}`;
    attacker.hub.publish(to, `A${mine.pub}.${await seal(shared, to, { offer: 'EVIL-OFFER' })}`);
    forged.push(id);
  });
  await guest.room.ask('hello');
  await until(() => forged.length === 1, 'the attacker answered first');
  await until(() => host.last().length === 1, 'the real request');
  await settle(60);
  assert.ok(!guest.log.some(line => line.includes('EVIL')), 'never joined the attacker');
  assert.notEqual(guest.stage(), 'connecting');
  await host.room.accept(host.last()[0].id);
  await until(() => guest.stage() === 'connecting', 'the real host still gets through');
  assert.ok(host.log.some(line => line.includes('createInvite')));
  assert.ok(guest.log.some(line => line.includes('joinInvite offer-code-123')));
});

test('someone else with the link cannot answer for the guest', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready', 'ready');
  await guest.room.ask('hello');
  await until(() => host.last().length === 1, 'request');
  const id = host.last()[0].id;
  const { secret } = splitToken(host.room.token);
  const { room, key } = await deriveRoom(secret);
  const attacker = device(net);
  const to = `zipcoop/1/${room}/ans/${id}`;
  attacker.hub.publish(to, await seal(key, to, { answer: 'EVIL-ANSWER' }));
  await host.room.accept(id);
  await until(() => guest.stage() === 'connecting', 'accepted');
  await until(() => host.log.some(line => line.startsWith('host: acceptReply')), 'the real answer');
  assert.ok(!host.log.some(line => line.includes('EVIL')));
});

test('a host whose page was asleep gets the request when it wakes', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net);
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready', 'ready');
  host.gate.all = true;
  host.gate.cut();
  await until(() => !host.hub.anyUp(), 'the host is cut off');
  await guest.room.ask('hello');
  guest.timers.advance(SEEN_WAIT_MS);
  assert.equal(guest.stage(), 'quiet', 'the guest is told the host is not answering');
  host.gate.all = false;
  host.hub.wake();
  await until(() => host.last().length === 1, 'the retained request arrives');
  await until(() => guest.stage() === 'seen', 'the guest is told');
  await host.room.accept(host.last()[0].id);
  await until(() => guest.stage() === 'connecting', 'connected after all');
});

test('it is enough that one broker is reachable from both sides', async () => {
  const net = createNetwork(URLS);
  const host = await openHost(net, { blocked: ['wss://mq'] });
  const guest = await openGuest(net, host.room.token, { blocked: ['wss://hv'] });
  await until(() => guest.stage() === 'ready', 'the guest finds the room');
  await guest.room.ask('hello');
  await until(() => host.last().length === 1, 'the request arrives');
  await host.room.accept(host.last()[0].id);
  await until(() => host.log.some(line => line.startsWith('host: acceptReply')), 'completed');
});

test('no broker reachable: both sides are told after a while', async () => {
  const net = createNetwork(URLS);
  net.brokers.forEach(broker => {
    broker.down = true;
  });
  let down = 0;
  const host = await openHost(net, { handlers: { onDown: () => down++ } });
  const guest = await openGuest(net, host.room.token);
  host.timers.advance(HUB_WAIT_MS);
  guest.timers.advance(HUB_WAIT_MS);
  assert.equal(down, 1);
  assert.equal(guest.stage(), 'down');
  net.brokers.forEach(broker => {
    broker.down = false;
  });
  guest.hub.wake();
  host.hub.wake();
  await until(() => guest.stage() === 'ready', 'a broker came back: the guest can go on');
});

test('an invite expires, and the guest gives up when nobody answers', async () => {
  const net = createNetwork(URLS);
  let expired = 0;
  const host = await openHost(net, { handlers: { onExpired: () => expired++ } });
  const guest = await openGuest(net, host.room.token);
  await until(() => guest.stage() === 'ready', 'ready');
  await guest.room.ask('hello');
  await until(() => host.last().length === 1, 'request');
  guest.timers.advance(ASK_MS);
  assert.equal(guest.stage(), 'timeout');
  host.timers.advance(ROOM_MS);
  assert.equal(expired, 1);
  await settle();
  const topics = [...net.brokers.values()].flatMap(broker => [...broker.retained.keys()]);
  assert.ok(!topics.some(topic => topic.endsWith('/open')), 'the room is gone');
  const asked = host.requests[0][0].id;
  assert.equal(await host.room.accept(asked), false, 'a closed room accepts nobody');
});

test('a link that is not a token is refused at once', async () => {
  const net = createNetwork(URLS);
  const dev = device(net);
  await assert.rejects(joinRoom({ hub: dev.hub, token: 'short' }), /bad code/);
  await assert.rejects(joinRoom({ hub: dev.hub, token: undefined }), /bad code/);
  dev.hub.close();
});
