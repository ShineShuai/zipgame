import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHRINKS } from '../../src/core/sync/merge.js';
import {
  isDev, isSlice, newDevId, packSlice, SLICE_MAX, sliceFromText, sliceToText, unpackSlice,
  UNPACKED_MAX,
} from '../../src/core/sync/slice.js';

const slice = (keys = {}, seq = 1, dev = newDevId()) => ({ v: 1, dev, seq, keys });

async function deflate(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test('device ids are 11 characters of base64url', () => {
  const ids = new Set(Array.from({ length: 50 }, newDevId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(isDev(id), id);
  for (const bad of ['', 'short', 'x'.repeat(12), 'abc def ghi', null, 5, 'abc/def+ghi']) {
    assert.ok(!isDev(bad), String(bad));
  }
});

test('a slice is an object with version, device, a sequence number and keys', () => {
  assert.ok(isSlice(slice()));
  for (const bad of [null, [], {}, { ...slice(), v: 2 }, { ...slice(), dev: 'x' },
    { ...slice(), seq: -1 }, { ...slice(), seq: 1.5 }, { ...slice(), keys: [] }]) {
    assert.ok(!isSlice(bad), JSON.stringify(bad));
  }
});

test('a packed slice comes back as it was, through bytes and through text', async () => {
  const original = slice({ zip_rules_seen: { v: 1, seen: { cutout: true } } });
  const bytes = await packSlice(original);
  assert.ok(bytes instanceof Uint8Array && bytes.length < SLICE_MAX);
  assert.deepEqual(await unpackSlice(bytes), original);
  const again = sliceFromText(sliceToText(bytes));
  assert.deepEqual(await unpackSlice(again), original);
});

test('anything that is not a packed slice gives null, never an error', async () => {
  const good = await packSlice(slice());
  const cases = [
    null, 'text', [], new Uint8Array(0), new Uint8Array(1), new Uint8Array([9, 1, 2, 3]),
    new Uint8Array([1, 1, 2, 3, 4, 5]), new Uint8Array([0, 123]),
    Uint8Array.of(0, ...new TextEncoder().encode('{"v":1}')),
    Uint8Array.of(0, ...new TextEncoder().encode('[1,2]')),
    Uint8Array.of(0, 0xff, 0xfe, 0xfd),
    good.subarray(0, good.length - 3),
    new Uint8Array(SLICE_MAX + 1),
  ];
  for (const bytes of cases) assert.equal(await unpackSlice(bytes), null);
});

test('a small packed message cannot blow up to more than UNPACKED_MAX', async () => {
  const bomb = await deflate(`{"v":1,"pad":"${'0'.repeat(UNPACKED_MAX * 4)}"}`);
  assert.ok(bomb.length < 3000);
  assert.equal(await unpackSlice(Uint8Array.of(1, ...bomb)), null);
});

test('base64url text that is not base64url gives null', () => {
  for (const bad of ['a', 'ab cd', 'ab+/', 5, null]) assert.equal(sliceFromText(bad), null);
});

test('a slice that is too big loses what its keys can do without, or is refused', async () => {
  const noise = () => Array.from({ length: 20 }, () => (Math.random() * 100).toFixed(3) * 1);
  const t = {};
  const d = {};
  for (let i = 0; i < 200; i++) {
    t[`scope${i}`] = [50, 12.5, 3.25, noise()];
    d[`scope${i}`] = [20000, 3, 12.5, 3.25, noise()];
  }
  const big = slice({ zip_stats_v2: { v: 2, t, d, b: {} } });
  assert.equal(await packSlice(big), null, 'without a shrink rule it does not fit');
  const bytes = await packSlice(big, { shrink: SHRINKS });
  assert.ok(bytes && bytes.length <= SLICE_MAX, 'with the shrink rules it fits');
  const back = await unpackSlice(bytes);
  assert.deepEqual(back.keys.zip_stats_v2.t.scope7, [50, 12.5, 3.25, []]);
  assert.deepEqual(back.keys.zip_stats_v2.d.scope7, [20000, 3, 12.5, 3.25, []]);
  const noShrink = slice({ junk: Array.from({ length: 6000 }, () => Math.random()) });
  assert.equal(await packSlice(noShrink, { shrink: SHRINKS }), null);
});

test('a realistic statistics copy fits as it is, recent times and all', async () => {
  const t = {};
  for (let i = 0; i < 40; i++) {
    const recent = Array.from({ length: 20 }, () => +(Math.random() * 60).toFixed(1));
    t[`scope${i}`] = [50, 12.5, 3.25, recent];
  }
  const copy = slice({ zip_stats_v2: { v: 2, t, d: {}, b: {} } });
  const bytes = await packSlice(copy, { shrink: SHRINKS });
  const back = await unpackSlice(bytes);
  assert.equal(back.keys.zip_stats_v2.t.scope3[3].length, 20);
});
