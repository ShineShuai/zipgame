// Invite and reply codes: a WebRTC session description packed into a short piece of text that
// fits in a link (the part after "#c=") or in a chat message. No server is involved: the host
// sends an invite (kind "o", the offer), the guest sends back a reply (kind "a", the answer).
//
// A code is kind + mode + base64url(bytes). Mode "c" = compact: only what differs between two
// connections (compact.js, about 100 characters); when the description holds more than that, "z" =
// deflate-raw compressed, or "r" = raw UTF-8 (for browsers without CompressionStream).
import { packSdp, unpackSdp } from './compact.js';

export const toBase64Url = bytes => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromBase64Url = text => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

async function through(stream, bytes) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export async function encodeCode(kind, sdp) {
  const compact = packSdp(kind, sdp);
  if (compact) {
    return `${kind}c${toBase64Url(compact)}`;
  }
  const bytes = new TextEncoder().encode(sdp);
  if (typeof CompressionStream === 'function') {
    return `${kind}z${toBase64Url(await through(new CompressionStream('deflate-raw'), bytes))}`;
  }
  return `${kind}r${toBase64Url(bytes)}`;
}

// The code in `text`, which may be a whole link ("#c=<code>", older links "#coop=<code>"), with
// line breaks and blanks from a chat app. A code has no "=", so it starts after the last one.
export function codeFromText(text) {
  const clean = String(text).replace(/\s+/g, '');
  return clean.slice(clean.lastIndexOf('=') + 1);
}

// -> { kind: 'o' | 'a', sdp } or throws an Error('bad code').
export async function decodeCode(text) {
  const code = codeFromText(text);
  const [kind, mode, payload] = [code[0], code[1], code.slice(2)];
  try {
    if ((kind !== 'o' && kind !== 'a') || !payload || !/^[A-Za-z0-9_-]+$/.test(payload)) {
      throw new Error('shape');
    }
    const bytes = fromBase64Url(payload);
    if (mode === 'c') {
      return { kind, sdp: unpackSdp(kind, bytes) };
    }
    let raw = bytes;
    if (mode === 'z') {
      raw = await through(new DecompressionStream('deflate-raw'), bytes);
    } else if (mode !== 'r') {
      throw new Error('mode');
    }
    const sdp = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (!sdp.startsWith('v=0')) {
      throw new Error('not a session description');
    }
    return { kind, sdp };
  } catch {
    throw new Error('bad code');
  }
}
