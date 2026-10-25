import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPacket, createMqtt, createParser, publishPacket, readPublish, subscribePacket,
} from '../../src/coop/mqtt.js';
import {
  createNetwork, manualTimers, settle, until,
} from './fake-broker.js';

const bytes = (...parts) => Uint8Array.from(parts.flatMap(part => {
  if (typeof part === 'string') {
    return [...Buffer.from(part)];
  }
  return typeof part === 'number' ? [part] : [...part];
}));

test('CONNECT: MQTT 3.1.1, clean session, the keep-alive and the client id', () => {
  assert.deepEqual(connectPacket('abc', 60), bytes(
    0x10, 15, 0, 4, 'MQTT', 4, 2, 0, 60, 0, 3, 'abc',
  ));
});

test('SUBSCRIBE and PUBLISH have the right flags; a retained one sets the retain bit', () => {
  assert.deepEqual(subscribePacket(1, 'a/+'), bytes(0x82, 8, 0, 1, 0, 3, 'a/+', 0));
  assert.deepEqual(publishPacket('a/b', 'hi'), bytes(0x30, 7, 0, 3, 'a/b', 'hi'));
  assert.deepEqual(publishPacket('a/b', 'hi', true), bytes(0x31, 7, 0, 3, 'a/b', 'hi'));
  assert.deepEqual(publishPacket('a/b', '', true), bytes(0x31, 5, 0, 3, 'a/b'), 'empty = delete');
});

test('the remaining length takes 1, 2 or 3 bytes', () => {
  const small = publishPacket('a', 'x'.repeat(124)); // 2 + 1 + 124 = 127
  assert.deepEqual([...small.slice(0, 2)], [0x30, 127]);
  const medium = publishPacket('a', 'x'.repeat(318)); // 321 = 0xC1 0x02
  assert.deepEqual([...medium.slice(0, 3)], [0x30, 0xc1, 0x02]);
  const large = publishPacket('a', 'x'.repeat(20000)); // 20003
  assert.deepEqual([...large.slice(0, 4)], [0x30, 0xa3, 0x9c, 0x01]);
  assert.equal(createParser()(large)[0].body.length, 20003);
});

test('the parser: whole packets, split anywhere, and several in one frame', () => {
  const one = publishPacket('t/1', 'first', true);
  const two = publishPacket('t/2', 'second');
  const parse = createParser();
  assert.equal(parse(bytes(one, two)).length, 2);
  const split = createParser();
  const joined = bytes(one, two);
  const got = [];
  for (const byte of joined) {
    got.push(...split(Uint8Array.of(byte)));
  }
  assert.equal(got.length, 2);
  assert.deepEqual(readPublish(got[0]), { topic: 't/1', text: 'first', id: null });
  assert.equal(got[0].flags & 1, 1);
  assert.deepEqual(readPublish(got[1]), { topic: 't/2', text: 'second', id: null });
  assert.throws(() => createParser()(bytes(0x30, 0x80, 0x80, 0x80, 0x80, 1)), /bad length/);
});

test('a PUBLISH with QoS 1 carries a packet id after the topic', () => {
  const body = bytes(0, 1, 't', 0x12, 0x34, 'hi');
  assert.deepEqual(readPublish({ flags: 2, body }), { topic: 't', text: 'hi', id: 0x1234 });
});

function client(net, url, events = [], timers = manualTimers()) {
  const mqtt = createMqtt({
    url,
    clientId: 'test',
    WebSocketImpl: net.WebSocket,
    timers,
    onopen: () => events.push('open'),
    onmessage: (topic, text) => events.push(`${topic}=${text}`),
    onclose: () => events.push('close'),
  });
  return { mqtt, events, timers };
}

test('a client connects, subscribes, and receives live and retained messages', async () => {
  const net = createNetwork(['wss://b']);
  const broker = net.brokers.get('wss://b');
  const a = client(net, 'wss://b');
  await until(() => a.mqtt.up, 'a connected');
  assert.deepEqual(a.events, ['open']);
  assert.deepEqual(broker.protocolErrors, []);
  assert.equal(a.mqtt.publish('r/keep', 'kept', true), true);
  const b = client(net, 'wss://b');
  await until(() => b.mqtt.up, 'b connected');
  b.mqtt.subscribe('r/+');
  await until(() => b.events.includes('r/keep=kept'), 'the retained message');
  a.mqtt.publish('r/live', 'now');
  await until(() => b.events.includes('r/live=now'), 'the live message');
  assert.equal(broker.retained.has('r/live'), false, 'not retained when not asked');
  a.mqtt.publish('r/keep', '', true);
  await until(() => !broker.retained.has('r/keep'), 'the delete');
  a.mqtt.close();
  b.mqtt.close();
  assert.deepEqual(broker.protocolErrors, []);
});

test('a broker that is down or refuses ends the client once, at once', async () => {
  const net = createNetwork(['wss://down', 'wss://refuse']);
  net.brokers.get('wss://down').down = true;
  net.brokers.get('wss://refuse').refuse = true;
  const down = client(net, 'wss://down');
  await until(() => down.events.includes('close'), 'down: close');
  assert.deepEqual(down.events, ['close']);
  const refused = client(net, 'wss://refuse');
  await until(() => refused.events.includes('close'), 'refused: close');
  assert.deepEqual(refused.events, ['close']);
  assert.equal(refused.mqtt.publish('t', 'x'), false, 'nothing is sent on a closed client');
});

test('a connection that never answers is given up after connectMs', async () => {
  const net = createNetwork(['wss://silent']);
  const broker = net.brokers.get('wss://silent');
  broker.handle = () => {}; // accepts the socket, never answers CONNECT
  const silent = client(net, 'wss://silent');
  await settle();
  assert.deepEqual(silent.events, []);
  silent.timers.advance(10000);
  assert.deepEqual(silent.events, ['close']);
});

test('a lost connection is reported, and an idle one is kept alive with pings', async () => {
  const net = createNetwork(['wss://b']);
  const broker = net.brokers.get('wss://b');
  const a = client(net, 'wss://b');
  await until(() => a.mqtt.up, 'connected');
  const before = a.timers.size;
  a.timers.advance(30000); // keep-alive 60 s: a ping every 30 s
  assert.equal(a.timers.size, before, 'the next ping is armed');
  broker.drop();
  await until(() => a.events.includes('close'), 'the drop');
  assert.deepEqual(a.events, ['open', 'close']);
});
