import { parse, serialize } from '../core/format.js';
import { createReplica } from './replica.js';

// The conversation of two devices over a channel (a WebRTC data channel, or a fake one in the
// tests): who is who, the puzzle, the start, every drawn line, hints. Messages are JSON text.
//
//   hello  {v}            both, as soon as the channel is open
//   puzzle {text, seed}   host -> guest: a new game (the puzzle in the play app's text format,
//                         with its solution); the guest answers ready
//   ready  {}             guest -> host
//   start  {}             host -> guest, once the guest is ready; both start the clock then
//   op     {op}           a drawn or erased line (see replica.js)
//   hint   {hint}         a hint that was asked for; both boards show it
//   bye    {}             the sender leaves
//
// A channel is { send(text), close(), onmessage, onclose }. The session sets the last two.
// It reports to `onEvent({ type, ... })`: peer, puzzle, start, op, rejected, hint, left, closed.
export const HOST = 0;
export const GUEST = 1;
const VERSION = 1;

export function createSession({ role, channel, onEvent }) {
  const pid = role === 'host' ? HOST : GUEST;
  let replica = null;
  let open = true;

  // A channel that is not open (yet, or any more) refuses to send: nothing to tell, no harm.
  const send = message => {
    if (!open) {
      return;
    }
    try {
      channel.send(JSON.stringify(message));
    } catch {
      // not open: the other side will notice when the connection ends
    }
  };

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
        const puzzle = parse(message.text);
        puzzle.seed = message.seed;
        send({ t: 'ready' });
        onEvent({ type: 'puzzle', puzzle, seed: message.seed, replica: newReplica(puzzle) });
        break;
      }
      case 'ready':
        if (role === 'host') {
          send({ t: 'start' });
          onEvent({ type: 'start' });
        }
        break;
      case 'start':
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
  channel.onclose = () => {
    open = false;
    onEvent({ type: 'closed' });
  };

  return {
    pid,
    role,
    hello: () => send({ t: 'hello', v: VERSION }),
    // Host: starts a game with this puzzle (generated here); returns this device's replica.
    newGame(puzzle, seed) {
      const text = serialize(puzzle, { path: puzzle.path });
      const mineReplica = newReplica(puzzle);
      send({ t: 'puzzle', text, seed });
      return mineReplica;
    },
    sendHint: hint => send({ t: 'hint', hint }),
    leave() {
      send({ t: 'bye' });
      open = false;
      channel.onclose = null;
      channel.close();
    },
    get replica() {
      return replica;
    },
  };
}
