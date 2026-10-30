// What two devices say to each other over a channel (the data channel of coop/rtc.js, or any
// object with send(text), onmessage and onclose): one exchange of slices, both ways.
//
//   hello  {t, v, dev, have}   who I am and which slices I have (engine.have())
//   slice  {t, d}              one slice, packed (core/sync/slice.js) and base64url
//   done   {t}                 that was all I have for you
//   part   {t, id, i, n, d}    piece i of n of a message too long for one channel message
//
// Both sides send hello, then the slices the other lacks, then done; the exchange ends when
// both have sent and received done. Slices of other devices go along (gossip), so devices
// that never meet still converge through a third. Whatever arrives is checked, never trusted.
import { SHRINKS } from '../../core/sync/merge.js';
import {
  isDev, packSlice, sliceFromText, sliceToText, unpackSlice,
} from '../../core/sync/slice.js';

export const PROTO_VERSION = 1;
export const FRAME_MAX = 14000; // characters of one channel message (16 KB is safe everywhere)
export const PARTS_MAX = 40;
export const MESSAGE_MAX = 400000; // characters of one message, all parts together
const BAD_MAX = 10;

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
const randomId = () => Math.random().toString(36).slice(2, 12);

// A message -> the channel messages that carry it (usually one).
export function toFrames(message, partId = randomId()) {
  const text = JSON.stringify(message);
  if (text.length <= FRAME_MAX) {
    return [text];
  }
  for (let size = 12000; size >= 1000; size = Math.floor(size / 2)) {
    const count = Math.ceil(text.length / size);
    const frames = Array.from({ length: count }, (_, i) => JSON.stringify(
      { t: 'part', id: partId, i, n: count, d: text.slice(i * size, (i + 1) * size) },
    ));
    if (count <= PARTS_MAX && frames.every(frame => frame.length <= FRAME_MAX)) {
      return frames;
    }
  }
  throw new RangeError('message too long');
}

// Channel messages -> messages. push(text) answers the message once it is whole, undefined
// while parts are missing, and throws Error('bad frame') for anything else.
export function createReassembler() {
  let partId = null;
  let parts = [];
  let size = 0;
  const reset = () => {
    partId = null;
    parts = [];
    size = 0;
  };
  const parse = text => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      throw new Error('bad frame');
    }
    if (!message || typeof message !== 'object' || typeof message.t !== 'string') {
      throw new Error('bad frame');
    }
    return message;
  };
  return {
    push(text) {
      if (typeof text !== 'string' || text.length > FRAME_MAX + 1000) {
        throw new Error('bad frame');
      }
      const message = parse(text);
      if (message.t !== 'part') {
        reset();
        return message;
      }
      const { id, i, n, d } = message;
      const sound = typeof id === 'string' && id.length <= 24 && typeof d === 'string'
        && Number.isInteger(n) && n >= 2 && n <= PARTS_MAX && Number.isInteger(i);
      if (!sound) {
        throw new Error('bad frame');
      }
      if (id !== partId) {
        reset();
        partId = id;
      }
      size += d.length;
      if (i !== parts.length || size > MESSAGE_MAX) {
        reset();
        throw new Error('bad frame');
      }
      parts.push(d);
      if (parts.length < n) {
        return undefined;
      }
      const whole = parts.join('');
      reset();
      return parse(whole);
    },
  };
}

// One exchange over an open channel with `sync` (platform/sync/engine.js).
// -> Promise of { peer, received, sent }: the other device's id, how many slices were new to
// this device, how many were sent. Rejects with Error('off' | 'timeout' | 'closed' | 'version' |
// 'self' | 'bad') and leaves the channel open: the caller closes it.
export function exchange({ channel, sync, timers = realTimers, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    if (!sync.status().enabled) {
      reject(new Error('off'));
      return;
    }
    const frames = createReassembler();
    let peer = null;
    let sentDone = false;
    let gotDone = false;
    let received = 0;
    let sent = 0;
    let bad = 0;
    let over = false;
    let timer = null;
    const end = (error, result) => {
      if (over) {
        return;
      }
      over = true;
      timers.clear(timer);
      channel.onmessage = null;
      channel.onclose = null;
      return error ? reject(error) : resolve(result);
    };
    const send = message => toFrames(message).forEach(frame => channel.send(frame));
    const check = () => {
      if (sentDone && gotDone) {
        end(null, { peer, received, sent });
      }
    };
    const tooBad = () => {
      bad += 1;
      if (bad > BAD_MAX) {
        end(new Error('bad'));
      }
    };

    async function onHello(message) {
      const have = message.have;
      if (message.v !== PROTO_VERSION || !isDev(message.dev)) {
        throw new Error('version');
      }
      if (peer !== null) {
        return;
      }
      if (message.dev === sync.status().dev) {
        throw new Error('self');
      }
      peer = message.dev;
      for (const slice of sync.slicesFor(have)) {
        const bytes = await packSlice(slice, { shrink: SHRINKS });
        if (bytes) {
          send({ t: 'slice', d: sliceToText(bytes) });
          sent += 1;
        }
      }
      send({ t: 'done' });
      sentDone = true;
    }

    async function onSlice(message) {
      const bytes = typeof message.d === 'string' ? sliceFromText(message.d) : null;
      const slice = bytes && await unpackSlice(bytes);
      if (!slice) {
        tooBad();
        return;
      }
      received += (await sync.receive([slice])).accepted;
    }

    async function handle(text) {
      let message;
      try {
        message = frames.push(text);
      } catch {
        tooBad();
        return;
      }
      if (!message) {
        return;
      }
      if (message.t === 'hello') {
        await onHello(message);
      } else if (message.t === 'slice' && peer !== null) {
        await onSlice(message);
      } else if (message.t === 'done' && peer !== null) {
        gotDone = true;
      } else {
        tooBad();
      }
      check();
    }

    // Messages are handled one after the other, whatever each takes, and none is lost
    // while this device is still reading its own copy for its hello.
    let queue = (async () => {
      await sync.refresh();
      send({ t: 'hello', v: PROTO_VERSION, dev: sync.status().dev, have: sync.have() });
    })();
    channel.onmessage = text => {
      queue = queue.then(() => handle(text)).catch(error => end(error));
    };
    queue.catch(error => end(error));
    channel.onclose = () => end(new Error('closed'));
    timer = timers.set(() => end(new Error('timeout')), timeoutMs);
  });
}
