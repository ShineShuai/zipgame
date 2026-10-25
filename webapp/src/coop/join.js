import { acceptReply, createInvite, joinInvite } from './rtc.js';
import {
  deriveRoom, fingerprint, isPublicKey, makeToken, newId, newPair, newSecret, pairKey, seal,
  splitToken, unseal,
} from './secret.js';

// Joining by link: the host opens a room on the brokers (signal.js), the guest finds it from the
// link, asks to join with a short greeting, and the host decides. Only then does the host make
// its connection offer, so nobody gets the host's addresses before being accepted. All messages
// are retained, sealed (secret.js) and sent to topics below zipcoop/1/<room>/:
//
//   open        host   {needGreeting}      the room is there; true: a greeting is required
//   req/<id>    guest  {pub, greeting}     wants to join: its public key and its greeting
//   seen/<id>   host   {}                  the request arrived (the host's page is awake)
//   ok/<id>     host   "A" pub "." sealed  accepted: its public key (the guest checks it against
//                                          the fingerprint in the link), then the offer sealed
//                                          with the key the two share (nobody else can read it
//                                          or answer)
//               host   "N" sealed {why}    refused: declined | taken | busy | greeting
//   ans/<id>    guest  sealed {answer}     the connection answer, sealed with the shared key
//
// The offer and the answer are the codes of rtc.js, the same as when people carry them. Once
// the channel is open the room is no longer needed: the host removes the messages.
export const STAGES = [
  'looking', 'ready', 'asked', 'seen', 'quiet', 'connecting', 'declined', 'taken', 'timeout',
  'down', 'failed',
]; // what joinRoom reports (onState)
export const GREETING_MAX = 80; // characters
export const PENDING_MAX = 3; // requests the host shows at once
const GUESTS_MAX = 50; // requests the host remembers, so that a flood cannot grow the list
const REPEAT = 3; // resends of a message that waits for an answer (signal.js)
export const HUB_WAIT_MS = 8000; // no broker connected by then: say so
export const OPEN_WAIT_MS = 3000; // guest: no room found by then: let the guest ask anyway
export const SEEN_WAIT_MS = 10000; // guest: no sign that the host's page got the request
export const ASK_MS = 180000; // guest: waits this long for the host's answer
export const ROOM_MS = 600000; // host: an invite lasts this long
const ID = /^[A-Za-z0-9_-]{11}$/;

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
const defaultRtc = { createInvite, acceptReply, joinInvite };

const names = room => {
  const base = `zipcoop/1/${room}`;
  return {
    open: `${base}/open`,
    requests: `${base}/req/+`,
    answers: `${base}/ans/+`,
    req: id => `${base}/req/${id}`,
    seen: id => `${base}/seen/${id}`,
    ok: id => `${base}/ok/${id}`,
    ans: id => `${base}/ans/${id}`,
  };
};

const idOf = topic => {
  const id = topic.slice(topic.lastIndexOf('/') + 1);
  return ID.test(id) ? id : null;
};

// A greeting as shown: no control characters, trimmed, at most GREETING_MAX characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
export const cleanGreeting = text => [...String(text ?? '').replace(CONTROL, ' ').trim()]
  .slice(0, GREETING_MAX).join('');

// Host. -> { token, accept(id), decline(id), setNeedGreeting(on), close(), pending() }; the token
// goes into the link (#j=<token>).
//   onRequest(list)       the requests that wait for a decision: [{ id, greeting }]
//   onConnection(conn)    the connection (rtc.js) made for the accepted guest, before the offer
//                         is sent
//   onDown()              no broker could be reached
//   onExpired()           nobody joined in ROOM_MS; the room is already closed
//   onError(error)        the connection could not be made
export async function hostRoom({
  hub,
  secret = newSecret(),
  needGreeting = false,
  rtc = defaultRtc,
  timers = realTimers,
  roomMs = ROOM_MS,
  onRequest,
  onConnection,
  onDown,
  onExpired,
  onError,
}) {
  const { room, key } = await deriveRoom(secret);
  const identity = await newPair(); // the host's own key pair, for every guest of this room
  const token = await makeToken(secret, identity.pub);
  const topic = names(room);
  const guests = new Map(); // id -> { state, pub, greeting, pairKey, connection }
  let accepted = null;
  let required = needGreeting;
  let closed = false;

  const pending = () => [...guests].filter(([, guest]) => guest.state === 'pending')
    .map(([id, guest]) => ({ id, greeting: guest.greeting }));
  const report = () => onRequest?.(pending());

  async function publishOpen() {
    hub.publish(topic.open, await seal(key, topic.open, { needGreeting: required }));
  }

  async function refuse(id, why) {
    const to = topic.ok(id);
    hub.publish(to, `N${await seal(key, to, { why })}`, { repeat: REPEAT });
  }

  async function onRequestMessage(from, message) {
    const id = idOf(from);
    if (!id || closed || guests.has(id) || guests.size >= GUESTS_MAX) {
      return;
    }
    guests.set(id, { state: 'reading' });
    const body = await unseal(key, from, message);
    if (!body || !isPublicKey(body.pub)) {
      guests.set(id, { state: 'ignored' });
      return;
    }
    const greeting = cleanGreeting(body.greeting);
    const guest = { state: 'refused', pub: body.pub, greeting };
    guests.set(id, guest);
    if (accepted) {
      await refuse(id, 'taken');
    } else if (required && !greeting) {
      await refuse(id, 'greeting');
    } else if (pending().length >= PENDING_MAX) {
      await refuse(id, 'busy');
    } else {
      guest.state = 'pending';
      hub.publish(topic.seen(id), await seal(key, topic.seen(id), {}), { repeat: REPEAT });
      report();
    }
  }

  async function onAnswerMessage(from, message) {
    const id = idOf(from);
    const guest = guests.get(id);
    if (closed || !guest || guest.state !== 'accepted' || !guest.pairKey || guest.answering) {
      return;
    }
    guest.answering = true;
    const body = await unseal(guest.pairKey, from, message);
    try {
      if (body && typeof body.answer === 'string' && !closed) {
        await rtc.acceptReply(guest.connection, body.answer);
        guest.answered = true;
      }
    } catch {
      // not a usable answer: a repeat of the right one can still come
    }
    guest.answering = guest.answered === true;
  }

  async function accept(id) {
    const guest = guests.get(id);
    if (closed || accepted || guest?.state !== 'pending') {
      return false;
    }
    accepted = id;
    guest.state = 'accepted';
    timers.clear(expiry);
    guests.forEach((other, otherId) => {
      if (other.state === 'pending') {
        other.state = 'refused';
        refuse(otherId, 'taken');
      }
    });
    report();
    try {
      const { code, connection } = await rtc.createInvite();
      if (closed) {
        connection.close();
        return false;
      }
      guest.connection = connection;
      onConnection?.(connection);
      guest.pairKey = await pairKey(identity.priv, guest.pub, room);
      const to = topic.ok(id);
      const offer = await seal(guest.pairKey, to, { offer: code });
      hub.publish(to, `A${identity.pub}.${offer}`, { repeat: REPEAT });
      return true;
    } catch (error) {
      accepted = null;
      guest.state = 'failed';
      onError?.(error);
      return false;
    }
  }

  async function decline(id) {
    const guest = guests.get(id);
    if (closed || guest?.state !== 'pending') {
      return;
    }
    guest.state = 'refused';
    report();
    await refuse(id, 'declined');
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    timers.clear(expiry);
    timers.clear(downCheck);
    hub.clear(topic.open);
    guests.forEach((guest, id) => {
      [topic.req(id), topic.seen(id), topic.ok(id), topic.ans(id)].forEach(name => hub.clear(name));
    });
    hub.close();
  }

  hub.subscribe(topic.requests, (from, message) => onRequestMessage(from, message));
  hub.subscribe(topic.answers, (from, message) => onAnswerMessage(from, message));
  const expiry = timers.set(() => {
    close();
    onExpired?.();
  }, roomMs);
  const downCheck = timers.set(() => {
    if (!closed && !hub.anyUp()) {
      onDown?.();
    }
  }, HUB_WAIT_MS);
  await publishOpen();

  return {
    room,
    token,
    accept,
    decline,
    pending,
    close,
    setNeedGreeting(on) {
      required = Boolean(on);
      return publishOpen();
    },
  };
}

// Guest. `token` is the link's. -> { ask(greeting), close() }; throws Error('bad code') for a token
// that is not one. onState(stage, info) reports where it is:
//   looking     the host's room is being looked for
//   ready       the guest may ask now (info.needGreeting: the host wants a greeting;
//               info.error 'greeting': the host's wish was not met)
//   asked       the request is sent       seen    the host's page has it
//   quiet       no sign of the host's page yet (asleep? it may wake up)
//   connecting  accepted; the connection is being made (onConnection(conn) comes first)
//   declined | taken   the host said no   timeout   no answer in ASK_MS
//   down        no broker could be reached   failed   the connection could not be made
export async function joinRoom({
  hub,
  token,
  rtc = defaultRtc,
  timers = realTimers,
  askMs = ASK_MS,
  onState,
  onConnection,
}) {
  const { secret, fingerprint: hostFingerprint } = splitToken(token);
  const { room, key } = await deriveRoom(secret);
  const topic = names(room);
  let needGreeting = false;
  let stage = 'looking';
  let mine = null; // { id, pair, opening, started }
  let closed = false;
  const waiting = []; // timers

  const set = (next, info = {}) => {
    stage = next;
    onState?.(next, { needGreeting, ...info });
  };

  async function onOpen(from, message) {
    const body = await unseal(key, from, message);
    if (!body || closed || !['looking', 'ready', 'down'].includes(stage)) {
      return;
    }
    needGreeting = body.needGreeting === true;
    set('ready');
  }

  async function onSeen(from, message) {
    if (await unseal(key, from, message) && (stage === 'asked' || stage === 'quiet')) {
      set('seen');
    }
  }

  async function onOk(from, message) {
    const request = mine;
    if (closed || !request || request.started || request.opening) {
      return;
    }
    if (message[0] === 'N') {
      const body = await unseal(key, from, message.slice(1));
      if (!body) {
        return;
      }
      if (body.why === 'greeting') {
        mine = null;
        needGreeting = true;
        set('ready', { error: 'greeting' });
      } else {
        set(body.why === 'declined' ? 'declined' : 'taken');
      }
      return;
    }
    const dot = message.indexOf('.');
    if (message[0] !== 'A' || dot < 0) {
      return;
    }
    request.opening = true;
    try {
      const hostKey = message.slice(1, dot);
      if (!isPublicKey(hostKey) || await fingerprint(hostKey) !== hostFingerprint) {
        return; // not the host of this link
      }
      const shared = await pairKey(request.pair.priv, hostKey, room);
      const body = await unseal(shared, from, message.slice(dot + 1));
      if (!body || typeof body.offer !== 'string') {
        return;
      }
      request.started = true;
      set('connecting');
      const { code, connection } = await rtc.joinInvite(body.offer);
      onConnection?.(connection);
      const to = topic.ans(request.id);
      hub.publish(to, await seal(shared, to, { answer: code }), { repeat: REPEAT });
    } catch (error) {
      if (request.started) {
        set('failed', { error });
      }
    } finally {
      request.opening = false;
    }
  }

  async function ask(greeting) {
    const text = cleanGreeting(greeting);
    if (closed || mine) {
      return false;
    }
    if (needGreeting && !text) {
      set('ready', { error: 'greeting' });
      return false;
    }
    const request = { id: newId(), pair: null, opening: false, started: false };
    mine = request;
    request.pair = await newPair();
    set('asked');
    hub.subscribe(topic.seen(request.id), onSeen);
    hub.subscribe(topic.ok(request.id), onOk);
    const to = topic.req(request.id);
    const body = { pub: request.pair.pub, greeting: text };
    hub.publish(to, await seal(key, to, body), { repeat: REPEAT });
    waiting.push(timers.set(() => {
      if (stage === 'asked') {
        set('quiet');
      }
    }, SEEN_WAIT_MS));
    waiting.push(timers.set(() => {
      if (['asked', 'quiet', 'seen'].includes(stage)) {
        set('timeout');
      }
    }, askMs));
    return true;
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    waiting.forEach(id => timers.clear(id));
    if (mine) {
      hub.clear(topic.req(mine.id));
      hub.clear(topic.ans(mine.id));
    }
    hub.close();
  }

  hub.subscribe(topic.open, onOpen);
  waiting.push(timers.set(() => {
    if (stage === 'looking') {
      set('ready');
    }
  }, OPEN_WAIT_MS));
  waiting.push(timers.set(() => {
    if (!closed && !hub.anyUp()) {
      set('down');
    }
  }, HUB_WAIT_MS));

  return { room, ask, close };
}
