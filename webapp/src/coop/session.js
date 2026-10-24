import { parsePuzzle, serializePuzzle } from './model.js';
import { createReplica } from './replica.js';

// The conversation of two devices over a channel (a WebRTC data channel, or a fake one in the
// tests): who is who, the puzzle, the start, every drawn line, hints. Messages are JSON text.
//
//   hello  {v}            both, as soon as the channel is open
//   puzzle {text, seed}   host -> guest: a new game (the puzzle in the play app's text format,
//                         with its solution); the guest answers ready
//   ready  {seed}         guest -> host
//   start  {seed}         host -> guest, once the guest is ready; both start the clock then
//   op     {op}           a drawn or erased line (see replica.js)
//   hint   {hint}         a hint that was asked for; both boards show it
//   bye    {}             the sender leaves
//
// A channel is { send(text), close(), onmessage, onclose }. The session sets the last two.
// It reports to `onEvent({ type, ... })`: peer, puzzle, start, op, rejected, hint, left, closed,
// stalled (host: the other device never took the puzzle).
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

export function createSession({
  role,
  channel,
  onEvent,
  resendMs = RESEND_MS,
  resends = RESENDS,
  // arrow functions: a browser's setTimeout throws when it is called as a method of another object
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
}) {
  const pid = role === 'host' ? HOST : GUEST;
  let replica = null;
  let left = false;
  let warned = false;
  let offer = null; // host: { text, seed, ready, tries, timer } of the game being offered
  let heard = null; // guest: { text, seed, started, tries, timer } of the game being asked for

  // False when the message could not be sent (the channel is not open): logged once.
  const send = message => {
    if (left) {
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
    send({ t: 'puzzle', text: game.text, seed: game.seed });
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

  function newReplica(puzzle) {
    replica = createReplica(puzzle, {
      pid,
      send: op => send({ t: 'op', op }),
      onRejected: op => onEvent({ type: 'rejected', op }),
    });
    return replica;
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
        const mine = newReplica(puzzle);
        timers.clear(heard?.timer);
        heard = { text: message.text, seed: message.seed, started: false, tries: 0, timer: null };
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
          onEvent({ type: 'start' });
        }
        break;
      case 'start':
        if (!heard || heard.started || (message.seed ?? heard.seed) !== heard.seed) {
          break;
        }
        heard.started = true;
        timers.clear(heard.timer);
        onEvent({ type: 'start' });
        break;
      case 'op':
        if (replica?.receive(message.op)) {
          onEvent({ type: 'op' });
        }
        break;
      case 'hint':
        onEvent({ type: 'hint', hint: message.hint });
        break;
      case 'bye':
        onEvent({ type: 'left' });
        break;
      default:
        break;
    }
  }

  channel.onmessage = text => {
    try {
      handle(JSON.parse(text));
    } catch (error) {
      console.warn('coop: a message was not understood', error);
    }
  };
  channel.onclose = () => onEvent({ type: 'closed' });

  return {
    pid,
    role,
    hello: () => send({ t: 'hello', v: VERSION }),
    // Host: starts a game with this puzzle (generated here); returns this device's replica.
    newGame(puzzle, seed) {
      const text = serializePuzzle(puzzle, { path: puzzle.path });
      const mineReplica = newReplica(puzzle);
      timers.clear(offer?.timer);
      offer = { text, seed, ready: false, tries: 0, timer: null };
      offerAgain();
      return mineReplica;
    },
    sendHint: hint => send({ t: 'hint', hint }),
    leave() {
      send({ t: 'bye' });
      left = true;
      timers.clear(offer?.timer);
      timers.clear(heard?.timer);
      channel.onclose = null;
      channel.close();
    },
    get replica() {
      return replica;
    },
  };
}
