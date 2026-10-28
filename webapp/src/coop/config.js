// Switches of Patchwork (everything in src/coop): draw pieces anywhere and join them into one path,
// alone or with a friend on another device. It is revealed like the other hidden things of the play
// app: hold V, five taps on the bare app bar, or a pinned dev link.
// ENABLED = false: boot.js registers nothing and nothing else of src/coop is loaded.
export const ENABLED = true;

// RELEASED = true: the menu's Patchwork card is shown to everyone, not only while V is held.
export const RELEASED = false;

// The board size that is preselected (the setup screen offers every size of the play app). This
// file is loaded at page start by boot.js, so it imports nothing.
export const DEFAULT_SIZE = 7;

// STUN servers: a browser asks one "what is my address from outside?" so that two devices on
// different networks can reach each other. They only answer that question; no game data passes
// through them, and they are not ours. Google's is not reachable from China, hence the others.
// A url is `stun:host[:port]` (RFC 7064): no `//`. The browser asks all of them at once, so more
// servers are spares, not a queue; a dead one only costs the wait (see GATHER_MS in rtc.js).
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
];

// Where two devices meet before they are connected (join.js, signal.js): public MQTT brokers, all
// used at once, so that one being down or blocked on either side does not stop a join. MQTT is
// a publish/subscribe messaging protocol; these brokers are free, open and carry no guarantee, so
// everything sent through them is encrypted (secret.js). `id` is the short name of the dev line;
// `url` is a secure WebSocket (a page cannot use a plain one). Each origin must also be listed
// in the connect-src of index.html (npm run check tells). Check a list with tools/signal-probe.mjs.
export const SIGNAL_BROKERS = [
  { id: 'mq', url: 'wss://test.mosquitto.org:8081' },
  { id: 'hv', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { id: 'em', url: 'wss://broker.emqx.io:8084/mqtt' },
];
