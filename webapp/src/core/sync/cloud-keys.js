// What a sync group needs to use a server without the server learning anything: from the group's
// secret (the 80 bits of the sync phrase, words.js) three things come out, and the data is sealed
// before it leaves the device.
//
//   id    32 hex characters: where the group's data is kept. The server cannot get from it to the
//         secret, and nobody can find it without the secret.
//   auth  43 characters: shown to a server that checks it (Supabase: the first write stores its
//         hash, later writes and deletes must show it). A server cannot use it to read anything.
//   key   an AES-GCM key: seals every slice. The server only ever holds ciphertext.
//
// 80 bits is a lot for a guess, but not an infinite lot: the secret first goes through PBKDF2
// (600,000 rounds of HMAC-SHA-256, a slow function made to make every guess cost a lot), then
// HKDF (a function that turns one secret into independent keys, one per label).
// A sealed slice is: 12 random bytes (the nonce), then ciphertext and the 16-byte tag. The tag
// covers `zipsync1|id|device` too, so a slice cannot be passed off as another device's.
// Needs WebCrypto (browsers, Node 20+). No DOM, no storage.
import { fromBase64Url, toBase64Url } from './base64.js';

export const KDF_ITERATIONS = 600000;
// characters of a sealed slice as text: 16 KB packed, sealed, in base64url
export const DATA_MAX = 24000;
const SALT = 'zip-sync-v1';
const NONCE_BYTES = 12;
const text = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

// secret: the 10 bytes. iterations: only tests pass less. -> { id, auth, key }
export async function deriveCloudKeys(secret, iterations = KDF_ITERATIONS) {
  if (!(secret instanceof Uint8Array) || secret.length === 0) {
    throw new RangeError('no secret');
  }
  const password = await subtle().importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  const master = new Uint8Array(await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: text.encode(SALT), iterations }, password, 256,
  ));
  const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = label => (
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: text.encode(label) });
  const bits = async (label, length) =>
    new Uint8Array(await subtle().deriveBits(params(label), base, length));
  return {
    id: hex(await bits('zipsync id', 128)),
    auth: toBase64Url(await bits('zipsync auth', 256)),
    key: await subtle().deriveKey(
      params('zipsync key'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    ),
  };
}

const aad = (id, dev) => text.encode(`zipsync1|${id}|${dev}`);

// bytes -> sealed bytes (nonce + ciphertext + tag)
export async function seal(key, id, dev, bytes) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(id, dev) }, key, bytes,
  ));
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(nonce);
  out.set(sealed, NONCE_BYTES);
  return out;
}

// sealed bytes -> bytes, or null when they are not sealed with this key for this id and device.
export async function open(key, id, dev, sealed) {
  try {
    if (!(sealed instanceof Uint8Array) || sealed.length < NONCE_BYTES + 16) {
      return null;
    }
    return new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, NONCE_BYTES), additionalData: aad(id, dev) },
      key, sealed.subarray(NONCE_BYTES),
    ));
  } catch {
    return null;
  }
}

// The same as text, for a server: base64url of the sealed bytes.
export const sealToText = async (key, id, dev, bytes) =>
  toBase64Url(await seal(key, id, dev, bytes));

export async function openFromText(key, id, dev, data) {
  try {
    return await open(key, id, dev, fromBase64Url(data));
  } catch {
    return null;
  }
}

// A short name for a secret (8 characters), for two devices to tell whether they share one,
// without telling it. Not a key: it is made with a fast hash, and 8 characters cut off a lot.
export async function secretId(secret) {
  const labelled = Uint8Array.from([...text.encode('zipsync sid'), ...secret]);
  const hash = await subtle().digest('SHA-256', labelled);
  return toBase64Url(new Uint8Array(hash).subarray(0, 6));
}
