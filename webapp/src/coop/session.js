import { loadBalls, ballsLoaded } from '../core/solid/balls.js';
import { parsePuzzle, serializePuzzle } from './model.js';
import { createReplica } from './replica.js';

// The conversation of two devices over a channel (a WebRTC data channel, or a fake one in the
// tests): who is who, the puzzle, the start, every drawn line, hints. Messages are JSON text.
//
//   hello  {v}            both, as soon as the channel is open
//   puzzle {text, seed, pid?}   host -> guest: a new game (the puzzle in the play app's text
//                         format, with its solution); the guest answers ready. With `pid`: a game
//                         that is already on, and the guest takes that player's place
//   ready  {seed}         guest -> host
//   start  {seed}         host -> guest, once the guest is ready; both start the clock then
//   op     {op}           a drawn or erased line (see replica.js)
//   hint   {hint}         a hint that was asked for; both boards show it
//   bye    {}             the sender leaves
//   secret {s}            host -> guest, on a connection made by hand (copy and paste): the secret
//                         the two keep, so that they can find each other again (resume.js)
//   ping   {}             every few seconds while a game runs (heartbeat): a device that hears
//                         nothing for a while reports `closed`, and `alive` once it hears again
//   resume {game, elapsed, hints}   a game that goes on over a new channel (after a break or a
//   sync   {ops}          reload): who has which game, the time and the hints used so far, and
//                         all the lines the sender knows, in chunks (any order, any repeat is fine)
//
// A channel is { send(text), close(), onmessage, onclose }. The session sets the last two.
// It reports to `onEvent({ type, ... })`: peer, puzzle, start, op, rejected, hint, left, closed,
// alive, resume, secret, stalled (host: the other device never took the puzzle). `start` says
// which game (seed) and whether it was shared (a game that was already on).
//
// The channel can be replaced while the game runs (attach), or be missing (a game taken up again
// after a reload): the drawing is a replica that does not depend on it (replica.js), so lines
// drawn meanwhile are kept, and `resume` sends them over the next channel.
//
// The start of a game does not rely on one message getting through: the host repeats `puzzle`
// until `ready` comes back, the guest repeats `ready` until `start` comes (the host answers every
// `ready` with `start`), and every step is harmless when it arrives twice. A channel event
// `closed` does not stop the session from sending: the transport may report an end and recover
// (a browser calls a connection `failed` while the host still has not pasted the reply); a send
// that really cannot be made is logged, and the host's `stalled` tells the player.
export const HOST = 0;
export const GUEST = 1;
const VERSION = 1;
const RESEND_MS = 1500;
const RESENDS = 6; // after the first message: about 9 s, then the host gives up (`stalled`)
const PING_MS = 5000;
const DEAD_MS = 15000; // nothing heard for this long: the channel is reported as ended
const CHUNK = 100; // lines per `sync` message (about 8 KB)
// A channel that is not there: sending fails quietly.
const detached = {
  send() {
    throw new Error('no channel');
  },
  close() {},
  onmessage: null,
  onclose: null,
};

export function createSession({
  role,
  pid: ownPid = null, // a host that takes over a game of the guest's side keeps its player number
  channel: first = null,
  onEvent,
  info = () => ({ elapsed: 0, hints: 0 }), // the time and the hints, for the one that joins a game
  resendMs = RESEND_MS,
  resends = RESENDS,
  heartbeat = false, // ping now and then while a game runs, and report a channel that stays silent
  now = () => Date.now(),
  // arrow functions: a browser's setTimeout throws when it is called as a method of another object
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
}) {
  let pid = ownPid ?? (role === 'host' ? HOST : GUEST);
  let replica = null;
  let left = false;
  let warned = false;
  let offer = null; // host: { text, seed, ready, tries, timer } of the game being offered
  let heard = null; // guest: { text, seed, started, tries, timer } of the game being asked for
  let channel = first ?? detached;
  let current = null; // { text, seed } of the game that is on: kept so that it can be saved
  let lastHeard = now();
  let silent = false; // `closed` was reported for lack of news, and nothing was heard since
  let beat = null;

  // False when the message could not be sent (the channel is not open): logged once.
  const send = message => {
    if (left || channel === detached) {
      return false;
    }
    try {
      channel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('coop: a message could not be sent', error);
      }
      return false;
    }
  };

  // Host: sends the puzzle again and again until the guest says ready.
  function offerAgain() {
    const game = offer;
    if (!game || game.ready || left) {
      return;
    }
    if (game.tries > resends) {
      onEvent({ type: 'stalled' });
      return;
    }
    game.tries++;
    send({
      t: 'puzzle', text: game.text, seed: game.seed, ...(game.shared ? { pid: 1 - pid } : {}),
    });
    game.timer = timers.set(offerAgain, resendMs);
  }

  // Guest: says ready again and again until the host's start comes.
  function askAgain() {
    const game = heard;
    if (!game || game.started || left || game.tries > resends) {
      return;
    }
    game.tries++;
    send({ t: 'ready', seed: game.seed });
    game.timer = timers.set(askAgain, resendMs);
  }

  // With `heartbeat`, both devices ping now and then while a game runs; a silent channel is ended.
  function watch() {
    timers.clear(beat);
    beat = timers.set(() => {
      if (left) {
        return;
      }
      send({ t: 'ping' });
      if (!silent && channel !== detached && now() - lastHeard > DEAD_MS) {
        silent = true;
        onEvent({ type: 'closed' });
      }
      watch();
    }, PING_MS);
  }

  function newReplica(puzzle) {
    replica = createReplica(puzzle, {
      pid,
      send: op => send({ t: 'op', op }),
      onRejected: op => onEvent({ type: 'rejected', op }),
    });
    if (heartbeat && !beat) {
      watch();
    }
    return replica;
  }

  // Host: offers the game that is on to the device on the channel, which takes the other
  // player's place (it learns which in the message), until it says ready. Then it gets the time
  // and every line (sendState).
  function offerCurrent() {
    if (role === 'host' && current) {
      timers.clear(offer?.timer);
      offer = { ...current, ready: false, tries: 0, timer: null, shared: true };
      offerAgain();
    }
  }

  // The game as it stands: which one, the time and hints, and every line (in chunks).
  function sendState(now = info()) {
    if (!replica || !current) {
      return false;
    }
    send({ t: 'resume', game: current.seed, elapsed: now.elapsed, hints: now.hints });
    const ops = replica.ops();
    for (let at = 0; at < ops.length; at += CHUNK) {
      send({ t: 'sync', ops: ops.slice(at, at + CHUNK) });
    }
    return true;
  }

  function handle(message) {
    switch (message.t) {
      case 'hello':
        onEvent({ type: 'peer', compatible: message.v === VERSION });
        break;
      case 'puzzle': {
        if (role !== 'guest') {
          break;
        }
        if (heard?.text === message.text && heard.seed === message.seed) {
          send({ t: 'ready', seed: message.seed }); // the host repeats: our ready did not arrive
          break;
        }
        const puzzle = parsePuzzle(message.text);
        puzzle.seed = message.seed;
        if (message.pid === HOST || message.pid === GUEST) {
          pid = message.pid; // a game that is on: this device takes the place that is free
        }
        const mine = newReplica(puzzle);
        timers.clear(heard?.timer);
        heard = { text: message.text, seed: message.seed, started: false, tries: 0, timer: null };
        current = { text: message.text, seed: message.seed };
        askAgain();
        onEvent({ type: 'puzzle', puzzle, seed: message.seed, replica: mine });
        break;
      }
      case 'ready':
        if (role !== 'host' || !offer || (message.seed ?? offer.seed) !== offer.seed) {
          break;
        }
        if (offer.ready) {
          send({ t: 'start', seed: offer.seed }); // the guest asks again: it missed the start
        } else {
          offer.ready = true;
          timers.clear(offer.timer);
          send({ t: 'start', seed: offer.seed });
          if (offer.shared) {
            sendState();
          }
          onEvent({ type: 'start', seed: offer.seed, shared: Boolean(offer.shared) });
        }
        break;
      case 'start':
        if (!heard || heard.started || (message.seed ?? heard.seed) !== heard.seed) {
          break;
        }
        heard.started = true;
        timers.clear(heard.timer);
        onEvent({ type: 'start', seed: heard.seed, shared: false });
        break;
      case 'op':
        if (replica?.receive(message.op)) {
          onEvent({ type: 'op' });
        }
        break;
      case 'hint':
        onEvent({ type: 'hint', hint: message.hint });
        break;
      case 'resume':
        onEvent({
          type: 'resume',
          game: message.game,
          elapsed: Number(message.elapsed),
          hints: Number(message.hints) || 0,
        });
        if (message.game !== current?.seed) {
          offerCurrent(); // the other device has another game (or none): the host's is the one
        }
        break;
      case 'sync': {
        const ops = Array.isArray(message.ops) ? message.ops.slice(0, CHUNK * 2) : [];
        if (ops.filter(op => replica?.receive(op)).length > 0) {
          onEvent({ type: 'op' });
        }
        break;
      }
      case 'secret':
        if (role === 'guest' && /^[A-Za-z0-9_-]{22}$/.test(message.s)) {
          onEvent({ type: 'secret', secret: message.s });
        }
        break;
      case 'ping':
        break;
      case 'bye':
        onEvent({ type: 'left' });
        break;
      default:
        break;
    }
  }

  const receive = text => {
    lastHeard = now();
    if (silent) {
      silent = false;
      onEvent({ type: 'alive' });
    }
    try {
      handle(JSON.parse(text));
    } catch (error) {
      console.warn('coop: a message was not understood', error);
    }
  };
  // A ball is told by its number in the catalog of the balls, which is loaded when first wanted. A
  // puzzle that is a ball waits for it, and the messages after it wait their turn behind it.
  let waiting = null;
  const onMessage = text => {
    if (waiting) {
      waiting = waiting.then(() => receive(text));
    } else if (text.includes('surface ball ') && !ballsLoaded()) {
      waiting = loadBalls().then(() => receive(text));
    } else {
      receive(text);
    }
  };
  // A channel that reports its end is not given up: sending goes on, and a send that cannot be made
  // is logged (see the head of this file).
  const bind = next => {
    channel = next;
    channel.onmessage = onMessage;
    channel.onclose = () => {
      onEvent({ type: 'closed' });
    };
    lastHeard = now();
    silent = false;
    warned = false;
  };
  bind(channel);

  return {
    get pid() {
      return pid;
    },
    role,
    hello: () => send({ t: 'hello', v: VERSION }),
    sendSecret: secret => send({ t: 'secret', s: secret }),
    // Host: the game that is on goes to the device on this channel (a friend invited to help).
    share() {
      if (role !== 'host' || !current) {
        return false;
      }
      offerCurrent();
      return true;
    },
    // Host: starts a game with this puzzle (generated here); returns this device's replica.
    newGame(puzzle, seed) {
      const text = serializePuzzle(puzzle, { path: puzzle.path });
      const mineReplica = newReplica(puzzle);
      timers.clear(offer?.timer);
      offer = { text, seed, ready: false, tries: 0, timer: null };
      current = { text, seed };
      offerAgain();
      return mineReplica;
    },
    sendHint: hint => send({ t: 'hint', hint }),
    // The game that is on: { text, seed } (null before one), for saving it.
    get current() {
      return current;
    },
    // A new channel takes the place of the old one (the caller closes the old connection).
    attach(next) {
      channel.onmessage = null;
      channel.onclose = null;
      bind(next);
    },
    // A game that was kept: its puzzle text, seed and all lines known -> this device's replica.
    // The channel comes later (attach); until then it is only a drawing.
    async restore({ text, seed, ops }) {
      if (text.includes('surface ball ') && !ballsLoaded()) {
        await loadBalls();
      }
      const puzzle = parsePuzzle(text);
      puzzle.seed = seed;
      const mine = newReplica(puzzle);
      ops.forEach(op => mine.receive(op));
      current = { text, seed };
      if (role === 'host') {
        offer = { ...current, ready: true, tries: 0, timer: null };
      } else {
        heard = { ...current, started: true, tries: 0, timer: null };
      }
      return mine;
    },
    // On a new channel, after hello: tells which game goes on and sends every line known.
    resume: now => sendState(now),
    leave() {
      send({ t: 'bye' });
      left = true;
      timers.clear(offer?.timer);
      timers.clear(heard?.timer);
      timers.clear(beat);
      channel.onclose = null;
      channel.close();
    },
    get replica() {
      return replica;
    },
  };
}
