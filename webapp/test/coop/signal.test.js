import test from 'node:test';
import assert from 'node:assert/strict';
import { createMqtt } from '../../src/coop/mqtt.js';
import { createHub, matches } from '../../src/coop/signal.js';
import {
  createNetwork, manualTimers, settle, until,
} from './fake-broker.js';

const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));

// A device: its own hub on the shared network, its own clock.
function device(net, extra = {}) {
  const timers = manualTimers();
  const hub = createHub({
    brokers,
    timers,
    random: () => 1,
    connect: (url, handlers) => createMqtt({
      url, clientId: 'c', WebSocketImpl: net.WebSocket, timers, ...handlers,
    }),
    ...extra,
  });
  const got = [];
  const listen = filter => hub.subscribe(filter, (topic, text) => got.push(`${topic}=${text}`));
  return {
    hub, timers, got, listen,
  };
}

test('topic filters: exact, + for one level, # for the rest', () => {
  assert.ok(matches('a/b', 'a/b'));
  assert.ok(!matches('a/b', 'a/c'));
  assert.ok(matches('a/+', 'a/x'));
  assert.ok(!matches('a/+', 'a/x/y'));
  assert.ok(!matches('a/+/c', 'a/x'));
  assert.ok(matches('a/#', 'a/x/y'));
  assert.ok(matches('a/+/c', 'a/x/c'));
  assert.ok(!matches('a', 'a/b'));
});

test('a message goes to every broker and is delivered once, whatever the brokers', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  const b = device(net);
  b.listen('r/+');
  await until(() => a.hub.report() === 'signal mq 0.00s · hv 0.00s · em 0.00s'
    && b.hub.report().includes('em 0.00s'), 'both connected');
  a.hub.publish('r/one', 'hello');
  await until(() => b.got.length > 0, 'delivery');
  await settle();
  assert.deepEqual(b.got, ['r/one=hello']);
  for (const broker of net.brokers.values()) {
    assert.equal(broker.retained.get('r/one'), 'hello', `${broker.url} holds it`);
  }
});

test('one broker down, then all down: the others carry it; the report says which', async () => {
  const net = createNetwork(URLS);
  net.brokers.get('wss://hv').down = true;
  const a = device(net);
  const b = device(net);
  b.listen('r/+');
  await until(() => a.hub.anyUp() && b.hub.anyUp(), 'connected');
  await settle();
  assert.match(a.hub.report(), /^signal mq [\d.]+s · hv x · em [\d.]+s$/);
  a.hub.publish('r/one', 'hello');
  await until(() => b.got.length === 1, 'delivery via the two');
  net.brokers.forEach(broker => broker.drop());
  net.brokers.forEach(broker => {
    broker.down = true;
  });
  await until(() => !a.hub.anyUp(), 'all lost');
  assert.equal(a.hub.report(), 'signal mq x · hv x · em x');
});

test('a late subscriber gets the retained message; clear removes it everywhere', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  await until(() => a.hub.anyUp(), 'connected');
  a.hub.publish('r/open', 'sealed');
  await settle();
  const late = device(net);
  late.listen('r/open');
  await until(() => late.got.length === 1, 'the retained message');
  a.hub.clear('r/open');
  await settle();
  net.brokers.forEach(broker => assert.equal(broker.retained.has('r/open'), false));
  const later = device(net);
  later.listen('r/open');
  await settle();
  assert.deepEqual(later.got, []);
});

test('a lost broker is reconnected after a growing wait, and gets the messages again', async () => {
  const net = createNetwork(URLS);
  const broker = net.brokers.get('wss://mq');
  const a = device(net);
  await until(() => a.hub.report().includes('mq 0.00s'), 'connected');
  a.hub.publish('r/one', 'sealed');
  await settle();
  broker.retained.clear();
  broker.down = true;
  broker.drop();
  await until(() => a.hub.report().includes('mq x'), 'mq lost');
  const connects = broker.connects;
  a.timers.advance(700); // 1000 ms * (0.5 + 1 / 2)
  await settle();
  assert.equal(a.hub.report().includes('mq x'), true, 'still down: tried again');
  broker.down = false;
  a.timers.advance(2100); // the second wait is 2 s
  await until(() => a.hub.report().includes('mq 0.00s'), 'mq back');
  assert.ok(broker.connects > connects);
  await until(() => broker.retained.get('r/one') === 'sealed', 'republished after the reconnect');
});

test('what waits for an answer is sent again a few times, no more', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  await until(() => !a.hub.report().includes(' x'), 'all up');
  const broker = net.brokers.get('wss://mq');
  a.hub.publish('r/ask', 'sealed', { repeat: 2 });
  await settle();
  for (let i = 0; i < 6; i++) {
    a.timers.advance(3000);
    await settle(5);
  }
  const sent = broker.log.filter(entry => entry.topic === 'r/ask').length;
  assert.equal(sent, 3, 'once and twice more');
  a.hub.publish('r/once', 'x');
  await settle();
  a.timers.advance(30000);
  await settle();
  assert.equal(broker.log.filter(entry => entry.topic === 'r/once').length, 1);
});

test('wake: down brokers are tried at once and everything is sent again', async () => {
  const net = createNetwork(URLS);
  const broker = net.brokers.get('wss://hv');
  broker.down = true;
  const a = device(net);
  await until(() => a.hub.anyUp() && a.hub.report().includes('hv x'), 'hv failed');
  a.hub.publish('r/one', 'sealed');
  broker.down = false;
  a.hub.wake();
  await until(() => a.hub.report().includes('hv 0.00s'), 'hv connected by wake');
  await until(() => broker.retained.get('r/one') === 'sealed', 'sent to it');
});

test('a message that is too long, or empty, is not delivered; close ends everything', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  const b = device(net);
  b.listen('r/#');
  await until(() => a.hub.anyUp() && b.hub.anyUp(), 'up');
  a.hub.publish('r/long', 'x'.repeat(4001));
  a.hub.publish('r/short', 'x'.repeat(4000));
  await until(() => b.got.length === 1, 'the short one');
  assert.equal(b.got[0].startsWith('r/short='), true);
  a.hub.close();
  await until(() => !a.hub.anyUp(), 'closed');
  a.timers.advance(60000);
  await settle();
  assert.equal(a.hub.anyUp(), false, 'no reconnect after close');
  assert.equal(a.timers.size, 0);
});
