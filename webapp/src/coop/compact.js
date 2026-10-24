// A WebRTC session description (SDP) for a data channel, packed into a few dozen bytes. Only the
// parts that differ from one connection to the next are kept: the ICE user fragment and password
// (the credentials of the address check), the DTLS fingerprint (the key identity), and the
// candidates (the addresses the other side can try). The rest of the text is the same every time
// and is written out again by `unpackSdp`.
//
// `packSdp` returns null when the description holds anything else (another hash, a TCP candidate,
// a media section, ...): the caller then sends the whole text, as before.
//
// Layout: count, ufrag length, pwd length, ufrag, pwd (6 bits per character: the ICE alphabet is
// exactly 64 characters), fingerprint (32 bytes), then per candidate: a head byte (kind of
// candidate, kind of address), the address (4 or 16 bytes), the port (2 bytes) and the local
// preference of its priority (LEB128, mostly 1 byte).
const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const TYPES = ['host', 'srflx', 'prflx', 'relay'];
const TYPE_PREFERENCE = { host: 126, srflx: 100, prflx: 110, relay: 0 }; // RFC 8445, 5.1.2.2
// the offer lets the other side choose the DTLS role, the answer takes one
const SETUP = { o: 'actpass', a: 'active' };
const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const CANDIDATE = new RegExp(
  '^a=candidate:\\S+ 1 (?:udp|UDP) (\\d+) (\\S+) (\\d+) typ (host|srflx|prflx|relay)'
  + '(?: raddr \\S+ rport \\d+)?(?: generation \\d+)?(?: ufrag \\S+)?'
  + '(?: network-id \\d+)?(?: network-cost \\d+)?$',
);
// Lines that carry nothing the other side needs. The port of the m= line and the address of the
// c= line are only the default candidate (Chrome sets them once gathering is done): the
// candidate lines hold the same, and `unpackSdp` writes the neutral 9 and 0.0.0.0.
const BOILERPLATE = [
  /^v=0$/, /^o=/, /^s=-$/, /^t=0 0$/, /^a=group:BUNDLE 0$/, /^a=extmap-allow-mixed$/,
  /^a=msid-semantic: ?WMS(?: \*)?$/, /^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/,
  /^c=IN IP[46] \S+$/, /^a=ice-options:trickle$/, /^a=mid:0$/, /^a=sctp-port:5000$/,
  /^a=max-message-size:\d+$/, /^a=end-of-candidates$/, /^a=sendrecv$/,
];

const hex = byte => byte.toString(16).padStart(2, '0');

function parseV6(text) {
  const halves = text.split('::');
  if (!/^[0-9a-fA-F:]+$/.test(text) || halves.length > 2) {
    return null;
  }
  const side = part => (part === '' ? [] : part.split(':'));
  const [head, tail] = [side(halves[0]), side(halves[1] ?? '')];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) {
    return null;
  }
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!groups.every(group => /^[0-9a-fA-F]{1,4}$/.test(group))) {
    return null;
  }
  return groups.flatMap(group => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255]);
}

// -> { kind: 0 (IPv4) | 1 (IPv6) | 2 (mDNS name), bytes } or null
function packAddress(text) {
  const v4 = V4.exec(text)?.slice(1).map(Number);
  if (v4) {
    return v4.every(part => part < 256) ? { kind: 0, bytes: v4 } : null;
  }
  const mdns = MDNS.exec(text);
  if (mdns) {
    const digits = mdns.slice(1).join('');
    const bytes = Array.from({ length: 16 }, (_, i) => parseInt(digits.substr(i * 2, 2), 16));
    return { kind: 2, bytes };
  }
  const v6 = text.includes(':') ? parseV6(text) : null;
  return v6 ? { kind: 1, bytes: v6 } : null;
}

function unpackAddress(kind, bytes) {
  if (kind === 0) {
    return bytes.join('.');
  }
  if (kind === 1) {
    const groups = Array.from({ length: 8 }, (_, i) => (bytes[i * 2] << 8) | bytes[i * 2 + 1]);
    return groups.map(group => group.toString(16)).join(':');
  }
  const digits = bytes.map(hex).join('');
  const uuid = digits.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return `${uuid}.local`;
}

function packChars(text) {
  const bytes = [];
  let bits = 0;
  let pending = 0;
  for (const char of text) {
    pending = (pending << 6) | ICE_CHARS.indexOf(char);
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((pending >> bits) & 255);
      pending &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    bytes.push((pending << (8 - bits)) & 255);
  }
  return bytes;
}

function unpackChars(bytes, length) {
  let text = '';
  let bits = 0;
  let pending = 0;
  let at = 0;
  while (text.length < length) {
    while (bits < 6) {
      pending = (pending << 8) | bytes[at++];
      bits += 8;
    }
    bits -= 6;
    text += ICE_CHARS[(pending >> bits) & 63];
    pending &= (1 << bits) - 1;
  }
  return text;
}

// LEB128: 7 bits per byte, the high bit says that another byte follows (values up to 65535).
function varint(value) {
  const bytes = [];
  for (let rest = value; ; rest >>= 7) {
    bytes.push(rest > 127 ? (rest & 127) | 128 : rest);
    if (rest <= 127) {
      return bytes;
    }
  }
}

// -> Uint8Array, or null when `sdp` is not a plain data channel description of this kind.
export function packSdp(kind, sdp) {
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  let ufrag = null;
  let pwd = null;
  let print = null;
  let setup = null;
  const candidates = [];
  for (const line of lines) {
    const [, name, value] = /^a=(ice-ufrag|ice-pwd|fingerprint|setup):(.*)$/.exec(line) ?? [];
    if (name === 'ice-ufrag') {
      ufrag = value;
    } else if (name === 'ice-pwd') {
      pwd = value;
    } else if (name === 'fingerprint') {
      print = /^sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})$/.exec(value)?.[1] ?? null;
      if (!print) {
        return null;
      }
    } else if (name === 'setup') {
      setup = value;
    } else if (line.startsWith('a=candidate:')) {
      const [, priority, address, port, type] = CANDIDATE.exec(line) ?? [];
      const packed = type && packAddress(address);
      const [kindPriority, local] = [Number(priority) >>> 24, (Number(priority) >>> 8) & 0xffff];
      if (!packed || Number(port) > 65535 || kindPriority !== TYPE_PREFERENCE[type]
        || (Number(priority) & 255) !== 255) {
        return null;
      }
      candidates.push([
        TYPES.indexOf(type) | (packed.kind << 2), ...packed.bytes,
        Number(port) >> 8, Number(port) & 255, ...varint(local),
      ]);
    } else if (!BOILERPLATE.some(pattern => pattern.test(line))) {
      return null;
    }
  }
  const credential = /^[A-Za-z0-9+/]{4,255}$/;
  if (!credential.test(ufrag ?? '') || !credential.test(pwd ?? '') || !print
    || setup !== SETUP[kind] || candidates.length > 255) {
    return null;
  }
  return Uint8Array.from([
    candidates.length, ufrag.length, pwd.length, ...packChars(ufrag), ...packChars(pwd),
    ...print.split(':').map(pair => parseInt(pair, 16)), ...candidates.flat(),
  ]);
}

// -> the session description text; throws on bytes that `packSdp` could not have made.
export function unpackSdp(kind, bytes) {
  let at = 0;
  const take = count => {
    if (at + count > bytes.length) {
      throw new Error('short');
    }
    at += count;
    return Array.from(bytes.subarray(at - count, at));
  };
  const [count, ufragLength, pwdLength] = take(3);
  if (!SETUP[kind] || ufragLength < 4 || pwdLength < 4) {
    throw new Error('header');
  }
  const ufrag = unpackChars(take(Math.ceil((ufragLength * 6) / 8)), ufragLength);
  const pwd = unpackChars(take(Math.ceil((pwdLength * 6) / 8)), pwdLength);
  const print = take(32).map(hex).join(':').toUpperCase();
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const [head] = take(1);
    const [type, addressKind] = [TYPES[head & 3], (head >> 2) & 3];
    if (head > 11 || addressKind > 2) {
      throw new Error('candidate');
    }
    const address = unpackAddress(addressKind, take(addressKind === 0 ? 4 : 16));
    const [high, low] = take(2);
    let local = 0;
    for (let shift = 0, byte = 128; byte >= 128; shift += 7) {
      if (shift > 14) {
        throw new Error('candidate');
      }
      [byte] = take(1);
      local |= (byte & 127) << shift;
    }
    const priority = TYPE_PREFERENCE[type] * 2 ** 24 + local * 256 + 255;
    const related = type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    const port = (high << 8) | low;
    const where = `${address} ${port} typ ${type}${related}`;
    candidates.push(`a=candidate:${i + 1} 1 udp ${priority} ${where}`);
  }
  if (at !== bytes.length) {
    throw new Error('long');
  }
  return [
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
    'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...candidates,
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${print}`, `a=setup:${SETUP[kind]}`, 'a=mid:0', 'a=sctp-port:5000',
    'a=max-message-size:262144', 'a=end-of-candidates', '',
  ].join('\r\n');
}
