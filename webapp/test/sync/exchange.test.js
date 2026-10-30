import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOTD_KEY } from '../../src/features/stats-store.js';
import { RULES_SEEN_KEY } from '../../src/features/rules-seen.js';
import { packSlice, SLICE_MAX } from '../../src/core/sync/slice.js';
import { createSync } from '../../src/platform/sync/engine.js';
import {
  createReassembler, exchange, FRAME_MAX, MESSAGE_MAX, PARTS_MAX, toFrames,
} from '../../src/platform/sync/proto.js';
import { channelPair, manualTimers, memoryStorage, nextTurn } from './helpers.js';

const rules = (...ids) => JSON.stringify(
  { v: 1, seen: Object.fromEntries(ids.map(id => [id, true])) });
const both = (x, y) => Promise.all([
  exchange({ channel: x.channel, sync: x.sync }), exchange({ channel: y.channel, sync: y.sync }),
]);

async function device(initial = {}, enable = true) {
  const storage = memoryStorage(initial);
  const sync = createSync({ storage });
  await sync.init();
  if (enable) await sync.enable({ p2p: true });
  return { storage, sync };
}

const seenOf = async (d, id) => {
  const raw = await d.storage.get(RULES_SEEN_KEY);
  const view = d.sync.view(RULES_SEEN_KEY, raw ? JSON.parse(raw.value) : null);
  return Boolean(view && view.seen[id] === true);
};

test('two devices trade their slices both ways and both end up with both', async () => {
  const [a, b] = [await device({ [RULES_SEEN_KEY]: rules('cutout') }),
    await device({ [RULES_SEEN_KEY]: rules('arrows') })];
  const { a: ca, b: cb } = channelPair();
  const [ra, rb] = await Promise.all([
    exchange({ channel: ca, sync: a.sync }), exchange({ channel: cb, sync: b.sync }),
  ]);
  assert.deepEqual([ra.received, ra.sent, ra.peer], [1, 1, b.sync.status().dev]);
  assert.deepEqual([rb.received, rb.sent, rb.peer], [1, 1, a.sync.status().dev]);
  for (const d of [a, b]) assert.ok(await seenOf(d, 'cutout') && await seenOf(d, 'arrows'));
});

test('a second exchange has nothing new to say', async () => {
  const [a, b] = [await device({ [RULES_SEEN_KEY]: rules('cutout') }), await device()];
  for (let round = 0; round < 2; round++) {
    const { a: ca, b: cb } = channelPair();
    const [ra, rb] = await Promise.all([
      exchange({ channel: ca, sync: a.sync }), exchange({ channel: cb, sync: b.sync }),
    ]);
    assert.deepEqual([ra.received, rb.received], [0, round === 0 ? 1 : 0]);
  }
});

test('devices that never meet converge through a third (gossip)', async () => {
  const a = await device({ [RULES_SEEN_KEY]: rules('cutout') });
  const [b, c] = [await device(), await device()];
  for (const [x, y] of [[a, b], [b, c]]) {
    const { a: cx, b: cy } = channelPair();
    await both({ channel: cx, sync: x.sync }, { channel: cy, sync: y.sync });
  }
  assert.ok(await seenOf(c, 'cutout'), 'C learned from A through B');
  assert.equal(c.sync.status().devices, 2, 'itself and A; B has no data, so no slice to count');
});

test('a big slice goes over in parts, each short enough for a data channel', async () => {
  const records = {};
  let count = 0;
  for (;;) { // grow the records until the packed slice is about 12 KB (16 KB is the limit)
    const date = String(20200101 + count++);
    const stats = { a: Math.random(), b: Math.random() };
    records[date] = { solved: true, time: Math.random() * 1000, stats };
    const keys = { [GOTD_KEY]: { v: 2, a: records, n: count } };
    const slice = { v: 1, dev: 'AAAAAAAAAAA', seq: 1, keys };
    if (count % 20 === 0 && (await packSlice(slice)).length > 12000) break;
  }
  const a = await device({ [GOTD_KEY]: JSON.stringify({ v: 2, a: records, n: count }) });
  const b = await device();
  const { a: ca, b: cb, log } = channelPair();
  await both({ channel: ca, sync: a.sync }, { channel: cb, sync: b.sync });
  const parts = log.a.filter(text => JSON.parse(text).t === 'part');
  assert.ok(parts.length > 1, `${parts.length} parts`);
  assert.ok(log.a.every(text => text.length <= FRAME_MAX));
  const got = b.sync.view(GOTD_KEY, null);
  assert.equal(Object.keys(got.a).length, count);
  assert.equal(got.n, count);
});

test('a silent peer ends in a timeout, a closed channel in "closed"', async () => {
  const a = await device();
  const timers = manualTimers();
  const { a: ca } = channelPair();
  const waiting = exchange({ channel: ca, sync: a.sync, timers });
  await nextTurn();
  assert.equal(timers.count, 1);
  timers.fire();
  await assert.rejects(waiting, /timeout/);
  assert.equal(ca.onmessage, null, 'the handlers are let go');

  const { a: c1, b: c2 } = channelPair();
  const closing = exchange({ channel: c1, sync: a.sync });
  await nextTurn();
  c2.close();
  await assert.rejects(closing, /closed/);
});

test('sync that is off refuses the exchange before it says anything', async () => {
  const off = await device({}, false);
  const { a: ca, log } = channelPair();
  await assert.rejects(exchange({ channel: ca, sync: off.sync }), /off/);
  assert.deepEqual(log.a, []);
});

async function peerSays(texts, sync) {
  const { a: ca, b: cb } = channelPair();
  const result = exchange({ channel: ca, sync });
  await nextTurn();
  for (const text of texts) cb.send(text);
  return result;
}

test('a peer with another protocol version, or this device\'s own id, is refused', async () => {
  const a = await device();
  const dev = 'BBBBBBBBBBB';
  const hello = over => [JSON.stringify({ t: 'hello', v: 1, dev, have: {}, ...over })];
  await assert.rejects(peerSays(hello({ v: 2 }), a.sync), /version/);
  await assert.rejects(peerSays(hello({ dev: 'bad' }), a.sync), /version/);
  await assert.rejects(peerSays(
    [JSON.stringify({ t: 'hello', v: 1, dev: a.sync.status().dev, have: {} })], a.sync), /self/);
});

test('garbage from the peer is counted, and too much of it ends the exchange', async () => {
  const a = await device();
  const junk = Array.from({ length: 12 },
    (_, i) => (i % 2 ? 'not json' : JSON.stringify({ t: 'what' })));
  await assert.rejects(peerSays(junk, a.sync), /bad/);
  // a slice message that is no slice is garbage too, and so is a slice before the hello
  const noSlice = JSON.stringify({ t: 'slice', d: 'AAAA' });
  await assert.rejects(peerSays(Array(12).fill(noSlice), a.sync), /bad/);
});

test('a hostile slice from the peer cannot change what the device keeps '
  + 'outside the synced keys', async () => {
  const a = await device();
  const b = await device({ [RULES_SEEN_KEY]: rules('x') });
  const { a: ca, b: cb } = channelPair();
  await both({ channel: ca, sync: a.sync }, { channel: cb, sync: b.sync });
  assert.deepEqual([...a.storage.raw.keys()].sort(), ['zip_sync', 'zip_sync_f']);
});

test('toFrames and the reassembler: short messages as they are, long ones in order', () => {
  const small = { t: 'done' };
  assert.deepEqual(toFrames(small), [JSON.stringify(small)]);
  const long = { t: 'slice', d: 'x'.repeat(40000) };
  const frames = toFrames(long, 'id1');
  assert.ok(frames.length > 2 && frames.every(f => f.length <= FRAME_MAX));
  const re = createReassembler();
  const out = frames.map(f => re.push(f));
  assert.deepEqual(out.slice(0, -1), Array(frames.length - 1).fill(undefined));
  assert.deepEqual(out.at(-1), long);
  assert.throws(() => toFrames({ t: 'slice', d: 'x'.repeat(MESSAGE_MAX * 2) }), RangeError);
});

test('the reassembler refuses what is out of order, too long, or not a message', () => {
  const frames = toFrames({ t: 'slice', d: 'x'.repeat(40000) }, 'id1');
  let re = createReassembler();
  re.push(frames[0]);
  assert.throws(() => re.push(frames[2]), /bad frame/, 'part 2 before part 1');
  re = createReassembler();
  assert.throws(() => re.push(frames[1]), /bad frame/, 'starts with part 1');
  for (const bad of ['', 'null', '[]', '5', '{"t":5}', '{}', 'x'.repeat(FRAME_MAX + 2000),
    JSON.stringify({ t: 'part', id: 'a', i: 0, n: PARTS_MAX + 1, d: 'x' }),
    JSON.stringify({ t: 'part', id: 'a', i: 0, n: 1, d: 'x' }),
    JSON.stringify({ t: 'part', id: 'a', i: 0, n: 3, d: 5 }), 42, null]) {
    assert.throws(() => createReassembler().push(bad), /bad frame/, String(bad).slice(0, 30));
  }
  re = createReassembler();
  re.push(frames[0]);
  assert.deepEqual(re.push('{"t":"done"}'), { t: 'done' }, 'a whole message drops a half one');
  assert.ok(SLICE_MAX > 0);
});
