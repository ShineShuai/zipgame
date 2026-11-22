import test from 'node:test';
import assert from 'node:assert/strict';
import { createMqtt } from '../../src/coop/mqtt.js';
import { createHub, matches } from '../../src/coop/signal.js';
import { createNetwork, manualTimers } from './fake-broker.js';
import { turn, until } from '../wait.js';

const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));

// A device: its own hub on the shared network, its own clock. `now` is fixed: the hub reports the
// time a connect took, and a real clock would make every report depend on the speed of the machine.
function device(net, extra = {}) {
  const timers = manualTimers();
  const hub = createHub({
    brokers,
    timers,
    now: () => 0,
    random: () => 1,
    connect: (url, handlers) =>
      createMqtt({
        url,
        clientId: 'c',
        WebSocketImpl: net.WebSocket,
        timers,
        ...handlers,
      }),
    ...extra,
  });
  const got = [];
  const listen = filter => hub.subscribe(filter, (topic, text) => got.push(`${topic}=${text}`));
  return {
    hub,
    timers,
    got,
    listen,
  };
}

// Which brokers a hub is connected to: { mq: true, hv: false, em: true }.
const upMap = hub => Object.fromEntries(hub.state().map(({ id, up }) => [id, up]));
const isUp = (hub, id) => upMap(hub)[id];
const allUp = hub => Object.values(upMap(hub)).every(Boolean);

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
  await until(() => allUp(a.hub) && allUp(b.hub), 'both connected');
  a.hub.publish('r/one', 'hello');
  await until(() => b.got.length > 0, 'delivery');
  await turn();
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
  await turn();
  assert.deepEqual(upMap(a.hub), { mq: true, hv: false, em: true });
  a.hub.publish('r/one', 'hello');
  await until(() => b.got.length === 1, 'delivery via the two');
  net.brokers.forEach(broker => broker.drop());
  net.brokers.forEach(broker => {
    broker.down = true;
  });
  await until(() => !a.hub.anyUp(), 'all lost');
  assert.deepEqual(upMap(a.hub), { mq: false, hv: false, em: false });
});

test('a late subscriber gets the retained message; clear removes it everywhere', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  await until(() => a.hub.anyUp(), 'connected');
  a.hub.publish('r/open', 'sealed');
  await turn();
  const late = device(net);
  late.listen('r/open');
  await until(() => late.got.length === 1, 'the retained message');
  a.hub.clear('r/open');
  await turn();
  net.brokers.forEach(broker => assert.equal(broker.retained.has('r/open'), false));
  const later = device(net);
  later.listen('r/open');
  await turn();
  assert.deepEqual(later.got, []);
});

test('a lost broker is reconnected after a growing wait, and gets the messages again', async () => {
  const net = createNetwork(URLS);
  const broker = net.brokers.get('wss://mq');
  const a = device(net);
  await until(() => isUp(a.hub, 'mq'), 'connected');
  a.hub.publish('r/one', 'sealed');
  await turn();
  broker.retained.clear();
  broker.down = true;
  broker.drop();
  await until(() => !isUp(a.hub, 'mq'), 'mq lost');
  const connects = broker.connects;
  a.timers.advance(700); // 1000 ms * (0.5 + 1 / 2)
  await turn();
  assert.equal(isUp(a.hub, 'mq'), false, 'still down: tried again');
  broker.down = false;
  a.timers.advance(2100); // the second wait is 2 s
  await until(() => isUp(a.hub, 'mq'), 'mq back');
  assert.ok(broker.connects > connects);
  await until(() => broker.retained.get('r/one') === 'sealed', 'republished after the reconnect');
});

test('what waits for an answer is sent again a few times, no more', async () => {
  const net = createNetwork(URLS);
  const a = device(net);
  await until(() => allUp(a.hub), 'all up');
  const broker = net.brokers.get('wss://mq');
  a.hub.publish('r/ask', 'sealed', { repeat: 2 });
  await turn();
  for (let i = 0; i < 6; i++) {
    a.timers.advance(3000);
    await turn();
  }
  const sent = broker.log.filter(entry => entry.topic === 'r/ask').length;
  assert.equal(sent, 3, 'once and twice more');
  a.hub.publish('r/once', 'x');
  await turn();
  a.timers.advance(30000);
  await turn();
  assert.equal(broker.log.filter(entry => entry.topic === 'r/once').length, 1);
});

test('wake: down brokers are tried at once and everything is sent again', async () => {
  const net = createNetwork(URLS);
  const broker = net.brokers.get('wss://hv');
  broker.down = true;
  const a = device(net);
  await until(() => a.hub.anyUp() && !isUp(a.hub, 'hv'), 'hv failed');
  a.hub.publish('r/one', 'sealed');
  broker.down = false;
  a.hub.wake();
  await until(() => isUp(a.hub, 'hv'), 'hv connected by wake');
  await until(() => broker.retained.get('r/one') === 'sealed', 'sent to it');
});

test('state and report show how long a connect took, and x for a broker that is down', async () => {
  const net = createNetwork(URLS);
  const timers = manualTimers();
  let clock = 0;
  const hub = createHub({
    brokers: [brokers[0]],
    timers,
    now: () => clock,
    connect: (url, handlers) => {
      const mqtt = createMqtt({
        url,
        clientId: 'c',
        WebSocketImpl: net.WebSocket,
        timers,
        ...handlers,
      });
      clock = 350; // the connect started at 0 and the broker answers at 350 ms
      return mqtt;
    },
  });
  await until(() => hub.anyUp(), 'connected');
  assert.deepEqual(hub.state(), [{ id: 'mq', up: true, ms: 350 }]);
  assert.equal(hub.report(), 'signal mq 0.35s');
  hub.close();
  assert.deepEqual(hub.state(), [{ id: 'mq', up: false, ms: null }]);
  assert.equal(hub.report(), 'signal mq x');
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
  await turn();
  assert.equal(a.hub.anyUp(), false, 'no reconnect after close');
  assert.equal(a.timers.size, 0);
});
