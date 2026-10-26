import { fromBase64Url, toBase64Url } from './invite.js';

// What keeps a room's messages private on a public broker (signal.js carries them, join.js speaks
// them). The invite link holds a token after "#j=" that no server ever sees: a random secret and
// the fingerprint of the host's public key (a short hash that identifies it). From the secret
// come two independent values: the room (the id that goes into topic names) and a key (AES-GCM,
// encryption that also detects tampering). Whoever reads the broker sees ids and ciphertext only.
// Host and guest also hold ECDH key pairs (each side derives the same shared key from its own
// private and the other's public key); the guest checks the host's public key against the
// fingerprint in the link, so only the real host can answer a guest, and the guest's key
// pair makes the answer to the host's offer unreadable and unforgeable for anyone else. The
// secret alone (a holder of the link) can ask to join, but not read, answer or impersonate.
const SECRET = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{44}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/; // an uncompressed P-256 point: 65 bytes
const text = new TextEncoder();

const subtle = () => globalThis.crypto.subtle;
const random = length => globalThis.crypto.getRandomValues(new Uint8Array(length));

export const signalSupported = () => typeof WebSocket === 'function'
  && typeof globalThis.crypto?.subtle?.deriveKey === 'function';

export const isPublicKey = value => typeof value === 'string' && PUBLIC_KEY.test(value);

// 16 random bytes, 22 characters.
export const newSecret = () => toBase64Url(random(16));

// The first 16 bytes of the SHA-256 hash of a public key, 22 characters.
export async function fingerprint(pub) {
  const hash = await subtle().digest('SHA-256', fromBase64Url(pub));
  return toBase64Url(new Uint8Array(hash).slice(0, 16));
}

// The link's token: the secret, then the fingerprint of the host's public key.
export const makeToken = async (secret, pub) => secret + await fingerprint(pub);

// -> { secret, fingerprint }; throws Error('bad code') for anything else than makeToken's output.
export function splitToken(token) {
  if (!TOKEN.test(String(token))) {
    throw new Error('bad code');
  }
  return { secret: token.slice(0, 22), fingerprint: token.slice(22) };
}

// A short random id, 11 characters (one per guest request).
export const newId = () => toBase64Url(random(8));

async function hkdf(material, salt, info, usage) {
  const base = await subtle()
    .importKey('raw', material, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = {
    name: 'HKDF', hash: 'SHA-256', salt: text.encode(salt), info: text.encode(info),
  };
  return usage === 'bits'
    ? new Uint8Array(await subtle().deriveBits(params, base, 128))
    : subtle().deriveKey(
      params, base, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt'],
    );
}

// -> { room, key }; throws Error('bad code') when `secret` is not one made by newSecret().
export async function deriveRoom(secret) {
  if (!SECRET.test(String(secret))) {
    throw new Error('bad code');
  }
  const material = fromBase64Url(secret);
  return {
    room: toBase64Url(await hkdf(material, 'zipcoop', 'room', 'bits')),
    key: await hkdf(material, 'zipcoop', 'key', 'key'),
  };
}

// `aad` (the topic) is authenticated with the message: it cannot be moved to another topic.
export async function seal(key, aad, value) {
  const iv = random(12);
  const body = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: text.encode(aad) },
    key,
    text.encode(JSON.stringify(value)),
  );
  const out = new Uint8Array(iv.length + body.byteLength);
  out.set(iv);
  out.set(new Uint8Array(body), iv.length);
  return toBase64Url(out);
}

// -> the value, or null for anything that was not sealed with this key and aad.
export async function unseal(key, aad, message) {
  try {
    const bytes = fromBase64Url(message);
    const body = await subtle().decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: text.encode(aad) },
      key,
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

// -> { priv, pub }: a key pair for one guest; pub is sent (base64url), priv stays here.
export async function newPair() {
  const pair = await subtle()
    .generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { priv: pair.privateKey, pub: toBase64Url(raw) };
}

// What two sides share: own private key + the other's public key, `room` mixed in -> 16 bytes.
// It is kept with a game in progress: it lets the two devices find each other again (resumeSecret).
export async function pairSecret(priv, theirPub, room) {
  if (!isPublicKey(theirPub)) {
    throw new Error('bad key');
  }
  const other = await subtle().importKey(
    'raw', fromBase64Url(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  const params = { name: 'ECDH', public: other };
  const bits = new Uint8Array(await subtle().deriveBits(params, priv, 256));
  return hkdf(bits, `zipcoop ${room}`, 'pair', 'bits');
}

// The AES key of a pair secret: what seals the offer and the answer of a join.
export const keyOfSecret = secret => hkdf(secret, 'zipcoop', 'pair key', 'key');

export async function pairKey(priv, theirPub, room) {
  return keyOfSecret(await pairSecret(priv, theirPub, room));
}

// Where and how two devices that played together meet again: { room, key } from their pair
// secret. Nobody else has the secret, so nobody else can read or write there.
export async function deriveResume(secret) {
  return {
    room: toBase64Url(await hkdf(secret, 'zipcoop', 'resume room', 'bits')),
    key: await hkdf(secret, 'zipcoop', 'resume key', 'key'),
  };
}
