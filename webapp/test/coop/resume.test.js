import test from 'node:test';
import assert from 'node:assert/strict';
import { createMqtt } from '../../src/coop/mqtt.js';
import {
  ALIVE_MS, ATTEMPT_MS, BEAT_MS, RESUME_MS, resumeRoom,
} from '../../src/coop/resume.js';
import { createHub } from '../../src/coop/signal.js';
import { deriveResume, newSecret, seal, unseal } from '../../src/coop/secret.js';
import { fromBase64Url } from '../../src/coop/invite.js';
import {
  createNetwork, manualTimers, settle, until,
} from './fake-broker.js';

const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));

// One device: its hub, its clock, and the connections it was given (what rtc.js would make).
function device(net, secret, pid, clock) {
  const timers = manualTimers();
  const { WebSocket, gate } = net.device();
  const hub = createHub({
    brokers,
    timers,
    random: () => 1,
    connect: (url, handlers) => createMqtt({
      url, clientId: 'c', WebSocketImpl: WebSocket, timers, ...handlers,
    }),
  });
  const log = [];
  const peers = [];
  const connections = [];
  let made = 0;
  const connect = () => ({
    name: `p${pid}-${made++}`,
    closed: false,
    close() {
      this.closed = true;
    },
  });
  const rtc = {
    createInvite: async () => {
      const connection = connect();
      log.push(`createInvite ${connection.name}`);
      return { code: `offer-${connection.name}`, connection };
    },
    acceptReply: async (connection, text) => log.push(`acceptReply ${connection.name} ${text}`),
    joinInvite: async text => {
      const connection = connect();
      log.push(`joinInvite ${text}`);
      return { code: `answer-${connection.name}`, connection };
    },
  };
  const open = async (extra = {}) => resumeRoom({
    hub,
    secret,
    pid,
    rtc,
    timers,
    now: () => clock.t,
    onConnection: connection => connections.push(connection),
    onPeer: here => peers.push(here),
    ...extra,
  });
  return {
    hub, timers, gate, log, peers, connections, open,
  };
}

const setup = () => ({
  net: createNetwork(URLS), secret: fromBase64Url(newSecret()), clock: { t: 1000 },
});
const calls = (...devices) => devices
  .flatMap(d => d.log.filter(line => line.startsWith('createInvite')));

test('two devices that look for each other meet: one offers, the other answers', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  const b = device(net, secret, 1, clock);
  await a.open();
  await b.open();
  await until(() => a.log.length + b.log.length >= 3, 'offer, answer and its acceptance');
  await settle(30);
  assert.equal(calls(a, b).length, 1, 'only one of them offers');
  const caller = a.log.some(line => line.startsWith('createInvite')) ? a : b;
  const callee = caller === a ? b : a;
  assert.ok(callee.log[0].startsWith('joinInvite offer-p'));
  assert.ok(caller.log.some(line => line.startsWith('acceptReply') && line.includes('answer-p')));
  assert.equal(caller.connections.length, 1);
  assert.equal(callee.connections.length, 1);
  assert.deepEqual(a.peers, [true]);
  assert.deepEqual(b.peers, [true]);
});

test('one that waits is found by the one that comes later', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  await a.open();
  clock.t += 5 * 60 * 1000;
  a.timers.advance(BEAT_MS);
  const b = device(net, secret, 1, clock);
  await b.open();
  await until(() => a.connections.length === 1 && b.connections.length === 1, 'a connection');
  assert.equal(calls(a, b).length, 1);
});

test('only holders of the secret take part; an offer for another run is ignored', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  await a.open();
  const { room, key } = await deriveResume(secret);
  const rogue = device(net, fromBase64Url(newSecret()), 1, clock);
  const to = `zipcoop/1/${room}/offer/1`;
  // an offer sealed with a wrong key, and one that is right but is for another run
  rogue.hub.publish(to, await seal((await deriveResume(fromBase64Url(newSecret()))).key, to, {
    from: 'x', to: 'y', offer: 'EVIL',
  }));
  rogue.hub.publish(`${to}b`, 'junk');
  await settle(60);
  const here = `zipcoop/1/${room}/here/1`;
  rogue.hub.publish(here, await seal(key, here, { n: 'rogue-run', beat: 0 }));
  const stale = { from: 'rogue-run', to: 'another-run', offer: 'OLD' };
  rogue.hub.publish(to, await seal(key, to, stale));
  await settle(80);
  assert.ok(!a.log.some(line => line.includes('EVIL') || line.includes('OLD')), a.log.join());
  assert.deepEqual(a.peers, [true], 'the rogue with the key is seen as the other device');
});

test('an offer that comes before its maker\'s beat is answered when the beat comes', async () => {
  const { net, secret, clock } = setup();
  const b = device(net, secret, 1, clock);
  await b.open();
  const { room, key } = await deriveResume(secret);
  const rogue = device(net, secret, 0, clock);
  const seen = [];
  rogue.hub.subscribe(`zipcoop/1/${room}/here/1`, (topic, text) => seen.push([topic, text]));
  await until(() => seen.length === 1, 'the beat of b');
  const n = (await unseal(key, seen[0][0], seen[0][1])).n;
  const offer = `zipcoop/1/${room}/offer/0`;
  rogue.hub.publish(offer, await seal(key, offer, { from: '+early', to: n, offer: 'FIRST' }));
  await settle(60);
  assert.deepEqual(b.log, [], 'b does not know who "+early" is yet');
  const here = `zipcoop/1/${room}/here/0`;
  rogue.hub.publish(here, await seal(key, here, { n: '+early', beat: 0 }));
  await until(() => b.log.length === 1, 'the offer is answered now');
  assert.equal(b.log[0], 'joinInvite FIRST');
});

test('an attempt that does not open is made again while the other is there', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  const b = device(net, secret, 1, clock);
  await a.open();
  await b.open();
  await until(() => a.connections.length + b.connections.length === 2, 'the first attempt');
  const caller = a.log.some(line => line.startsWith('createInvite')) ? a : b;
  const first = caller.connections[0];
  caller.timers.advance(ATTEMPT_MS);
  await until(() => caller.connections.length === 2, 'a second attempt');
  assert.equal(first.closed, true, 'the one that did not open is closed');
  assert.equal(calls(caller).length, 2);
});

test('a device that restarts is a new one: the attempt for the old one is dropped', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  await a.open();
  const b = device(net, secret, 1, clock);
  const first = await b.open();
  await until(() => a.connections.length + b.connections.length === 2, 'the first attempt');
  first.close();
  const again = device(net, secret, 1, clock);
  await again.open();
  await until(() => again.connections.length >= 1 && calls(a, again).length >= 1, 'meets again');
  await until(() => a.connections.length + again.connections.length >= 2, 'a connection again');
});

test('an offer from the one that may not offer is not answered', async () => {
  const { net, secret, clock } = setup();
  const b = device(net, secret, 1, clock);
  await b.open();
  const { room, key } = await deriveResume(secret);
  const rogue = device(net, secret, 0, clock);
  const seen = [];
  rogue.hub.subscribe(`zipcoop/1/${room}/here/1`, (topic, text) => seen.push([topic, text]));
  await until(() => seen.length === 1, 'the beat of b');
  const { n } = await unseal(key, seen[0][0], seen[0][1]);
  const here = `zipcoop/1/${room}/here/0`;
  const offer = `zipcoop/1/${room}/offer/0`;
  rogue.hub.publish(here, await seal(key, here, { n: '~later', beat: 0 })); // sorts after any n
  rogue.hub.publish(offer, await seal(key, offer, { from: '~later', to: n, offer: 'NO' }));
  await settle(80);
  assert.ok(!b.log.some(line => line.includes('NO')), 'b offers itself (its n is the smaller)');
  assert.equal(b.log.filter(line => line.startsWith('createInvite')).length, 1);
});

test('a device that has gone silent is forgotten, and not offered to any more', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  const b = device(net, secret, 1, clock);
  await a.open();
  const gone = await b.open();
  await until(() => a.peers.length === 1, 'seen');
  void gone; // never closed: the page just died
  b.gate.all = true;
  b.gate.cut();
  b.hub.close();
  for (let i = 0; i < 4; i++) {
    clock.t += BEAT_MS;
    a.timers.advance(BEAT_MS);
  }
  assert.ok(clock.t - 1000 > ALIVE_MS);
  assert.deepEqual(a.peers, [true, false]);
});

test('closing leaves nothing on the brokers and keeps the connections made', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  const b = device(net, secret, 1, clock);
  const ra = await a.open();
  const rb = await b.open();
  await until(() => a.connections.length === 1 && b.connections.length === 1, 'connected');
  await settle(30);
  ra.close();
  rb.close();
  await settle(40);
  net.brokers.forEach(broker => assert.equal(broker.retained.size, 0, broker.url));
  assert.ok([...a.connections, ...b.connections].every(connection => !connection.closed));
});

test('nobody came: the room closes by itself after a while', async () => {
  const { net, secret, clock } = setup();
  const a = device(net, secret, 0, clock);
  let expired = 0;
  await a.open({ onExpired: () => expired++ });
  a.timers.advance(RESUME_MS);
  assert.equal(expired, 1);
  await settle(30);
  net.brokers.forEach(broker => assert.equal(broker.retained.size, 0));
});
