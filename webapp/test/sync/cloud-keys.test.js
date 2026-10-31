import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveCloudKeys, KDF_ITERATIONS, open, openFromText, seal, sealToText, secretId,
} from '../../src/core/sync/cloud-keys.js';
import { fromBase64Url } from '../../src/core/sync/base64.js';
import { newSecret } from '../../src/core/sync/words.js';

const FAST = 1000; // the real count is for the real thing; the tests only need it to be a count
const bytes = text => new TextEncoder().encode(text);

test('a secret gives the same id, auth and key every time, another secret others',
  async () => {
  const secret = newSecret();
  const one = await deriveCloudKeys(secret, FAST);
  const two = await deriveCloudKeys(secret, FAST);
  assert.match(one.id, /^[0-9a-f]{32}$/);
  assert.match(one.auth, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(one.id, two.id);
  assert.equal(one.auth, two.auth);
  assert.equal(fromBase64Url(one.auth).length, 32);
  const sealed = await seal(one.key, one.id, 'AAAAAAAAAAA', bytes('hello'));
  assert.deepEqual(await open(two.key, one.id, 'AAAAAAAAAAA', sealed), bytes('hello'),
    'the two derivations made the same key');
  const other = await deriveCloudKeys(newSecret(), FAST);
  assert.notEqual(other.id, one.id);
  assert.notEqual(other.auth, one.auth);
  assert.equal(await open(other.key, one.id, 'AAAAAAAAAAA', sealed), null);
});

test('id and auth are independent of each other (one does not give the other)', async () => {
  const { id, auth } = await deriveCloudKeys(newSecret(), FAST);
  assert.ok(!auth.includes(id.slice(0, 8)));
  assert.notEqual(id, fromBase64Url(auth).slice(0, 16).toString());
});

test('the number of rounds changes everything; the real count is slow enough '
  + 'to matter', async () => {
  const secret = newSecret();
  const fast = await deriveCloudKeys(secret, FAST);
  const slower = await deriveCloudKeys(secret, FAST + 1);
  assert.notEqual(fast.id, slower.id);
  assert.equal(KDF_ITERATIONS, 600000);
  const start = performance.now();
  await deriveCloudKeys(secret);
  const ms = performance.now() - start;
  assert.ok(ms > 20, `${ms} ms: 600,000 rounds should not be instant`);
  assert.ok(ms < 20000, `${ms} ms`);
});

test('sealing: what goes in comes out; nonces differ; the tag covers id, '
  + 'device and bytes', async () => {
  const { id, key } = await deriveCloudKeys(newSecret(), FAST);
  const dev = 'BBBBBBBBBBB';
  const plain = bytes('a slice');
  const one = await seal(key, id, dev, plain);
  const two = await seal(key, id, dev, plain);
  assert.notDeepEqual(one, two, 'a new nonce every time');
  assert.equal(one.length, 12 + plain.length + 16);
  assert.deepEqual(await open(key, id, dev, one), plain);
  assert.equal(await open(key, id, 'CCCCCCCCCCC', one), null, 'another device');
  assert.equal(await open(key, 'f'.repeat(32), dev, one), null, 'another id');
  for (const at of [0, 12, one.length - 1]) {
    const changed = one.slice();
    changed[at] ^= 1;
    assert.equal(await open(key, id, dev, changed), null, `byte ${at} changed`);
  }
  const short = one.subarray(0, one.length - 1);
  for (const bad of [null, 'x', new Uint8Array(0), new Uint8Array(27), short]) {
    assert.equal(await open(key, id, dev, bad), null);
  }
});

test('as text: base64url both ways; anything else gives null', async () => {
  const { id, key } = await deriveCloudKeys(newSecret(), FAST);
  const data = await sealToText(key, id, 'AAAAAAAAAAA', bytes('x'.repeat(500)));
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await openFromText(key, id, 'AAAAAAAAAAA', data), bytes('x'.repeat(500)));
  for (const bad of ['', 'a', '!!!', 'AAAA', null, 5]) {
    assert.equal(await openFromText(key, id, 'AAAAAAAAAAA', bad), null);
  }
});

test('no secret, no keys', async () => {
  await assert.rejects(deriveCloudKeys(new Uint8Array(0), FAST), RangeError);
  await assert.rejects(deriveCloudKeys('text', FAST), RangeError);
});

test('a secret\'s short name: 8 characters, the same for the same secret, '
  + 'another for another', async () => {
  const secret = newSecret();
  const sid = await secretId(secret);
  assert.match(sid, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(await secretId(secret), sid);
  assert.notEqual(await secretId(newSecret()), sid);
});
