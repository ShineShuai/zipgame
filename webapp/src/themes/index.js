// The theme controller: the pool (pool.js), the device's own themes (store.js) and the page (apply.js) put together. Storage
// and the system's colour scheme are injected. A theme reaches a player as an offer: when an event fires, `offer({ id, until })` picks a
// theme from the pool of the site (source.js, event.js) and keeps it waiting (trial.js: pending until the day ends). The player starts the
// trial (`startOffer`: trialMs of foreground time, a clock that stops while the page is hidden or a choice is being made, and that never ends
// in the middle of a puzzle: `idle`), then keeps the theme (`keepOffer`: it is saved on the device and in the pool, replacing a theme when
// the pool is full) or leaves it (`leaveOffer`: gone, nothing was kept). When the time is up the theme leaves the page and a last "keep it?"
// stays until the day ends. The record survives a reload. `event({ id, until })` is the older, immediate form (a trial at once, ended by
// `until`, no chip). A theme that is in the
// player's pool needs no network. The built-ins (light, dark) are in the site's pool too (no file: the app has them), so they can be
// offered again to a player who replaced them. `awardSlots` raises the pool's slots from the player's activity (slots.js). The dev reveal lists the whole pool of the site
// (`pool`) and tries (`tryPool`) or keeps (`keepPool`) any theme of it, whatever the cap.
import { BUILTIN } from './builtin.js';
import { applyEntry, loadFonts as realLoadFonts } from './apply.js';
import { cleanBundle } from './bundle.js';
import {
  EVENT_KEY, EVENT_RE, SEED_KEY, SEED_RE, endOfDay, newSeed, offerOrder,
} from './event.js';
import {
  MODE_KEY, POOL_KEY, activeEntry, evictable, isClassicPool, nextEntry, parseState, remove, save, select, serialize, setCap,
} from './pool.js';
import { slotsFor } from './slots.js';
import { FINAL_MS, OFFER_KEY, TRIAL_MS, parseOffer, serializeOffer } from './trial.js';

const MAX_TIMEOUT = 2 ** 31 - 1;
const OFFER_TRIES = 3;     // files tried for one offer (the picked theme, then the next ones) before there is no offer

export function createThemes({
  storage, media, store, source, apply = applyEntry, loadFonts = realLoadFonts, known, now = Date.now, timers = globalThis, random = Math.random,
  trialMs = TRIAL_MS, idle = () => true, focused = true,
}) {
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => {
    try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* private mode: not saved */ }
  };
  const systemMode = () => (media?.matches ? 'dark' : 'light');
  let state = parseState(read(POOL_KEY), read(MODE_KEY));
  let shown = null;
  let content = null;
  let fonts = null;
  let trialing = null;     // the bundle on trial, if any
  let timer = null;
  let offer = parseOffer(read(OFFER_KEY), trialMs);   // the theme that waits for the player, or null (see trial.js)
  if (offer && read(EVENT_KEY) === offer.event) offer = null;   // answered in another tab
  let ticking = null;     // when the foreground clock last started (null: not counting)
  let clock = null;       // the timer at the end of the trial time
  let expiry = null;      // the timer at the end of the day, for a waiting offer
  let held = false;       // a choice is being made: the clock waits
  let visible = focused;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn(api));

  function persist() {
    write(POOL_KEY, serialize(state));
    write(MODE_KEY, state.active ? activeEntry(state, systemMode()).mode : null);   // the old key: stats.html follows it
  }

  function show(entry, loaded) {
    shown = entry;
    content = loaded;
    fonts?.release();
    fonts = loaded?.fonts?.length ? loadFonts(loaded.fonts) : null;
    apply(entry, loaded);
    notify();
  }

  const builtinOf = mode => BUILTIN.find(b => b.mode === mode);

  // Shows the stored (or the system's) theme. A theme of the pool whose copy is not on this device any more (storage was
  // cleared, the device refused it) is not the player's now: it leaves the pool and the built-in of its mode shows.
  function showActive() {
    if (offer?.phase === 'trial') {   // the theme on trial is the one on the page, whatever the pool says
      const t = offer.theme;
      trialing = t;
      show(t.entry, t.entry.builtin ? null : { css: t.css, art: t.art, fonts: t.fonts });
      return;
    }
    const entry = activeEntry(state, systemMode());
    if (entry.builtin) { show(entry, null); return; }
    const loaded = store.load(entry.id);
    if (loaded) { show(entry, loaded); return; }
    state = remove(state, entry.id);
    persist();
    show(builtinOf(entry.mode), null);
  }

  const clearTrial = () => { trialing = null; if (timer) timers.clearTimeout(timer); timer = null; };
  const choose = next => { clearTrial(); interruptOffer(); state = next; persist(); showActive(); };

  // ---- the offer that waits: pending -> trial -> final (trial.js)
  const saveOffer = () => write(OFFER_KEY, offer ? serializeOffer(offer) : null);
  const stopClock = () => { if (clock) timers.clearTimeout(clock); clock = null; };
  const stopExpiry = () => { if (expiry) timers.clearTimeout(expiry); expiry = null; };
  const settle = () => { if (ticking !== null) { offer.left = Math.max(0, offer.left - (now() - ticking)); ticking = null; } };   // foreground time used
  const grace = () => Math.max(offer.until, now() + FINAL_MS);   // a trial that began late in the day still gets its last question
  function clearOffer() { stopClock(); stopExpiry(); ticking = null; held = false; offer = null; saveOffer(); }

  function planExpiry() {
    stopExpiry();
    if (!offer || offer.phase === 'trial') return;
    expiry = timers.setTimeout(() => { expiry = null; sweep(); planExpiry(); }, Math.min(Math.max(offer.until - now(), 0), MAX_TIMEOUT) + 1);
  }
  function sweep() {   // the day is over and the offer was not answered: it is gone, and answered
    if (!offer || offer.phase === 'trial' || offer.until > now()) return;
    write(EVENT_KEY, offer.event);
    clearOffer();
    notify();
  }
  function toFinal() {   // the trial time is up
    stopClock();
    settle();
    offer.phase = 'final';
    offer.left = 0;
    offer.until = grace();
    saveOffer();
    planExpiry();
  }
  function runClock() {
    stopClock();
    if (offer?.phase === 'trial') settle();
    if (offer?.phase !== 'trial' || !visible || held) return;
    ticking = now();
    clock = timers.setTimeout(finish, Math.min(offer.left, MAX_TIMEOUT));
  }
  function finish() {
    clock = null;
    if (offer?.phase !== 'trial') return;
    settle();
    if (offer.left > 0) { runClock(); return; }                       // the timer was clamped: not yet
    if (!idle()) { clock = timers.setTimeout(finish, 1000); return; }   // never in the middle of a puzzle: at the next menu
    toFinal();
    showActive();
    notify();
  }
  function interruptOffer() {   // another theme was chosen during the trial: the trial waits, with its time left, for the rest of the day
    if (offer?.phase !== 'trial') return;
    stopClock();
    settle();
    if (offer.left <= 0) { toFinal(); return; }
    offer.phase = 'pending';
    offer.until = grace();
    saveOffer();
    planExpiry();
  }

  // Saves a valid bundle on the device and in the pool; false when it cannot (not a bundle, the pool is full and `replaceId`
  // names no theme, or the device refuses it). Nothing changes on false.
  function keep(bundle, replaceId) {
    const next = save(state, bundle.entry, replaceId);
    if (!next || (!bundle.entry.builtin && !store.save(bundle))) return false;   // a built-in is the app's own: no copy to keep
    for (const e of state.pool) if (!next.pool.some(p => p.id === e.id) && !e.builtin) store.remove(e.id);
    state = next;
    return true;
  }

  // The device seed: random, made on first use, so that the same event gives the same theme on this device and another one elsewhere.
  const seed = () => {
    let value = read(SEED_KEY);
    if (!SEED_RE.test(value ?? '')) { value = newSeed(random); write(SEED_KEY, value); }
    return value;
  };

  // The bundle of a pool entry, on trial (null: the file is missing, is not a valid bundle, or is not the theme the manifest says).
  const bundleOf = async c => {
    if (c.entry.builtin) return { entry: c.entry, css: null, art: null, fonts: [] };   // light, dark: nothing to fetch
    const raw = await source?.bundle?.(c.f);
    return raw && raw.id === c.entry.id ? cleanBundle(raw, { known }) : null;
  };
  const trialOf = async (c, opts) => {
    const bundle = await bundleOf(c);
    return bundle ? begin(bundle, opts) : null;
  };

  // Puts a valid bundle (or a built-in's { entry, css: null, art: null, fonts: [] }) on trial: { entry, commit, revert }, or null when
  // the event it belongs to is already over.
  function begin(bundle, { until } = {}) {
    if (until && until <= now()) return null;
    clearTrial();
    interruptOffer();
    trialing = bundle;
    show(bundle.entry, bundle.entry.builtin ? null : { css: bundle.css, art: bundle.art, fonts: bundle.fonts });
    const revert = () => { if (trialing !== bundle) return; clearTrial(); showActive(); };
    if (until) timer = timers.setTimeout(revert, Math.min(until - now(), MAX_TIMEOUT));
    return {
      entry: bundle.entry,
      commit: async replaceId => {
        if (trialing !== bundle || !keep(bundle, replaceId)) return false;
        clearTrial();
        state = select(state, bundle.entry.id);
        persist();
        notify();
        return true;
      },
      revert,
    };
  }

  const api = {
    state: () => state,
    current: () => shown ?? activeEntry(state, systemMode()),
    art: () => content?.art ?? null,
    owns: id => state.pool.some(e => e.id === id),
    isClassic: () => isClassicPool(state),
    upcoming: () => nextEntry(state, api.current().id),   // what the header button would switch to
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    // Call once at start.
    start: () => {
      media?.addEventListener?.('change', () => { if (!state.active && !trialing) showActive(); });
      sweep();
      if (offer) { planExpiry(); runClock(); }
      showActive();
    },
    select: id => choose(select(state, id)),
    next: () => choose(select(state, nextEntry(state, api.current().id).id)),
    // Awards raise the cap (never above 4); the themes a lowered cap cuts leave the device too.
    setCap: n => {
      const next = setCap(state, n);
      for (const e of state.pool) if (!next.pool.some(p => p.id === e.id) && !e.builtin) store.remove(e.id);
      state = next;
      persist();
      showActive();
    },
    // An event fires: a theme of the site's pool waits for the player (the chip says "try it") until `until` (ms; default the end of the
    // local day). Promise<boolean>: true when an offer waits (a new one, or the same event again after a reload); false when the id is
    // not valid, the event is over or answered, another event's offer is still open, or there is nothing to offer (the pool is not
    // reachable, empty, all owned, all drafts, or the files are not valid): the next trigger tries again.
    offer: async ({ id, until } = {}) => {
      if (!EVENT_RE.test(id ?? '') || (until && until <= now())) return false;
      sweep();
      if (offer) return offer.event === id;
      if (read(EVENT_KEY) === id) return false;
      const list = ((await source?.pool?.()) ?? []).filter(c => c.live && !api.owns(c.entry.id));
      for (const c of offerOrder(list, seed(), id).slice(0, OFFER_TRIES)) {
        const theme = await bundleOf(c);
        if (!theme) continue;
        if (offer) return offer.event === id;   // an offer came in while the file was fetched
        offer = { event: id, phase: 'pending', until: until ?? endOfDay(now()), left: trialMs, theme };
        saveOffer();
        planExpiry();
        notify();
        return true;
      }
      return false;
    },
    // What the chip and the sheet draw: null, or { event, phase: 'pending' | 'trial' | 'final', entry, left (ms of trial time; in
    // pending the time still to try, in final 0), until (ms: when a waiting or final offer ends), held, trialMs }.
    offerView: () => {
      if (!offer) return null;
      const used = ticking === null ? 0 : now() - ticking;
      return { event: offer.event, phase: offer.phase, entry: offer.theme.entry, left: Math.max(0, offer.left - used), until: offer.until, held, trialMs };
    },
    // The player starts the trial (a waiting offer; also the rest of an interrupted one). false: nothing waits.
    startOffer: () => {
      sweep();
      if (offer?.phase !== 'pending') return false;
      clearTrial();
      stopExpiry();
      offer.phase = 'trial';
      saveOffer();
      showActive();
      runClock();
      notify();
      return true;
    },
    // Keeps the theme (trial or final) in the pool and makes it the active one; a full pool needs `replaceId`. Promise<boolean>.
    keepOffer: async replaceId => {
      if (!offer || offer.phase === 'pending') return false;
      const { theme, event } = offer;
      if (!keep(theme, replaceId)) return false;
      write(EVENT_KEY, event);
      clearOffer();
      clearTrial();
      state = select(state, theme.entry.id);
      persist();
      showActive();
      notify();
      return true;
    },
    // Leaves the theme (any phase): gone, answered, nothing kept.
    leaveOffer: () => {
      if (!offer) return;
      const wasOn = offer.phase === 'trial';
      write(EVENT_KEY, offer.event);
      clearOffer();
      clearTrial();
      if (wasOn) showActive();
      notify();
    },
    // The dev reveal starts afresh: the open offer goes without being answered.
    dropOffer: () => {
      const wasOn = offer?.phase === 'trial';
      clearOffer();
      clearTrial();
      if (wasOn) showActive();
      notify();
    },
    // The clock waits while a choice is being made (which theme the keep replaces).
    holdOffer: on => { held = Boolean(on); if (offer) runClock(); },
    // The page is seen (true) or hidden (false): only seen time counts for the trial; saved at once when it is hidden, so a killed tab keeps it.
    focus: seen => {
      visible = Boolean(seen);
      if (visible) sweep();
      if (offer) { runClock(); if (!visible) saveOffer(); }
    },
    // The player's activity ({ gotdSolves, bestStreak }, slots.js) raises the pool's slots (never lowers them). Promise-free: true when a slot came.
    awardSlots: counts => {
      const n = slotsFor(counts);
      if (n <= state.cap) return false;
      state = setCap(state, n);
      persist();
      notify();
      return true;
    },
    // An event fires: puts one theme of the site's pool on trial, shown until `until` (ms, the end of the event; the theme goes by itself
    // then). Promise<{ entry, commit, revert } | null>: commit(replaceId) keeps it and makes it the active theme, revert() leaves it; either
    // answers the event, which is not offered again. null: no valid id, the event is over or already answered, or there is nothing to
    // offer (the pool is not reachable, empty, all owned, all drafts, or the files are not valid).
    event: async ({ id, until } = {}) => {
      if (!EVENT_RE.test(id ?? '') || read(EVENT_KEY) === id || (until && until <= now())) return null;
      const list = ((await source?.pool?.()) ?? []).filter(c => c.live && !api.owns(c.entry.id));
      for (const c of offerOrder(list, seed(), id).slice(0, OFFER_TRIES)) {
        const t = await trialOf(c, { until });
        if (!t) continue;
        const answered = () => write(EVENT_KEY, id);
        return {
          entry: t.entry,
          commit: async replaceId => { const ok = await t.commit(replaceId); if (ok) answered(); return ok; },
          revert: () => { answered(); t.revert(); },
        };
      }
      return null;
    },
    // The dev reveal: every theme of the site's pool, drafts too: Promise<[{ entry, f, live, owned }]> ([] when it is not reachable).
    pool: async () => ((await source?.pool?.()) ?? []).map(c => ({ ...c, owned: api.owns(c.entry.id) })),
    // Shows any theme of the pool on trial, with no end and whatever the cap: Promise<{ entry, commit, revert } | null>.
    tryPool: async id => {
      const c = ((await source?.pool?.()) ?? []).find(x => x.entry.id === id);
      return c ? trialOf(c) : null;
    },
    // Keeps any theme of the pool: in a full pool it takes the place of one of the player's own (not the one showing). Promise<boolean>.
    keepPool: async id => {
      if (api.owns(id)) return false;
      const t = await api.tryPool(id);
      if (!t) return false;
      const full = state.pool.length >= state.cap;
      const out = full ? evictable(state, activeEntry(state, systemMode()).id)?.id : undefined;
      return t.commit(out);
    },
    // A bundle (from the console while developing) straight into the pool.
    install: (raw, replaceId) => {
      const bundle = cleanBundle(raw, { known });
      if (!bundle || !keep(bundle, replaceId)) return false;
      persist();
      return true;
    },
    // Shows a bundle without keeping anything. `until` (ms, the end of the event): the theme goes by itself then.
    // Returns null for something that is not a valid bundle (or an event already over), else { entry, commit, revert }:
    // commit(replaceId) -> Promise<boolean> keeps it and makes it the active theme; revert() puts the previous theme back.
    trial: (raw, opts) => {
      const bundle = cleanBundle(raw, { known });
      return bundle ? begin(bundle, opts) : null;
    },
  };
  return api;
}
