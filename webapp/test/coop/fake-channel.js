// Two connected fake channels for the tests: what one sends, the other receives, in order, after
// a delay. Delivery is by hand (flush), so a test decides when and in which interleaving the two
// directions arrive; within one direction the order is kept, as in a WebRTC data channel.
export function fakePair() {
  const queues = { a: [], b: [] }; // messages on their way TO a, TO b
  const make = side => ({
    onmessage: null,
    onclose: null,
    closed: false,
    send(text) {
      queues[side === 'a' ? 'b' : 'a'].push(text);
    },
    close() {
      this.closed = true;
      const peer = side === 'a' ? b : a;
      queues[side === 'a' ? 'b' : 'a'].push(null);
      void peer;
    },
  });
  const a = make('a');
  const b = make('b');
  const target = { a, b };
  const deliverOne = side => {
    const message = queues[side].shift();
    if (message === null) {
      target[side].onclose?.();
    } else if (message !== undefined) {
      target[side].onmessage?.(message);
    }
    return message !== undefined;
  };
  return {
    a,
    b,
    pending: side => queues[side].length,
    // Delivers one message to `side` ('a' or 'b'); false when none waits.
    step: deliverOne,
    // Delivers everything, alternating the two directions (a first) until both are empty.
    flush() {
      let moved = true;
      while (moved) {
        moved = deliverOne('a');
        moved = deliverOne('b') || moved;
      }
    },
  };
}
