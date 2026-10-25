// A minimal MQTT 3.1.1 client over a WebSocket, just what the handshake needs: connect, subscribe,
// publish (QoS 0, optionally retained) and receive. MQTT is a publish/subscribe protocol: clients
// send messages to named topics and a broker forwards them to whoever subscribed. A retained
// message is kept by the broker and handed to later subscribers. QoS 0 = delivered at most once;
// signal.js repeats what matters. Browsers speak it as binary WebSocket frames with the
// subprotocol "mqtt".
const CONNECT = 1;
const CONNACK = 2;
const PUBLISH = 3;
const PUBACK = 4;
const SUBSCRIBE = 8;
const PINGREQ = 12;
const DISCONNECT = 14;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const join = chunks => {
  const parts = chunks.map(chunk => (chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk)));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// MQTT's "remaining length": 7 bits per byte, the high bit says that another byte follows.
function lengthBytes(value) {
  const out = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) {
      byte |= 128;
    }
    out.push(byte);
  } while (rest > 0);
  return out;
}

const packet = (first, ...parts) => {
  const body = join(parts);
  return join([[first, ...lengthBytes(body.length)], body]);
};

const string = value => {
  const bytes = encoder.encode(value);
  return join([[bytes.length >> 8, bytes.length & 255], bytes]);
};

export const connectPacket = (clientId, keepAliveS) => packet(
  CONNECT << 4,
  string('MQTT'),
  [4, 2, keepAliveS >> 8, keepAliveS & 255], // level 4 = 3.1.1, flags: clean session
  string(clientId),
);

export const subscribePacket = (id, filter) => packet(
  (SUBSCRIBE << 4) | 2, [id >> 8, id & 255], string(filter), [0],
);

// An empty `text` with retain removes the retained message of the topic.
export const publishPacket = (topic, text, retain = false) => packet(
  (PUBLISH << 4) | (retain ? 1 : 0), string(topic), encoder.encode(text),
);

export const PINGREQ_PACKET = Uint8Array.of(PINGREQ << 4, 0);
export const DISCONNECT_PACKET = Uint8Array.of(DISCONNECT << 4, 0);

// feed(bytes) -> the complete packets in what has arrived so far: [{ type, flags, body }].
// A WebSocket frame can hold part of a packet or several; the rest is kept for the next feed.
export function createParser() {
  let buffer = new Uint8Array(0);
  return chunk => {
    buffer = join([buffer, chunk]);
    const packets = [];
    for (;;) {
      let length = 0;
      let scale = 1;
      let at = 1;
      let complete = false;
      while (at < buffer.length && at <= 4 && !complete) {
        const byte = buffer[at++];
        length += (byte & 127) * scale;
        scale *= 128;
        complete = (byte & 128) === 0;
      }
      if (!complete && at > 4) {
        throw new Error('mqtt: bad length');
      }
      if (!complete || buffer.length < at + length) {
        return packets;
      }
      packets.push({
        type: buffer[0] >> 4, flags: buffer[0] & 15, body: buffer.slice(at, at + length),
      });
      buffer = buffer.slice(at + length);
    }
  };
}

// A PUBLISH body -> { topic, text, id } (id: only with QoS above 0).
export function readPublish({ flags, body }) {
  const topicLength = (body[0] << 8) | body[1];
  const topic = decoder.decode(body.slice(2, 2 + topicLength));
  let at = 2 + topicLength;
  let id = null;
  if (((flags >> 1) & 3) > 0) {
    id = (body[at] << 8) | body[at + 1];
    at += 2;
  }
  return { topic, text: decoder.decode(body.slice(at)), id };
}

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };

// One connection. onopen when the broker has accepted it, onmessage(topic, text) for every
// message of a subscribed topic, onclose once, whatever the reason (never opened, refused, lost).
export function createMqtt({
  url,
  clientId,
  onopen,
  onmessage,
  onclose,
  keepAliveS = 60,
  connectMs = 10000,
  WebSocketImpl = globalThis.WebSocket,
  timers = realTimers,
}) {
  let state = 'connecting'; // connecting -> up -> closed
  let pinger = null;
  let nextId = 1;
  const parse = createParser();
  const socket = new WebSocketImpl(url, 'mqtt');
  socket.binaryType = 'arraybuffer';

  const write = bytes => {
    try {
      socket.send(bytes);
      return true;
    } catch {
      return false;
    }
  };

  function finish() {
    if (state === 'closed') {
      return;
    }
    state = 'closed';
    timers.clear(connectTimer);
    timers.clear(pinger);
    try {
      socket.close();
    } catch {
      // already closed
    }
    onclose?.();
  }

  const ping = () => {
    pinger = timers.set(() => {
      write(PINGREQ_PACKET);
      ping();
    }, keepAliveS * 500);
  };

  function handle(received) {
    if (received.type === CONNACK) {
      if (received.body[1] !== 0) {
        finish();
        return;
      }
      state = 'up';
      timers.clear(connectTimer);
      ping();
      onopen?.();
    } else if (received.type === PUBLISH && state === 'up') {
      const { topic, text, id } = readPublish(received);
      if (id !== null && ((received.flags >> 1) & 3) === 1) {
        write(Uint8Array.of(PUBACK << 4, 2, id >> 8, id & 255));
      }
      onmessage?.(topic, text);
    }
  }

  const connectTimer = timers.set(finish, connectMs);
  socket.onopen = () => write(connectPacket(clientId, keepAliveS));
  socket.onmessage = event => {
    try {
      const { data } = event;
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      parse(bytes).forEach(handle);
    } catch {
      finish();
    }
  };
  socket.onerror = finish;
  socket.onclose = finish;

  return {
    get up() {
      return state === 'up';
    },
    // false when the message could not be handed to the socket
    publish: (topic, text, retain = false) => state === 'up'
      && write(publishPacket(topic, text, retain)),
    subscribe(filter) {
      nextId = (nextId % 65535) + 1;
      return state === 'up' && write(subscribePacket(nextId, filter));
    },
    close() {
      if (state === 'up') {
        write(DISCONNECT_PACKET);
      }
      finish();
    },
  };
}
