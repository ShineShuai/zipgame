// MQTT brokers in memory, for the tests of mqtt.js, signal.js and join.js, with a WebSocket class
// that connects to them. The broker reads the client's bytes with its own small reader (not the
// one of src/coop/mqtt.js), so that the tests check the client against the protocol, not against
// itself. A broker keeps retained messages, matches "+" and "#", and can be switched off
// (down: connecting fails), cut (drop: every connection is closed) or made to refuse.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const matches = (filter, topic) => {
  const want = filter.split('/');
  const have = topic.split('/');
  const fits = (part, i) => part === '#' || (i < have.length && (part === '+' || part === have[i]));
  return want.every(fits) && (want.at(-1) === '#' || want.length === have.length);
};

const frame = (first, body) => {
  const length = [];
  let rest = body.length;
  do {
    length.push((rest % 128) | (rest >= 128 ? 128 : 0));
    rest = Math.floor(rest / 128);
  } while (rest > 0);
  return Uint8Array.from([first, ...length, ...body]);
};

const text = bytes => decoder.decode(Uint8Array.from(bytes));
const string = (bytes, at) => {
  const length = (bytes[at] << 8) | bytes[at + 1];
  return [text(bytes.slice(at + 2, at + 2 + length)), at + 2 + length];
};

// the packets in a buffer: [{ type, flags, body }]; a client here sends whole packets per frame
function packets(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    let length = 0;
    let scale = 1;
    let next = at + 1;
    let byte;
    do {
      byte = bytes[next++];
      length += (byte & 127) * scale;
      scale *= 128;
    } while (byte & 128);
    out.push({
      type: bytes[at] >> 4, flags: bytes[at] & 15, body: [...bytes.slice(next, next + length)],
    });
    at = next + length;
  }
  return out;
}

export function createBroker(url) {
  const broker = {
    url,
    down: false,
    refuse: false,
    retained: new Map(), // topic -> text
    clients: new Set(),
    log: [], // { topic, text, retain } of every PUBLISH received
    connects: 0,
    protocolErrors: [],
    drop() {
      [...broker.clients].forEach(client => client.shut());
    },
  };
  const deliver = (client, topic, message, retain, filters = client.filters) => {
    if (filters.some(filter => matches(filter, topic))) {
      const name = encoder.encode(topic);
      const body = [name.length >> 8, name.length & 255, ...name, ...encoder.encode(message)];
      client.push(frame(0x30 | (retain ? 1 : 0), body));
    }
  };
  broker.handle = (client, bytes) => {
    for (const { type, flags, body } of packets(bytes)) {
      if (type === 1) {
        const [name, next] = string(body, 0);
        if (name !== 'MQTT' || body[next] !== 4) {
          broker.protocolErrors.push('connect');
        }
        broker.connects++;
        client.push(Uint8Array.of(0x20, 2, 0, broker.refuse ? 5 : 0));
        if (broker.refuse) {
          client.shut();
        }
      } else if (type === 8) {
        if ((flags & 15) !== 2) {
          broker.protocolErrors.push('subscribe flags');
        }
        let at = 2;
        const filters = [];
        while (at < body.length) {
          const [filter, next] = string(body, at);
          filters.push(filter);
          at = next + 1;
        }
        client.push(frame(0x90, [body[0], body[1], ...filters.map(() => 0)]));
        client.filters.push(...filters);
        broker.retained.forEach((message, topic) => deliver(client, topic, message, true, filters));
      } else if (type === 3) {
        const [topic, next] = string(body, 0);
        const message = text(body.slice(next));
        const retain = (flags & 1) === 1;
        broker.log.push({ topic, text: message, retain });
        if (retain) {
          if (message) {
            broker.retained.set(topic, message);
          } else {
            broker.retained.delete(topic);
          }
        }
        if (message) {
          broker.clients.forEach(other => deliver(other, topic, message, false));
        }
      } else if (type === 12) {
        client.push(Uint8Array.of(0xd0, 0));
      } else if (type === 14) {
        client.shut();
      }
    }
  };
  return broker;
}

// What one device can reach: gate.all = true cuts it off, gate.blocked holds urls it cannot
// reach (a network that blocks one broker), gate.cut() closes its connections.
const makeGate = () => ({
  all: false,
  blocked: new Set(),
  sockets: new Set(),
  cut() {
    [...this.sockets].forEach(socket => socket.shut());
  },
});

// -> { brokers: Map(url -> broker), WebSocket, device() } for the given urls. WebSocket reaches
// every broker; device() -> { WebSocket, gate } is one device's view of the network.
export function createNetwork(urls) {
  const brokers = new Map(urls.map(url => [url, createBroker(url)]));

  const socketClass = gate => class FakeWebSocket {
    constructor(url, protocol) {
      this.url = url;
      this.protocol = protocol;
      this.readyState = 0;
      this.filters = [];
      this.broker = brokers.get(url);
      queueMicrotask(() => {
        if (!this.broker || this.broker.down || gate.all || gate.blocked.has(url)) {
          this.readyState = 3;
          this.onerror?.();
          this.onclose?.();
          return;
        }
        this.readyState = 1;
        this.broker.clients.add(this);
        gate.sockets.add(this);
        this.onopen?.();
      });
    }

    send(bytes) {
      if (this.readyState !== 1) {
        throw new Error('not open');
      }
      // like a real WebSocket: what was sent before close() still arrives
      const copy = Uint8Array.from(bytes);
      queueMicrotask(() => this.broker.handle(this, copy));
    }

    push(bytes) {
      queueMicrotask(() => this.readyState === 1 && this.onmessage?.({ data: bytes.buffer }));
    }

    shut() {
      if (this.readyState === 3) {
        return;
      }
      this.readyState = 3;
      this.broker.clients.delete(this);
      gate.sockets.delete(this);
      queueMicrotask(() => this.onclose?.());
    }

    close() {
      this.shut();
    }
  };
  return {
    brokers,
    WebSocket: socketClass(makeGate()),
    device() {
      const gate = makeGate();
      return { WebSocket: socketClass(gate), gate };
    },
  };
}

// Timers by hand: advance(ms) runs every timer that falls due, in order.
export function manualTimers() {
  let now = 0;
  let id = 0;
  const waiting = new Map();
  return {
    set(fn, ms) {
      waiting.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: key => waiting.delete(key),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...waiting].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        waiting.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
    get size() {
      return waiting.size;
    },
  };
}

// Waits until `check()` is true: the tests wait for real crypto (a thread pool) and for the
// messages of the fake network, which take several turns.
export async function until(check, what = 'a condition', ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
export const settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
