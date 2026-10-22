import { ICE_SERVERS } from './config.js';
import { decodeCode, encodeCode } from './invite.js';

// Two browsers connected directly (WebRTC data channel), with no server of ours: the host's
// invite and the guest's reply are the two halves of the handshake, carried by people (a link, a
// chat message). Only the browsers' own address lookup uses a public STUN server (config.js).
//
// A connection is { channel, close() } with channel = { send(text), close(), onopen, onmessage,
// onclose }, the shape session.js talks to. A pair that cannot reach each other (some mobile or
// office networks need a relay server) never opens; the screen times that out.
const GATHER_MS = 4000;

export const rtcSupported = () => typeof RTCPeerConnection === 'function';

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
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
  return { pc, channel, close };
}

// Host: -> { code, connection }. The code goes to the friend (in a link).
export async function createInvite() {
  const { pc, channel, close } = newConnection();
  channel.attach(pc.createDataChannel('coop', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await encodeCode('o', pc.localDescription.sdp);
  return { code, connection: { pc, channel, close } };
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
  const { pc, channel, close } = newConnection();
  pc.ondatachannel = event => channel.attach(event.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = await encodeCode('a', pc.localDescription.sdp);
  return { code, connection: { pc, channel, close } };
}
