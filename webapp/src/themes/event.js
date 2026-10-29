// The offer of an event: which theme of the pool a device is offered. Pure functions; the controller (index.js) keeps the two small
// records in storage. How an event is triggered is not this code's business: it is handed an id (any string that names the event) and the
// time the offer ends.
//   - the device seed (random, made once) and the event id decide the theme, so a reload within the event shows the same theme and a
//     player cannot fish for another by reloading; devices differ from each other
//   - a theme the player owns is not offered; drafts (`live: false`) are never offered
export const SEED_KEY = 'zip_theme_seed';
export const EVENT_KEY = 'zip_theme_ev';     // the id of the last event the player answered (kept or left)
export const SEED_RE = /^[0-9a-f]{16}$/;
export const EVENT_RE = /^[\w.:-]{1,40}$/;

// FNV-1a, 32 bit
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const newSeed = random => Array.from({ length: 2 }, () => Math.floor(random() * 2 ** 32).toString(16).padStart(8, '0')).join('');

// `candidates` ([{ entry, ... }]) in the order they are to be tried: the pick first, then the others in a ring (the next one is the
// fall-back when a file is missing). The same seed and event always give the same order.
export function offerOrder(candidates, seed, eventId) {
  const list = [...candidates].sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));
  if (!list.length) return [];
  const at = hash(`${seed}|${eventId}`) % list.length;
  return [...list.slice(at), ...list.slice(0, at)];
}

// The end of the local day of `ms` (the next local midnight): when a day's offer ends.
export const endOfDay = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };

// Calls check() now and whenever a new day, or a new look at the page, may have come: the page becomes visible again, the network is back,
// the next local midnight passes. The page needs no reload to learn that it is an event day; deciding that (and calling offerTheme) is
// check's business. -> a function that stops the watching.
export function watchDay(check, { doc = globalThis.document, win = globalThis, now = Date.now, timers = globalThis } = {}) {
  let timer = null;
  const run = () => { try { check(); } catch { /* the next trigger tries again */ } };
  const arm = () => {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { run(); arm(); }, Math.min(endOfDay(now()) - now() + 1000, 2 ** 31 - 1));
  };
  const look = () => { if (doc.visibilityState !== 'hidden') { run(); arm(); } };
  doc.addEventListener('visibilitychange', look);
  win.addEventListener('online', look);
  run();
  arm();
  return () => { doc.removeEventListener('visibilitychange', look); win.removeEventListener('online', look); if (timer) timers.clearTimeout(timer); timer = null; };
}
