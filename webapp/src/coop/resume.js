import { acceptReply, createInvite, joinInvite } from './rtc.js';
import { deriveResume, newId, seal, unseal } from './secret.js';

// Two devices that played together find each other again, with nobody asked: after a break in the
// connection, or when one of them comes back from a reload. They meet on the brokers (signal.js)
// in a room that only they can enter (the secret they derived when they joined, secret.js), and
// make a new connection the way a join does: one offers, the other answers. Both sides are alike,
// so it works whichever of them (the host or the guest) went away.
//
// Topics below zipcoop/1/<room>/, `pid` = 0 for the host's device and 1 for the guest's; every
// message is sealed with the room's key:
//   here/<pid>     {n, beat}                 I am here (retained), n = a number of this run, again
//                                            every BEAT_MS: a device that stops is soon forgotten
//   offer/<pid>    {from, to, offer}         the one with the smaller n offers (so that the two do
//                                            not both offer), to the other's current n
//   answer/<pid>   {from, to, answer}        the other answers, to the offerer's pid
// An offer that is not for this run (a left-over of an earlier one) is ignored: it names the
// numbers n of both runs. An attempt that does not open in ATTEMPT_MS is made again, as long as the
// other device is there.
export const BEAT_MS = 60000;
export const ALIVE_MS = 150000; // the other device counts as gone after this long without a beat
export const ATTEMPT_MS = 30000;
export const RESUME_MS = 30 * 60 * 1000; // how long a device keeps looking
const REPEAT = 3; // resends of an offer or an answer (signal.js)

const realTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
const defaultRtc = { createInvite, acceptReply, joinInvite };

// -> { close() }. `secret`: the 16 bytes the two devices share; `hub`: the brokers (signal.js).
//   onConnection(connection)  a new connection (rtc.js) was made: the caller takes it over; the
//                             room does not close it, and does not know when it opens: close() then
//   onPeer(here)              the other device is there (true) or has gone (false)
//   onExpired()               nobody came in RESUME_MS; the room is closed
//   onError(error)            a connection could not be made (the room goes on trying)
export async function resumeRoom({
  hub,
  secret,
  pid,
  rtc = defaultRtc,
  timers = realTimers,
  now = () => Date.now(),
  roomMs = RESUME_MS,
  onConnection,
  onPeer,
  onExpired,
  onError,
}) {
  const { room, key } = await deriveResume(secret);
  const base = `zipcoop/1/${room}`;
  const other = 1 - pid;
  const topic = {
    here: side => `${base}/here/${side}`,
    offer: side => `${base}/offer/${side}`,
    answer: side => `${base}/answer/${side}`,
  };
  const mine = newId(); // this run
  let beats = 0;
  let peer = null; // { n, seen }: the other device, as far as it has been heard
  let attempt = null; // { connection, timer, answered }: the offer made last
  let answering = null; // { offer, connection, timer }: the offer answered last
  let stash = null; // an offer that came before the beat of the one who made it
  let beater = null;
  let closed = false;

  const here = () => Boolean(peer) && now() - peer.seen < ALIVE_MS;

  async function announce() {
    const to = topic.here(pid);
    hub.publish(to, await seal(key, to, { n: mine, beat: beats++ }));
  }

  // An attempt that did not work out: its connection is closed (the caller took it over).
  function drop(thing) {
    if (thing) {
      timers.clear(thing.timer);
      thing.connection?.close();
    }
  }

  async function call() {
    const target = peer.n;
    const current = { connection: null, timer: null, answered: false };
    attempt = current;
    try {
      const { code, connection } = await rtc.createInvite();
      if (closed || attempt !== current) {
        connection.close();
        return;
      }
      current.connection = connection;
      onConnection?.(connection);
      const to = topic.offer(pid);
      const offer = await seal(key, to, { from: mine, to: target, offer: code });
      hub.publish(to, offer, { repeat: REPEAT });
      current.timer = timers.set(() => {
        if (attempt === current && !closed) {
          drop(current);
          attempt = null;
          hub.clear(to);
          maybeCall();
        }
      }, ATTEMPT_MS);
    } catch (error) {
      if (attempt === current) {
        attempt = null;
      }
      onError?.(error);
    }
  }

  function maybeCall() {
    if (!closed && !attempt && here() && mine < peer.n) {
      call();
    }
  }

  async function onHere(from, message) {
    const body = await unseal(key, from, message);
    if (!body || closed || typeof body.n !== 'string') {
      return;
    }
    if (!peer || peer.n !== body.n) {
      drop(attempt);
      attempt = null;
      drop(answering);
      answering = null;
    }
    const wasHere = here();
    peer = { n: body.n, seen: now() };
    if (!wasHere) {
      onPeer?.(true);
    }
    maybeCall();
    answer();
  }

  async function onOffer(from, message) {
    const body = await unseal(key, from, message);
    if (body && !closed) {
      stash = body;
      answer();
    }
  }

  // Answers the offer that came last, if it is for this run and from the one that is here now,
  // and that one is the one that may offer (the smaller n).
  async function answer() {
    const body = stash;
    if (!body || !peer || peer.n > mine || body.to !== mine || body.from !== peer.n
      || typeof body.offer !== 'string' || body.offer === answering?.offer) {
      return;
    }
    stash = null;
    drop(answering);
    const current = { offer: body.offer, connection: null, timer: null };
    answering = current;
    try {
      const { code, connection } = await rtc.joinInvite(body.offer);
      if (closed || answering !== current) {
        connection.close();
        return;
      }
      current.connection = connection;
      onConnection?.(connection);
      const to = topic.answer(other);
      const reply = await seal(key, to, { from: mine, to: body.from, answer: code });
      hub.publish(to, reply, { repeat: REPEAT });
      current.timer = timers.set(() => {
        if (answering === current && !closed) {
          drop(current);
          answering = null;
        }
      }, ATTEMPT_MS);
    } catch (error) {
      if (answering === current) {
        answering = null;
      }
      onError?.(error);
    }
  }

  async function onAnswer(from, message) {
    const body = await unseal(key, from, message);
    const current = attempt;
    if (!body || closed || !peer || !current?.connection || current.answered
      || body.to !== mine || body.from !== peer.n || typeof body.answer !== 'string') {
      return;
    }
    current.answered = true;
    try {
      await rtc.acceptReply(current.connection, body.answer);
    } catch (error) {
      current.answered = false;
      onError?.(error);
    }
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    timers.clear(beater);
    timers.clear(expiry);
    // the connections made are the caller's now (whichever opened is in use): not closed here
    [attempt, answering].forEach(thing => timers.clear(thing?.timer));
    [topic.here(pid), topic.offer(pid), topic.answer(other)].forEach(name => hub.clear(name));
    hub.close();
  }

  hub.subscribe(topic.here(other), onHere);
  hub.subscribe(topic.offer(other), onOffer);
  hub.subscribe(topic.answer(pid), onAnswer);
  const beat = () => {
    if (closed) {
      return;
    }
    announce();
    if (peer && !here()) {
      peer = null;
      onPeer?.(false);
    }
    beater = timers.set(beat, BEAT_MS);
  };
  beater = timers.set(beat, BEAT_MS);
  const expiry = timers.set(() => {
    close();
    onExpired?.();
  }, roomMs);
  await announce();

  return { close };
}
