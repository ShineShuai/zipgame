// A slice is what one device offers to the others of a sync group: its own copy of the
// synced keys (merge.js), numbered by `seq` so that a newer slice replaces an older one.
//
//   { v: 1, dev: <11 characters>, seq: <integer, grows with every change>, keys: { key: value } }
//
// Packed for a channel or a server: one format byte (0 = JSON text, 1 = the same
// deflate-compressed), then the bytes. A packed slice is at most SLICE_MAX bytes; a bigger
// one first loses what its keys can do without (`shrink`, the recent times of the stats),
// and is refused when that is not enough. Nothing here throws on foreign bytes: unpackSlice
// answers null. Pure: no DOM, no storage.
import { fromBase64Url, toBase64Url } from './base64.js';

export const SLICE_VERSION = 1;
export const SLICE_MAX = 16384; // bytes, packed
export const UNPACKED_MAX = 262144; // bytes of JSON text a packed slice may inflate to
const DEV = /^[A-Za-z0-9_-]{11}$/;
const RAW = 0;
const DEFLATE = 1;

export const isDev = value => typeof value === 'string' && DEV.test(value);
export const newDevId = () => toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(8)));

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The structure only; what the keys hold is checked by their merge rules.
export const isSlice = value => isObject(value) && value.v === SLICE_VERSION
  && isDev(value.dev) && Number.isSafeInteger(value.seq) && value.seq >= 0 && isObject(value.keys);

const compressionSupported = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function readAll(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError('too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const withFormat = (format, body) => {
  const bytes = new Uint8Array(body.length + 1);
  bytes[0] = format;
  bytes.set(body, 1);
  return bytes;
};

async function encode(slice) {
  const text = new TextEncoder().encode(JSON.stringify(slice));
  if (!compressionSupported()) {
    return withFormat(RAW, text);
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return withFormat(DEFLATE, await readAll(stream, UNPACKED_MAX));
}

// -> Uint8Array of at most `max` bytes, or null when the slice does not fit.
// shrink: { key: value => smaller value }, tried when the slice is too big.
export async function packSlice(slice, { max = SLICE_MAX, shrink = {} } = {}) {
  let bytes = await encode(slice);
  if (bytes.length <= max) {
    return bytes;
  }
  const keys = Object.fromEntries(Object.entries(slice.keys).map(
    ([key, value]) => [key, shrink[key] ? shrink[key](value) : value],
  ));
  bytes = await encode({ ...slice, keys });
  return bytes.length <= max ? bytes : null;
}

// -> the slice, or null for anything that is not a packed slice.
export async function unpackSlice(bytes, { max = SLICE_MAX } = {}) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 2 || bytes.length > max) {
      return null;
    }
    let text;
    if (bytes[0] === RAW) {
      text = bytes.subarray(1);
    } else if (bytes[0] === DEFLATE && compressionSupported()) {
      const stream = new Blob([bytes.subarray(1)]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      text = await readAll(stream, UNPACKED_MAX);
    } else {
      return null;
    }
    if (text.length > UNPACKED_MAX) {
      return null;
    }
    const slice = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(text));
    return isSlice(slice) ? slice : null;
  } catch {
    return null;
  }
}

export const sliceToText = bytes => toBase64Url(bytes);

// base64url text -> bytes, or null.
export function sliceFromText(text) {
  try {
    return fromBase64Url(text);
  } catch {
    return null;
  }
}
