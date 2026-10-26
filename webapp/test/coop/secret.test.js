import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveResume, deriveRoom, fingerprint, isPublicKey, keyOfSecret, makeToken, newId, newPair,
  newSecret, pairKey, pairSecret, seal,
  signalSupported, splitToken, unseal,
} from '../../src/coop/secret.js';

test('a secret is 22 characters of base64url, and secrets differ', () => {
  const secret = newSecret();
  assert.match(secret, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(secret, newSecret());
  assert.match(newId(), /^[A-Za-z0-9_-]{11}$/);
  assert.ok(signalSupported() || typeof WebSocket !== 'function');
});

test('the room and the key come from the secret, the same every time, and differ', async () => {
  const secret = newSecret();
  const a = await deriveRoom(secret);
  const b = await deriveRoom(secret);
  assert.equal(a.room, b.room);
  assert.match(a.room, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a.room, secret, 'the room id must not reveal the secret');
  assert.notEqual((await deriveRoom(newSecret())).room, a.room);
  const sealed = await seal(a.key, 't', { x: 1 });
  assert.deepEqual(await unseal(b.key, 't', sealed), { x: 1 }, 'the same secret, the same key');
  await assert.rejects(deriveRoom('short'), /bad code/);
  await assert.rejects(deriveRoom('!'.repeat(22)), /bad code/);
});

test('seal and unseal: round trip, fresh iv, and every kind of tampering is refused', async () => {
  const { key } = await deriveRoom(newSecret());
  const one = await seal(key, 'a/b', { hi: 'Anna' });
  const two = await seal(key, 'a/b', { hi: 'Anna' });
  assert.notEqual(one, two, 'a fresh random iv each time');
  assert.match(one, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await unseal(key, 'a/b', one), { hi: 'Anna' });
  assert.equal(await unseal(key, 'a/c', one), null, 'another topic');
  assert.equal(await unseal((await deriveRoom(newSecret())).key, 'a/b', one), null, 'another key');
  const flipped = one.slice(0, 20) + (one[20] === 'A' ? 'B' : 'A') + one.slice(21);
  assert.equal(await unseal(key, 'a/b', flipped), null, 'a changed character');
  assert.equal(await unseal(key, 'a/b', one.slice(0, -4)), null, 'cut short');
  assert.equal(await unseal(key, 'a/b', ''), null);
  assert.equal(await unseal(key, 'a/b', '***'), null);
});

test('two sides derive the same shared key from each other\'s public key', async () => {
  const host = await newPair();
  const guest = await newPair();
  assert.ok(isPublicKey(host.pub) && isPublicKey(guest.pub));
  const forHost = await pairKey(host.priv, guest.pub, 'room1');
  const forGuest = await pairKey(guest.priv, host.pub, 'room1');
  const offer = await seal(forHost, 't', { offer: 'x' });
  assert.deepEqual(await unseal(forGuest, 't', offer), { offer: 'x' });
  const third = await newPair();
  const other = await pairKey(third.priv, guest.pub, 'room1');
  assert.equal(await unseal(forGuest, 't', await seal(other, 't', { offer: 'x' })), null);
  const elsewhere = await pairKey(host.priv, guest.pub, 'room2');
  const strange = await seal(elsewhere, 't', {});
  assert.equal(await unseal(forGuest, 't', strange), null, 'the room is mixed in');
  await assert.rejects(pairKey(host.priv, 'nope', 'r'), /bad key/);
});

test('the token: the secret, then the fingerprint that pins the host key', async () => {
  const secret = newSecret();
  const host = await newPair();
  const token = await makeToken(secret, host.pub);
  assert.equal(token.length, 44);
  assert.deepEqual(splitToken(token), { secret, fingerprint: await fingerprint(host.pub) });
  assert.notEqual(await fingerprint((await newPair()).pub), await fingerprint(host.pub));
  assert.throws(() => splitToken(secret), /bad code/, 'a bare secret is no token');
  assert.throws(() => splitToken(`${token}x`), /bad code/);
  assert.throws(() => splitToken(null), /bad code/);
});

test('the pair secret: the same on both sides; gives a join key and a resume room', async () => {
  const host = await newPair();
  const guest = await newPair();
  const mine = await pairSecret(host.priv, guest.pub, 'r');
  const theirs = await pairSecret(guest.priv, host.pub, 'r');
  assert.equal(mine.length, 16);
  assert.deepEqual(mine, theirs);
  assert.notDeepEqual(await pairSecret(host.priv, guest.pub, 'other'), mine);
  const sealed = await seal(await keyOfSecret(mine), 't', { x: 1 });
  assert.deepEqual(await unseal(await pairKey(guest.priv, host.pub, 'r'), 't', sealed), { x: 1 });

  const a = await deriveResume(mine);
  const b = await deriveResume(theirs);
  assert.equal(a.room, b.room);
  assert.match(a.room, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(await unseal(b.key, 't', await seal(a.key, 't', { y: 2 })), { y: 2 });
  const third = await pairSecret(host.priv, (await newPair()).pub, 'r');
  assert.notEqual((await deriveResume(third)).room, a.room);
  const stranger = (await deriveRoom(newSecret())).key;
  assert.equal(await unseal(stranger, 't', await seal(a.key, 't', {})), null);
});
