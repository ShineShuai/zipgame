import { lastGift, recentGifts } from '../core/gift.js';
import { utcDayNumber } from './daily.js';

// The happiest-day gift: on the happiest day of a month (core/gift.js) every player can open one gift, a
// replay chance or an unlock chance, drawn at random. Once per happiest day; the gift of a day can be opened
// for OPEN_DAYS days (1: that day only). Nothing happens while `ref` (the first day of the 3D puzzles) is null.
// The app grants the chance (replay.addBonus or unlock.addToken) with the kind claim() returns.
// State, under GIFT_KEY: { v, day, kind }: the happiest day whose gift was opened last (null = none) and what it was.
export const GIFT_KEY = 'zip_gift', VERSION = 1, OPEN_DAYS = 1, KINDS = ['replay', 'unlock'];
// How many of the latest happiest days the tooltip lists. 6 is the least that leaves one reference day that fits them (checked for 6
// references and every 2nd month up to 9 years; with 5 about 1 case in 80 has two).
export const LIST_DAYS = 6;
// The days the tooltip lists on `day`: the latest LIST_DAYS happiest days, oldest first, or none until that many exist. A shorter list
// would hold every gift so far, and its first day would show in which month the reference day lies.
export const listDays = (ref, day) => {
  const days = recentGifts(ref, day, LIST_DAYS);
  return days.length === LIST_DAYS ? days : [];
};

export const fresh = () => ({ v: VERSION, day: null, kind: null });

// What a gift is: a replay chance, or an unlock chance (rand(n) -> integer 0..n-1; onlyReplay: nothing left to unlock, so a replay, no draw).
export const drawKind = (rand, onlyReplay = false) => (onlyReplay ? 'replay' : KINDS[rand(KINDS.length)]);

// A stored record, cleaned; null when it is not one.
export function sanitize(c) {
  if (!c || typeof c !== 'object' || c.v !== VERSION) return null;
  if (c.day === null) return fresh();
  return Number.isInteger(c.day) && c.day >= 0 && KINDS.includes(c.kind) ? { v: VERSION, day: c.day, kind: c.kind } : null;
}

// What the page shows for the gift (`view` = createGift().view(), `told` = the happiest day the player was already told about in this
// page load, `busy` = a game is running): { button: a gift waits, so the button in the bar shows; toast: tell the player now }. The
// toast comes once per happiest day and never covers a running game (the button alone is enough there; the toast waits).
export const present = (view, told, busy) => {
  const waits = Boolean(view) && !view.opened;
  return { button: waits, toast: waits && !busy && told !== view.day };
};

// sync (platform/sync/engine.js, optional): a gift opened on another device is opened here too;
// `s` stays this device's own record, what is read is the group's (`group()`).
export function createGift(storage, ref, now = () => new Date(), sync = null) {
  let s = null; // null until init()
  const group = () => (s && sync ? sync.view(GIFT_KEY, s) : s);
  const save = async () => { try { await storage.set(GIFT_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  const today = () => utcDayNumber(now());
  // The happiest day whose gift can be opened today, else null.
  const open = () => {
    const day = today(), g = lastGift(ref, day);
    return g !== null && day < g + OPEN_DAYS ? g : null;
  };
  return {
    // Loads the state (a new player starts with no gift opened).
    async init() {
      try {
        const r = await storage.get(GIFT_KEY), clean = sanitize(r && JSON.parse(r.value));
        if (clean) { s = clean; return; }
      } catch { /* fall through */ }
      s = fresh();
      await save();
    },
    // The stored record: { day, kind } of the gift opened last (day null = none yet); null before init().
    record() { const g = group(); return g && { day: g.day, kind: g.kind }; },
    // null: no gift today. Else { day (the happiest day), opened, kind (what the opened gift was, else null) }.
    view() {
      const g = group(), day = g && open();
      if (day === null || day === undefined) return null;
      return { day, opened: g.day === day, kind: g.day === day ? g.kind : null };
    },
    // Opens today's gift: draws the kind (rand(n) -> integer 0..n-1; onlyReplay: nothing left to unlock, so a
    // replay chance). null = no gift to open (none today, or already opened), so calling it twice is harmless.
    async claim(rand, onlyReplay = false) {
      const g = group(), day = g && open();
      if (day === null || day === undefined || g.day === day) return null;
      const kind = drawKind(rand, onlyReplay);
      s = { v: VERSION, day, kind }; // set before the first await: a second tap meets an opened gift
      await save();
      return kind;
    },
  };
}
