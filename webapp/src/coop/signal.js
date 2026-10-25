import { createMqtt } from './mqtt.js';

// The meeting place of two devices that do not know each other's address yet: a few public MQTT
// brokers (config.js, SIGNAL_BROKERS), all used at once. Every message goes to every broker that
// is connected and is taken from whichever delivers it first, so one broker being down or blocked
// (on either side) costs nothing; setup fails only when no broker is reachable from both devices.
//
// Every message is retained, so a device that connects late (a phone page that was asleep)
// still receives it. What waits for an answer is sent again a few times; everything is sent again
// when a connection comes back. clear() removes a message from the brokers, and a message
// that is not cleared is only ciphertext (secret.js) with a random topic.
const PAYLOAD_MAX = 4000; // characters of one message; ours are under 1200
const SEEN_MAX = 400;

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
const hex = byte => byte.toString(16).padStart(2, '0');
const clientId = () => `zc${[...globalThis.crypto.getRandomValues(new Uint8Array(8))]
  .map(hex).join('')}`;

// Does an MQTT topic filter match a topic? "+" = one level, a trailing "#" = the rest.
export function matches(filter, topic) {
  const want = filter.split('/');
  const have = topic.split('/');
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '#') {
      return true;
    }
    if (i >= have.length || (want[i] !== '+' && want[i] !== have[i])) {
      return false;
    }
  }
  return want.length === have.length;
}

const connectMqtt = (url, handlers) => createMqtt({ url, clientId: clientId(), ...handlers });

export function createHub({
  brokers,
  connect = connectMqtt,
  timers = realTimers,
  resendMs = 3000,
  now = () => performance.now(),
  random = Math.random,
  onChange,
}) {
  const slots = brokers.map(({ id, url }) => ({
    id, url, client: null, up: false, ms: null, tries: 0, timer: null,
  }));
  const listeners = new Map(); // number -> { filter, handler }
  const outbox = new Map(); // topic -> { text, left } what is (re)sent to every broker
  const cleared = new Set(); // topics to be emptied on every broker
  const seen = new Set(); // "topic\ntext" of what was delivered already
  let counter = 0;
  let resender = null;
  let closed = false;

  const up = () => slots.filter(slot => slot.up);

  function flush(slot) {
    outbox.forEach(({ text }, topic) => slot.client.publish(topic, text, true));
    cleared.forEach(topic => slot.client.publish(topic, '', true));
  }

  function receive(topic, text) {
    const key = `${topic}\n${text}`;
    if (!text || seen.has(key)) {
      return;
    }
    seen.add(key);
    if (seen.size > SEEN_MAX) {
      seen.delete(seen.values().next().value);
    }
    [...listeners.values()].forEach(({ filter, handler }) => {
      if (matches(filter, topic)) {
        handler(topic, text);
      }
    });
  }

  function start(slot) {
    if (closed || slot.client) {
      return;
    }
    const began = now();
    const client = connect(slot.url, {
      onopen() {
        slot.up = true;
        slot.ms = Math.round(now() - began);
        slot.tries = 0;
        listeners.forEach(({ filter }) => client.subscribe(filter));
        flush(slot);
        onChange?.();
      },
      onmessage: receive,
      onclose() {
        if (slot.client !== client) {
          return;
        }
        slot.client = null;
        slot.up = false;
        onChange?.();
        if (!closed) {
          const wait = Math.min(1000 * 2 ** slot.tries++, 15000) * (0.5 + random() / 2);
          slot.timer = timers.set(() => start(slot), wait);
        }
      },
    });
    slot.client = client;
  }

  function sendAgain() {
    resender = null;
    outbox.forEach((entry, topic) => {
      if (entry.left > 0) {
        entry.left--;
        up().forEach(slot => slot.client.publish(topic, entry.text, true));
      }
    });
    armResender();
  }

  function armResender() {
    if (!closed && !resender && [...outbox.values()].some(entry => entry.left > 0)) {
      resender = timers.set(sendAgain, resendMs);
    }
  }

  slots.forEach(start);

  return {
    // `repeat` more sends, `resendMs` apart, for a message that waits for an answer.
    publish(topic, text, { repeat = 0 } = {}) {
      if (closed || text.length > PAYLOAD_MAX) {
        return;
      }
      cleared.delete(topic);
      outbox.set(topic, { text, left: repeat });
      up().forEach(slot => slot.client.publish(topic, text, true));
      armResender();
    },
    clear(topic) {
      outbox.delete(topic);
      cleared.add(topic);
      up().forEach(slot => slot.client.publish(topic, '', true));
    },
    subscribe(filter, handler) {
      const id = ++counter;
      listeners.set(id, { filter, handler });
      up().forEach(slot => slot.client.subscribe(filter));
      return () => listeners.delete(id);
    },
    // The page is awake again (or online again): reconnect at once, and send everything once more.
    wake() {
      slots.forEach(slot => {
        if (slot.up) {
          flush(slot);
        } else if (!slot.client) {
          timers.clear(slot.timer);
          slot.tries = 0;
          start(slot);
        }
      });
    },
    anyUp: () => up().length > 0,
    // "signal mq 0.35s · hv x · em 1.16s" (x = not connected), for the dev line
    report: () => `signal ${slots.map(slot => `${slot.id} ${slot.up
      ? `${(slot.ms / 1000).toFixed(2)}s` : 'x'}`).join(' · ')}`,
    close() {
      closed = true;
      timers.clear(resender);
      slots.forEach(slot => {
        timers.clear(slot.timer);
        slot.client?.close();
      });
    },
  };
}
