import { ICE_SERVERS } from './config.js';
import { decodeCode, encodeCode } from './invite.js';

// Two browsers connected directly (WebRTC data channel), with no server of ours: the host's
// invite and the guest's reply are the two halves of the handshake, carried by people (a link, a
// chat message). Only the browsers' own address lookup uses a public STUN server (config.js).
//
// A connection is { channel, close(), report() } with channel = { send(text), close(), onopen,
// onmessage, onclose }, the shape session.js talks to; report() is the dev line (describeRoute).
// A pair that cannot reach each other (some mobile or office networks need a relay server) never
// opens; the screen times that out.
const GATHER_MS = 4000;

export const rtcSupported = () => typeof RTCPeerConnection === 'function';

// RFC 7064: stun:host[:port] (stuns: for TLS). `stun://host` is not valid; the browser would throw
// or never resolve it, so such an entry is dropped instead of taking the whole connection down.
export const STUN_URL = /^stuns?:[^/\s?]+$/;
const bare = url => url.replace(/^stuns?:/, '');

// What the browser reports while it looks up its addresses: which candidate came from which STUN
// server (`url` is Chrome/Safari only; equal answers from several servers give one candidate, so
// it is the fastest server), and how many of each kind. icecandidateerror is not used: it fires
// per local interface, so a server that works can still be listed there.
const newSeen = () => ({ byAddress: new Map(), types: {} });

function watch(pc, seen) {
  pc.addEventListener('icecandidate', ({ candidate, url }) => {
    const [, address, port, type] = /(\S+) (\d+) typ (\w+)/.exec(candidate?.candidate ?? '') ?? [];
    if (type) {
      seen.types[type] = (seen.types[type] ?? 0) + 1;
      if (url) {
        seen.byAddress.set(`${address}:${port}`, url);
      }
    }
  });
}

// For the dev line: the route the connection took, from getStats() and what `seen` collected.
// "ice host/host, no STUN needed" (same network) or "ice srflx/srflx via stun.l.google.com:19302"
// (this side's candidate came from that server); without a chosen pair, what was gathered.
export function describeRoute(stats, seen, state = '') {
  const byId = new Map();
  stats.forEach(report => byId.set(report.id, report));
  const reports = [...byId.values()];
  const picked = r => r.selected || (r.nominated && r.state === 'succeeded');
  const chosen = byId.get(reports.find(r => r.type === 'transport')?.selectedCandidatePairId)
    ?? reports.find(r => r.type === 'candidate-pair' && picked(r));
  if (!chosen) {
    const got = Object.entries(seen.types).map(([type, n]) => `${type} ${n}`).join(' ') || 'none';
    return `ice ${state || 'no route'} · gathered ${got}`;
  }
  const local = byId.get(chosen.localCandidateId);
  const remote = byId.get(chosen.remoteCandidateId);
  let text = `ice ${local?.candidateType ?? '?'}/${remote?.candidateType ?? '?'}`;
  if (local?.candidateType === 'srflx') {
    const url = local.url || seen.byAddress.get(`${local.address ?? local.ip}:${local.port}`);
    text += url ? ` via ${bare(url)}` : ' via STUN (server not reported by this browser)';
  } else if (local?.candidateType === 'host' && remote?.candidateType === 'host') {
    text += ', no STUN needed';
  }
  return text;
}

// Resolves when the browser has found its addresses, or after GATHER_MS with those found so far.
function gathered(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
      }
    };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

// Dev only: asks each STUN server alone (own connection each) and times its first srflx answer;
// null = none within `ms`. Unlike describeRoute this says which servers work, one by one.
function probeOne({ urls }, ms) {
  return new Promise(resolve => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls }] });
    const start = performance.now();
    const end = value => {
      clearTimeout(timer);
      pc.close();
      resolve(value);
    };
    const timer = setTimeout(() => end(null), ms);
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (/ typ srflx /.test(candidate?.candidate ?? '')) {
        end(Math.round(performance.now() - start));
      }
    });
    pc.createDataChannel('probe');
    pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => end(null));
  });
}

export const probeServers = (servers = ICE_SERVERS, ms = 3000) => Promise.all(
  servers.map(async ({ urls }) => ({ url: urls, ms: await probeOne({ urls }, ms) })),
);

// [{ url, ms }] -> "stun cloudflare.com 41ms · l.google.com x" (x = no answer)
export const probeText = results => 'stun ' + results.map(({ url, ms }) => {
  const host = bare(url).replace(/^stun\./, '').replace(/:\d+$/, '');
  return `${host} ${ms === null ? 'x' : `${ms}ms`}`;
}).join(' · ');

function makeChannel() {
  let real = null;
  const channel = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: text => real.send(text),
    close: () => real?.close(),
    attach(dataChannel) {
      real = dataChannel;
      dataChannel.onopen = () => channel.onopen?.();
      dataChannel.onmessage = event => channel.onmessage?.(event.data);
      dataChannel.onclose = () => channel.onclose?.();
      if (dataChannel.readyState === 'open') {
        channel.onopen?.();
      }
    },
  };
  return channel;
}

function newConnection() {
  const iceServers = ICE_SERVERS.filter(({ urls }) => [urls].flat().every(u => STUN_URL.test(u)));
  const pc = new RTCPeerConnection({ iceServers });
  const seen = newSeen();
  watch(pc, seen);
  const channel = makeChannel();
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      channel.onclose?.();
    }
  };
  const close = () => {
    channel.onclose = null;
    channel.close();
    pc.close();
  };
  const report = async () => describeRoute(await pc.getStats(), seen, pc.iceConnectionState);
  return { pc, channel, close, report };
}

// Host: -> { code, connection }. The code goes to the friend (in a link).
export async function createInvite() {
  const { pc, channel, close, report } = newConnection();
  channel.attach(pc.createDataChannel('coop', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await encodeCode('o', pc.localDescription.sdp);
  return { code, connection: { pc, channel, close, report } };
}

// Host: the friend's reply (a code, or whatever text it came in) completes the connection.
export async function acceptReply(connection, text) {
  const { kind, sdp } = await decodeCode(text);
  if (kind !== 'a') {
    throw new Error('bad code');
  }
  await connection.pc.setRemoteDescription({ type: 'answer', sdp });
}

// Guest: the host's invite -> { code, connection }. The code is the reply to send back.
export async function joinInvite(text) {
  const { kind, sdp } = await decodeCode(text);
  if (kind !== 'o') {
    throw new Error('bad code');
  }
  const { pc, channel, close, report } = newConnection();
  pc.ondatachannel = event => channel.attach(event.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = await encodeCode('a', pc.localDescription.sdp);
  return { code, connection: { pc, channel, close, report } };
}
