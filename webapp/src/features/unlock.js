import { activeOffers, offerEnd, nextLucky, isLucky } from '../core/lucky.js';
import { utcDayNumber } from './daily.js';

// Unlockable variants. A locked variant is hidden in the menu (hold V shows it). Every lucky day
// (core/lucky.js) opens an offer: the lucky game, open to everyone until the next lucky day (at
// least 3 days). A player plays each offer once: a random variant (locked or not) as one puzzle.
// A player holding an unlock chance spends it by starting the game: solving it unlocks the variant
// for good (nothing changes when it was unlocked already); failing it, leaving it or reloading the
// page loses the chance. A player without a chance plays for fun and unlocks nothing.
//
// Chances come from the streak: with every streak reward the player picks a replay or an unlock chance
// (the app: addChoice, then takeChoice + addToken, or the replay).
// State, under UNLOCK_KEY: { v, unlocked: { id: day }, tokens (unlock chances), choices (streak
//   rewards still to pick), played: [offers started, by lucky day, the latest few], active: null |
//   { id, size, day, offer, holder } } (active: the game in progress; a stored one means the page
//   was closed during the game: abandoned).
// `defs` is [{ id, locked, pool, solid?, from?, open? }] (apps/play/variants.js
// luckyDefs): the sizes the lucky game of a locked variant may have, and those it may
// have once the variant is unlocked. The solid kinds are in the lucky game's list,
// and count for "all unlocked", only when every flat variant is unlocked and their
// `from` day (a UTC day number; null = never) has come. `open(day)` says the kind is
// open to everyone that day (its release), which counts as unlocked without the
// player's own unlock.
export const UNLOCK_KEY = 'zip_unlock', VERSION = 1, PLAYED_KEPT = 8;

export const fresh = () => ({ v: VERSION, unlocked: {}, tokens: 0, choices: 0, played: [], active: null });

const isCount = x => Number.isInteger(x) && x >= 0;

// A stored record, cleaned; null when it is not one. Unknown variant ids (a removed variant) are
// dropped, and a game left in progress is dropped too (abandoned). An older record kept its chances
// as a list: its length is the count.
export function sanitize(c, ids) {
  if (!c || typeof c !== 'object' || c.v !== VERSION || !c.unlocked || typeof c.unlocked !== 'object') return null;
  const tokens = Array.isArray(c.tokens) ? c.tokens.length : c.tokens;
  const played = c.played === undefined ? [] : c.played;
  // tokens and choices are this device's earned minus spent: below 0 while it spends what another device earned (sync)
  if (!Number.isInteger(tokens) || !Number.isInteger(c.choices) || !Array.isArray(played) || !played.every(isCount)) return null;
  const unlocked = {};
  for (const id of ids) if (isCount(c.unlocked[id])) unlocked[id] = c.unlocked[id];
  return { v: VERSION, unlocked, tokens, choices: c.choices, played: played.slice(-PLAYED_KEPT), active: null };
}

// sync (platform/sync/engine.js, optional): `s` stays this device's own record (what it earned, spent and
// unlocked); what is read is the group's (`group()`: unlocks of every device, the sum of the chances).
export function createUnlock(storage, defs, now = () => new Date(), sync = null) {
  const ids = defs.map(d => d.id);
  const today = () => utcDayNumber(now());
  let s = null; // null until init()
  const save = async () => { try { await storage.set(UNLOCK_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  // Unlocked by the player, or open to everyone today (a solid kind after its release).
  const group = () => {
    if (!s || !sync) return s;
    const g = sync.view(UNLOCK_KEY, s);
    return g === s ? s : { ...g, active: s.active }; // a game in progress belongs to its device
  };
  const isUnlocked = id => {
    if (!s) return false;
    const def = defs.find(d => d.id === id);
    return group().unlocked[id] !== undefined || Boolean(def && def.open && def.open(today()));
  };
  // The variants the lucky game draws from and "all unlocked" looks at.
  const live = () => {
    const flat = defs.filter(d => !d.solid);
    if (!flat.every(d => isUnlocked(d.id))) return flat;
    const day = today();
    const released = d => d.solid && d.from !== null && d.from !== undefined && d.from <= day;
    return [...flat, ...defs.filter(released)];
  };
  const all = () => Boolean(s) && live().every(d => isUnlocked(d.id));
  // What the menu shows. offer = the oldest open offer not played yet (named by its lucky day),
  // open = it can be played now (not while a game is on, not once everything is unlocked),
  // offerLast = its last day. nextLucky is the first lucky day after today.
  const view = () => {
    if (!s) return null;
    const day = today(), next = nextLucky(day), g = group();
    const offer = activeOffers(day).find(o => !g.played.includes(o));
    return {
      tokens: g.tokens, choices: g.choices, offer: offer ?? null, open: offer !== undefined && !s.active && !all(),
      offerLast: offer === undefined ? null : offerEnd(offer) - 1, luckyToday: isLucky(day),
      nextLucky: next, daysToNext: next - day, active: s.active, allUnlocked: all(),
    };
  };
  return {
    // Loads the state (a new player starts with nothing).
    async init() {
      try {
        const r = await storage.get(UNLOCK_KEY), c = r && JSON.parse(r.value), clean = sanitize(c, ids);
        if (clean) { s = clean; if (c.active) await save(); return; }
      } catch { /* fall through */ }
      s = fresh();
      await save();
    },
    unlocked: isUnlocked,
    allUnlocked: all,
    view,
    async addChoice() { if (s) { s.choices++; await save(); } },
    async takeChoice() { if (!s || group().choices < 1) return false; s.choices--; await save(); return true; },
    async addToken() { if (s) { s.tokens++; await save(); } },
    // Starts the lucky game of the open offer and draws the variant (rand(n) -> integer 0..n-1). A
    // locked variant gets one of its LUCKY sizes, an unlocked one any of its sizes. A player with an
    // unlock chance (holder) spends it now. null = no offer to play. Nothing else can start before
    // finish() or refund().
    async begin(rand) {
      const v = view(), list = live();
      if (!v || !v.open || !list.length) return null;
      const def = list[rand(list.length)], isNew = !isUnlocked(def.id);
      const sizes = isNew ? def.locked : def.pool, holder = group().tokens > 0;
      if (holder) s.tokens--;
      s.played = [...s.played, v.offer].slice(-PLAYED_KEPT);
      s.active = { id: def.id, size: sizes[rand(sizes.length)], day: today(), offer: v.offer, holder };
      await save();
      return { id: def.id, size: s.active.size, isNew, holder };
    },
    // The game could not start (the generator failed): the chance and the offer come back.
    async refund() {
      if (!s || !s.active) return;
      const { offer, holder } = s.active;
      if (holder) s.tokens++;
      s.played = s.played.filter(o => o !== offer); s.active = null;
      await save();
    },
    // The game ended: solved (a holder unlocks the variant, once) or not (leaving, a page reload).
    // null when no game was in progress, so calling it twice is harmless.
    async finish(solved) {
      if (!s || !s.active) return null;
      const { id, holder } = s.active, newly = solved && holder && !isUnlocked(id);
      s.active = null;
      if (newly) s.unlocked[id] = today();
      await save();
      return { id, solved, holder, newly };
    },
  };
}
