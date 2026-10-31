// Shared by the device-sync tests: a storage port in memory and two connected channels.
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    raw: map,
    async get(key) { return map.has(key) ? { value: map.get(key) } : null; },
    async set(key, value) { map.set(key, value); return true; },
    async remove(key) { map.delete(key); },
    async keys(prefix = '') { return [...map.keys()].filter(key => key.startsWith(prefix)); },
  };
}

// Two channels: what one sends arrives at the other, in order, on a later turn of the event
// loop (like a data channel). close() ends both. `log` collects what each side sent.
export function channelPair() {
  const log = { a: [], b: [] };
  const make = side => ({
    onmessage: null,
    onclose: null,
    closed: false,
    send(text) {
      log[side].push(text);
      const peer = side === 'a' ? b : a;
      setTimeout(() => { if (!peer.closed) peer.onmessage?.(text); }, 0);
    },
    close() {
      for (const end of [a, b]) {
        if (!end.closed) {
          end.closed = true;
          setTimeout(() => end.onclose?.(), 0);
        }
      }
    },
  });
  const a = make('a');
  const b = make('b');
  return { a, b, log };
}

export const manualTimers = () => {
  const pending = new Map();
  let next = 1;
  return {
    set(fn) { pending.set(next, fn); return next++; },
    clear(id) { pending.delete(id); },
    fire() { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    get count() { return pending.size; },
  };
};

export const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
