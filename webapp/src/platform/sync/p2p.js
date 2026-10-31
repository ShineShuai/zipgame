// Linking devices directly (option D): the player makes a link on one device and opens it on
// the other; everything after that happens in the background. The two pages meet on the public
// brokers (coop/signal.js), sealed so that the brokers see nothing, make a WebRTC connection
// (coop/rtc.js) and trade their slices over it (proto.js). The connection needs no server of
// ours and carries no data through anyone else's.
//
//   link   the host makes a room (coop/join.js) and shows `<page>#y=<token>`; the first device
//          that opens it is let in, without a question, and the room is closed. The guest
//          confirms ON ITS OWN SIDE before anything starts (the page asks once): a link that
//          joins devices must not join them by itself.
//   meet   later, with nobody asked, two linked devices that have the page open at the same
//          time find each other again by the secret they share (coop/resume.js) and trade
//          what is new. Looking lasts WINDOW_MS, and starts again not before GAP_MS.
//
// The co-op trial folder (src/coop) is loaded when needed, so the app runs without it: then
// `supported()` is false and the way is not offered. Both devices must be open together while
// they meet; devices that are not will use the cloud (a later patch).
import { fromBase64Url, toBase64Url } from '../../core/sync/base64.js';
import { cleanLabel } from './engine.js';
import { exchange } from './proto.js';

export const INVITE_MS = 15 * 60 * 1000; // a link works this long (the host's page stays open)
export const WINDOW_MS = 20 * 60 * 1000; // how long a device looks for a linked device
export const GAP_MS = 10 * 60 * 1000; // before it looks again
export const CONNECT_MS = 30000; // a connection that has not opened by then is given up
export const CLOSE_DELAY_MS = 2500; // a finished connection is closed after this, not at once
const TOKEN = /^[A-Za-z0-9_-]{44}$/;

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };

// The token of a link's `#y=<token>` fragment, or null.
export function tokenOfHash(hash) {
  const match = /^#y=([^&]*)$/.exec(String(hash));
  return match && TOKEN.test(match[1]) ? match[1] : null;
}
export const linkOf = (pageUrl, token) => `${pageUrl}#y=${token}`;

// A short name for a device out of its user-agent text: "Safari · iPhone".
export function deviceLabel(userAgent) {
  const ua = String(userAgent ?? '');
  const browser = [[/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Firefox\/|FxiOS/, 'Firefox'],
    [/Chrome\/|CriOS/, 'Chrome'], [/Safari\//, 'Safari']].find(([re]) => re.test(ua));
  const system = [[/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'],
    [/Windows/, 'Windows'], [/Macintosh|Mac OS X/, 'Mac'], [/CrOS/, 'Chromebook'],
    [/Linux/, 'Linux']].find(([re]) => re.test(ua));
  return cleanLabel([browser && browser[1], system && system[1]].filter(Boolean).join(' · '));
}

// The parts of src/coop this needs, loaded on the first use.
async function loadCoop() {
  const [join, resume, rtc, signal, config, secret] = await Promise.all([
    import('../../coop/join.js'), import('../../coop/resume.js'), import('../../coop/rtc.js'),
    import('../../coop/signal.js'), import('../../coop/config.js'),
    import('../../coop/secret.js'),
  ]);
  return {
    hostRoom: join.hostRoom,
    joinRoom: join.joinRoom,
    resumeRoom: resume.resumeRoom,
    createHub: signal.createHub,
    brokers: config.SIGNAL_BROKERS,
    supported: () => rtc.rtcSupported() && secret.signalSupported(),
  };
}

const REASONS = {
  timeout: 'connect', closed: 'closed', version: 'version', self: 'self', bad: 'bad',
};

// Why a link failed, as one word: 'down' (no broker), 'expired', 'declined', 'taken',
// 'timeout' (nobody answered), 'connect' (no connection could be made), 'closed', 'version',
// 'self' (a link of this very device), 'bad' (the other side sent nonsense), 'off'.
const reasonOf = error => REASONS[error && error.message] || (error && error.message) || 'connect';

// sync: the engine (engine.js). coop: () -> Promise of the parts of src/coop (tests pass fakes;
// the fake may carry `rtc` and `timers` for the rooms). name: () -> what this device is called.
export function createP2p({
  sync,
  coop = loadCoop,
  timers = realTimers,
  now = () => Date.now(),
  pageUrl = () => location.href.split('#')[0],
  name = () => '',
}) {
  const listeners = new Set();
  const windows = new Map(); // peer dev -> { room, busy, endedAt }
  let lib = null;
  let activity = null; // the link being made or opened: { close() }

  const emit = event => listeners.forEach(fn => fn(event));
  const library = async () => {
    lib ??= await coop();
    return lib;
  };
  const label = () => sync.label() || cleanLabel(name()) || null;
  const options = () => ({
    ...(lib.rtc ? { rtc: lib.rtc } : {}),
    ...(lib.timers ? { timers: lib.timers } : {}),
  });
  const waitOpen = channel => new Promise((resolve, reject) => {
    if (channel.opened) {
      resolve();
      return;
    }
    const timer = timers.set(() => reject(new Error('timeout')), CONNECT_MS);
    channel.onopen = () => {
      timers.clear(timer);
      resolve();
    };
    channel.onclose = () => {
      timers.clear(timer);
      reject(new Error('closed'));
    };
  });

  // A connection was made (by a link or a meeting): trade slices, remember the device.
  // secret: what the two share, as base64url text.
  async function adopt({ connection, secret, pid, kind, hint = '' }) {
    emit({ type: 'connecting', kind });
    const { channel } = connection;
    const early = []; // what the other side sends before the exchange is ready for it
    channel.onmessage = text => early.push(text);
    try {
      await waitOpen(channel);
      emit({ type: 'syncing', kind });
      const result = await exchange({ channel, sync, timers, early });
      const peer = {
        dev: result.peer, secret, pid, name: result.name || cleanLabel(hint), at: now(),
      };
      await sync.addPeer(peer);
      emit({
        type: kind === 'link' ? 'linked' : 'synced',
        peer: { dev: peer.dev, name: peer.name },
        received: result.received,
        sent: result.sent,
      });
      return true;
    } catch (error) {
      emit({ type: 'failed', kind, reason: reasonOf(error) });
      return false;
    } finally {
      timers.set(() => connection.close?.(), CLOSE_DELAY_MS);
    }
  }

  // The name the others will see: what the player gave, else what the browser says.
  const ensureLabel = async () => {
    if (!sync.label() && cleanLabel(name())) {
      await sync.setLabel(name());
    }
  };

  // Sync was off and a link attempt turned it on: when no device came of it, off again.
  const undoIfAlone = async turnedOn => {
    if (turnedOn && sync.peers().length === 0) {
      await sync.disable();
    }
  };

  function begin(close, turnedOn) {
    activity?.close();
    const mine = { close: () => { close(); }, turnedOn };
    activity = mine;
    return mine;
  }
  function finish(mine) {
    if (!mine) {
      return Promise.resolve();
    }
    if (activity === mine) {
      activity = null;
    }
    mine.close();
    return undoIfAlone(mine.turnedOn);
  }

  const api = {
    // Can this browser link devices (WebRTC, WebCrypto, WebSocket, and the folder src/coop)?
    async supported() {
      try {
        return (await library()).supported();
      } catch {
        return false;
      }
    },

    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Host. Turns the P2P way on (the player asked for a link), opens the room and -> { link,
    // cancel() } at once; the rest is told by events: waiting, connecting, syncing, linked, or
    // failed ('down', 'expired', 'connect', ...).
    async invite() {
      await library();
      const turnedOn = !sync.enabled();
      await sync.enable({ p2p: true });
      await ensureLabel();
      const hub = lib.createHub({ brokers: lib.brokers });
      let room = null;
      let admitted = null;
      let mine = null;
      let hint = '';
      const admit = list => {
        if (admitted || !list.length) {
          return;
        }
        admitted = list[0].id;
        hint = list[0].greeting;
        if (room) {
          room.accept(admitted);
        }
      };
      try {
        room = await lib.hostRoom({
          hub,
          needGreeting: false,
          roomMs: INVITE_MS,
          ...options(),
          onRequest: admit,
          onConnection: async (connection, secret) => {
            const shared = toBase64Url(secret);
            await adopt({ connection, secret: shared, pid: 0, kind: 'link', hint });
            await finish(mine);
          },
          onDown: () => emit({ type: 'failed', kind: 'link', reason: 'down' }),
          onExpired: async () => {
            emit({ type: 'failed', kind: 'link', reason: 'expired' });
            await finish(mine);
          },
          onError: () => emit({ type: 'failed', kind: 'link', reason: 'connect' }),
        });
      } catch (error) {
        hub.close();
        await undoIfAlone(turnedOn);
        throw error;
      }
      mine = begin(() => room.close(), turnedOn);
      if (admitted) {
        room.accept(admitted);
      }
      const link = linkOf(pageUrl(), room.token);
      emit({ type: 'waiting', link });
      return {
        link,
        cancel: async () => {
          emit({ type: 'cancelled', kind: 'link' });
          await finish(mine);
        },
      };
    },

    // Guest, after the player confirmed. Turns the P2P way on, finds the room of the link and
    // asks to join with this device's name; the host lets the first in. -> { cancel() }.
    async join(token) {
      await library();
      const turnedOn = !sync.enabled();
      await sync.enable({ p2p: true });
      await ensureLabel();
      const hub = lib.createHub({ brokers: lib.brokers });
      let room = null;
      let asked = false;
      let mine = null;
      const ask = () => {
        if (room && !asked) {
          asked = true;
          room.ask(label() || '');
        }
      };
      try {
        room = await lib.joinRoom({
          hub,
          token,
          ...options(),
          onState: async (stage, info) => {
            emit({ type: 'stage', kind: 'link', stage });
            if (stage === 'ready' && !info.error) {
              ask();
            } else if (['declined', 'taken', 'timeout', 'down', 'failed'].includes(stage)) {
              emit({ type: 'failed', kind: 'link', reason: stage });
              await finish(mine);
            }
          },
          onConnection: async (connection, secret) => {
            await adopt({ connection, secret: toBase64Url(secret), pid: 1, kind: 'link' });
            await finish(mine);
          },
        });
      } catch (error) {
        hub.close();
        await undoIfAlone(turnedOn);
        throw error;
      }
      mine = begin(() => room.close(), turnedOn);
      ask();
      return {
        cancel: async () => {
          emit({ type: 'cancelled', kind: 'link' });
          await finish(mine);
        },
      };
    },

    // Looks for the linked devices (one window each, not while one is open or too soon after the
    // last one; force: now, whatever the gap). The devices that are open at the same time meet.
    async resume({ force = false } = {}) {
      if (!sync.enabled()) {
        return 0;
      }
      let started = 0;
      for (const peer of sync.peers()) {
        const known = windows.get(peer.dev);
        const resting = known && !known.room && now() - known.endedAt < GAP_MS;
        if ((known && known.room) || (resting && !force)) {
          continue;
        }
        const entry = { room: null, endedAt: 0, busy: false };
        windows.set(peer.dev, entry);
        const end = () => {
          entry.room?.close();
          entry.room = null;
          entry.endedAt = now();
        };
        try {
          await library();
          const hub = lib.createHub({ brokers: lib.brokers });
          entry.room = await lib.resumeRoom({
            hub,
            secret: fromBase64Url(peer.secret),
            pid: peer.pid,
            now,
            roomMs: WINDOW_MS,
            ...options(),
            onPeer: here => emit({ type: 'peer', peer: { dev: peer.dev, name: peer.name }, here }),
            onConnection: async connection => {
              if (entry.busy) {
                connection.close?.(); // a second attempt of the same meeting
                return;
              }
              entry.busy = true;
              const ok = await adopt({
                connection, secret: peer.secret, pid: peer.pid, kind: 'meet',
              });
              entry.busy = false;
              if (ok) {
                await sync.touchPeer(peer.dev, now());
                end();
              }
            },
            onExpired: end,
            onError: () => {},
          });
          emit({ type: 'looking', peer: { dev: peer.dev, name: peer.name } });
          started += 1;
        } catch {
          end();
        }
      }
      return started;
    },

    // The windows stop (the page is hidden or sync is turned off).
    stop() {
      for (const entry of windows.values()) {
        entry.room?.close();
        entry.room = null;
        entry.endedAt = now();
      }
    },
  };
  return api;
}
