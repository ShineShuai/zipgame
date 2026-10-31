// Linking devices (platform/sync/p2p.js) over the fake brokers of the co-op tests and a fake
// WebRTC: two pages with a real engine each, a link made on one and opened on the other.
// src/coop is a removable trial (test/check.js): it is loaded here, not imported, and the tests
// that need it are skipped when it is gone.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { RULES_SEEN_KEY } from '../../src/features/rules-seen.js';
import { createSync } from '../../src/platform/sync/engine.js';
import {
  createP2p, deviceLabel, GAP_MS, INVITE_MS, linkOf, tokenOfHash,
} from '../../src/platform/sync/p2p.js';
import { memoryStorage } from './helpers.js';

const present = existsSync(new URL('../../src/coop/join.js', import.meta.url));
const load = async path => (present ? import(path) : {});
const { hostRoom, joinRoom } = await load('../../src/coop/join.js');
const { createMqtt } = await load('../../src/coop/mqtt.js');
const { resumeRoom } = await load('../../src/coop/resume.js');
const { createHub } = await load('../../src/coop/signal.js');
const { createNetwork, manualTimers, until } = await load('../coop/fake-broker.js');
const coopTest = (name, fn) => test(name, { skip: present ? false : 'src/coop was removed' }, fn);

const URLS = ['wss://mq', 'wss://hv', 'wss://em'];
const brokers = URLS.map((url, i) => ({ id: ['mq', 'hv', 'em'][i], url }));
const rules = (...ids) => JSON.stringify(
  { v: 1, seen: Object.fromEntries(ids.map(id => [id, true])) });

// What rtc.js does, without WebRTC: a host's offer is looked up by the guest, and the two
// channels are joined; the host's channel opens only then, as a real one does.
function fakeRtc() {
  const offers = new Map();
  let count = 0;
  const channel = opened => ({
    opened, onopen: null, onmessage: null, onclose: null, closed: false, peer: null,
    send(text) {
      const peer = this.peer;
      setTimeout(() => { if (peer && !peer.closed) peer.onmessage?.(text); }, 0);
    },
    close() { this.closed = true; },
  });
  const connection = opened => ({
    channel: channel(opened), close() { this.channel.close(); },
  });
  return {
    createInvite: async () => {
      const code = `offer-${++count}`;
      const host = connection(false);
      offers.set(code, host);
      return { code, connection: host };
    },
    acceptReply: async () => {},
    joinInvite: async text => {
      const host = offers.get(text);
      const guest = connection(true);
      host.channel.peer = guest.channel;
      guest.channel.peer = host.channel;
      host.channel.opened = true;
      host.channel.onopen?.();
      return { code: `answer-${text}`, connection: guest };
    },
  };
}

async function node(net, rtc, label, data = {}) {
  const timers = manualTimers();
  const { WebSocket } = net.device();
  const storage = memoryStorage(data);
  const sync = createSync({ storage });
  await sync.init();
  let clock = 1_000_000;
  const coop = async () => ({
    hostRoom,
    joinRoom,
    resumeRoom,
    createHub: options => createHub({
      ...options, timers, random: () => 1,
      connect: (url, handlers) => createMqtt({
        url, clientId: 'c', WebSocketImpl: WebSocket, timers, ...handlers,
      }),
    }),
    brokers,
    supported: () => true,
    rtc,
    timers,
  });
  const p2p = createP2p({
    sync, coop, timers, now: () => clock, name: () => label,
    pageUrl: () => 'https://zip.test/play',
  });
  const events = [];
  p2p.onEvent(event => events.push(event));
  return {
    storage, sync, p2p, events, timers,
    advance: ms => { clock += ms; timers.advance(ms); },
    seen: type => events.some(event => event.type === type),
    failed: reason => events.some(e => e.type === 'failed' && (!reason || e.reason === reason)),
  };
}

async function linked() {
  const net = createNetwork(URLS);
  const rtc = fakeRtc();
  const a = await node(net, rtc, 'Chrome · Mac', { [RULES_SEEN_KEY]: rules('cutout') });
  const b = await node(net, rtc, 'Safari · iPhone', { [RULES_SEEN_KEY]: rules('arrows') });
  const invite = await a.p2p.invite();
  const token = tokenOfHash(new URL(invite.link).hash);
  await b.p2p.join(token);
  await until(() => a.seen('linked') && b.seen('linked'), 'both devices linked');
  return { net, rtc, a, b, invite };
}

const seenIn = async (d, id) => {
  const raw = await d.storage.get(RULES_SEEN_KEY);
  const view = d.sync.view(RULES_SEEN_KEY, raw ? JSON.parse(raw.value) : null);
  return Boolean(view && view.seen[id]);
};

coopTest('a link made on one device and opened on the other links them, both ways', async () => {
  const { a, b, invite } = await linked();
  assert.match(invite.link, /^https:\/\/zip\.test\/play#y=[A-Za-z0-9_-]{44}$/);
  assert.ok(a.seen('waiting'));
  for (const [x, y] of [[a, b], [b, a]]) {
    assert.ok(await seenIn(x, 'cutout') && await seenIn(x, 'arrows'), 'both have both');
    const [peer] = x.sync.peers();
    assert.equal(peer.dev, y.sync.status().dev);
    assert.ok(peer.secret.length === 22);
  }
  assert.deepEqual([a.sync.peers()[0].pid, b.sync.peers()[0].pid], [0, 1]);
  assert.equal(a.sync.peers()[0].name, 'Safari · iPhone', 'the host learns the guest\'s name');
  assert.equal(b.sync.peers()[0].name, 'Chrome · Mac', 'and the guest the host\'s');
  assert.deepEqual([a.sync.status().p2p, b.sync.status().p2p], [true, true]);
});

coopTest('linked devices find each other again, by themselves, and trade what is '
  + 'new', async () => {
  const { a, b } = await linked();
  await a.storage.set(RULES_SEEN_KEY, rules('cutout', 'exact'));
  await b.storage.set(RULES_SEEN_KEY, rules('arrows', 'wrap'));
  a.events.length = 0;
  b.events.length = 0;
  await Promise.all([a.p2p.resume({ force: true }), b.p2p.resume({ force: true })]);
  await until(() => a.seen('synced') && b.seen('synced'), 'the two meet again', 8000);
  for (const d of [a, b]) {
    for (const id of ['cutout', 'arrows', 'exact', 'wrap']) assert.ok(await seenIn(d, id), id);
  }
  assert.ok(a.sync.peers()[0].at > 0);
});

coopTest('looking again is not done too soon, unless the player asks (force)', async () => {
  const { a } = await linked();
  assert.equal(await a.p2p.resume(), 1);
  assert.equal(await a.p2p.resume(), 0, 'a window is open');
  a.p2p.stop();
  assert.equal(await a.p2p.resume(), 0, 'too soon after the last one');
  a.advance(GAP_MS + 1);
  assert.equal(await a.p2p.resume(), 1, 'after the gap');
  a.p2p.stop();
  assert.equal(await a.p2p.resume({ force: true }), 1);
  a.p2p.stop();
});

coopTest('a device with sync off does not look for anybody', async () => {
  const net = createNetwork(URLS);
  const a = await node(net, fakeRtc(), 'x');
  assert.equal(await a.p2p.resume({ force: true }), 0);
  assert.equal(a.sync.status().enabled, false);
});

coopTest('a link that nobody opens runs out, and sync that it turned on goes off '
  + 'again', async () => {
  const net = createNetwork(URLS);
  const a = await node(net, fakeRtc(), 'x');
  await a.p2p.invite();
  assert.equal(a.sync.enabled(), true, 'on while the link is waiting');
  a.advance(INVITE_MS + 1000);
  await until(() => a.failed('expired'), 'the link to expire');
  await until(() => !a.sync.enabled(), 'sync to go off again');
});

coopTest('cancelling a link, on either side, turns off what it had turned on', async () => {
  const net = createNetwork(URLS);
  const a = await node(net, fakeRtc(), 'x');
  const invite = await a.p2p.invite();
  await invite.cancel();
  assert.ok(a.seen('cancelled'));
  assert.equal(a.sync.enabled(), false);
  const b = await node(net, fakeRtc(), 'y');
  const join = await b.p2p.join('A'.repeat(44));
  assert.equal(b.sync.enabled(), true);
  await join.cancel();
  assert.equal(b.sync.enabled(), false);
});

coopTest('a device that already syncs stays on when a further link fails', async () => {
  const { a } = await linked();
  const again = await a.p2p.invite();
  await again.cancel();
  assert.equal(a.sync.enabled(), true);
  assert.equal(a.sync.peers().length, 1);
});

coopTest('a link is used once: the room is closed, so a second device finds nobody', async () => {
  const net = createNetwork(URLS);
  const rtc = fakeRtc();
  const a = await node(net, rtc, 'host');
  const b = await node(net, rtc, 'first');
  const c = await node(net, rtc, 'second');
  const invite = await a.p2p.invite();
  const token = tokenOfHash(new URL(invite.link).hash);
  await b.p2p.join(token);
  await until(() => a.seen('linked') && b.seen('linked'), 'the first to link');
  await c.p2p.join(token);
  c.advance(4000); // nobody tells it the room is open: it asks anyway
  await until(() => c.events.some(e => e.stage === 'asked'), 'the second to ask');
  await until(() => { // time passes by hand until its patience is used up
    c.advance(30000);
    return c.failed('timeout');
  }, 'the second to give up', 8000);
  await until(() => !c.sync.enabled(), 'sync to stay off on the second');
  assert.equal(a.sync.peers().length, 1);
});

coopTest('the way is not offered where src/coop or the browser cannot do it', async () => {
  const net = createNetwork(URLS);
  const rtc = fakeRtc();
  const sync = createSync({ storage: memoryStorage() });
  await sync.init();
  const gone = createP2p({ sync, coop: async () => { throw new Error('no folder'); } });
  assert.equal(await gone.supported(), false);
  await assert.rejects(gone.invite(), /no folder/);
  assert.equal(sync.enabled(), false);
  const a = await node(net, rtc, 'x');
  assert.equal(await a.p2p.supported(), true);
  const blind = createP2p({
    sync, coop: async () => ({ supported: () => false }),
  });
  assert.equal(await blind.supported(), false);
});

test('links: the fragment is read strictly, and made as the page address plus #y=', () => {
  const token = 'a'.repeat(22) + 'B'.repeat(22);
  assert.equal(tokenOfHash(`#y=${token}`), token);
  for (const bad of ['', '#y=', '#y=short', `#j=${token}`, `#y=${token}x`, `#y=${token}&z=1`,
    ` #y=${token}`, '#y=' + 'é'.repeat(44), null, undefined]) {
    assert.equal(tokenOfHash(bad), null, String(bad));
  }
  assert.equal(linkOf('https://a.b/c', token), `https://a.b/c#y=${token}`);
});

test('a device is named from its browser and system, short and printable', () => {
  const moz = 'Mozilla/5.0 ';
  const webkit = 'AppleWebKit/537.36 (KHTML, like Gecko) ';
  const cases = [
    [`${moz}(iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 `
      + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
    [`${moz}(Macintosh; Intel Mac OS X 10_15_7) ${webkit}Chrome/120.0.0.0 Safari/537.36`,
      'Chrome · Mac'],
    [`${moz}(Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0`,
      'Firefox · Windows'],
    [`${moz}(Linux; Android 14) ${webkit}Chrome/120.0.0.0 Mobile Safari/537.36`,
      'Chrome · Android'],
    [`${moz}(Windows NT 10.0; Win64; x64) ${webkit}Chrome/120.0 Safari/537.36 Edg/120.0`,
      'Edge · Windows'],
    ['', ''], [undefined, ''], ['curl/8.0', ''],
  ];
  for (const [ua, label] of cases) assert.equal(deviceLabel(ua), label, String(ua).slice(0, 40));
});
