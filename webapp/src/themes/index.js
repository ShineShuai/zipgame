// The theme controller: the pool (pool.js), the device's own themes (store.js) and the page (apply.js) put together. Storage
// and the system's colour scheme are injected. A theme reaches a player as an offer: when an event fires, `event({ id, until })` picks a
// theme from the pool of the site (source.js, event.js), the player sees it (trial), and takes it (commit: it is saved on the device and in
// the pool, replacing a theme when the pool is full) or leaves it (revert: it is gone, nothing was kept). A theme that is in the
// player's pool needs no network. The mechanisms that award slots call setCap. The dev reveal lists the whole pool of the site
// (`pool`) and tries (`tryPool`) or keeps (`keepPool`) any theme of it, whatever the cap.
import { BUILTIN } from './builtin.js';
import { applyEntry, loadFonts as realLoadFonts } from './apply.js';
import { cleanBundle } from './bundle.js';
import {
  EVENT_KEY, EVENT_RE, SEED_KEY, SEED_RE, newSeed, offerOrder,
} from './event.js';
import {
  MODE_KEY, POOL_KEY, activeEntry, evictable, isClassicPool, nextEntry, parseState, remove, save, select, serialize, setCap,
} from './pool.js';

const MAX_TIMEOUT = 2 ** 31 - 1;
const OFFER_TRIES = 3;     // files tried for one offer (the picked theme, then the next ones) before there is no offer

export function createThemes({
  storage, media, store, source, apply = applyEntry, loadFonts = realLoadFonts, known, now = Date.now, timers = globalThis, random = Math.random,
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
    const entry = activeEntry(state, systemMode());
    if (entry.builtin) { show(entry, null); return; }
    const loaded = store.load(entry.id);
    if (loaded) { show(entry, loaded); return; }
    state = remove(state, entry.id);
    persist();
    show(builtinOf(entry.mode), null);
  }

  const clearTrial = () => { trialing = null; if (timer) timers.clearTimeout(timer); timer = null; };
  const choose = next => { clearTrial(); state = next; persist(); showActive(); };

  // Saves a valid bundle on the device and in the pool; false when it cannot (not a bundle, the pool is full and `replaceId`
  // names no theme, or the device refuses it). Nothing changes on false.
  function keep(bundle, replaceId) {
    const next = save(state, bundle.entry, replaceId);
    if (!next || !store.save(bundle)) return false;
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
  const trialOf = async (c, opts) => {
    const raw = await source?.bundle?.(c.f);
    return raw && raw.id === c.entry.id ? api.trial(raw, opts) : null;
  };

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
    trial: (raw, { until } = {}) => {
      const bundle = cleanBundle(raw, { known });
      if (!bundle || (until && until <= now())) return null;
      clearTrial();
      trialing = bundle;
      show(bundle.entry, { css: bundle.css, art: bundle.art, fonts: bundle.fonts });
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
    },
  };
  return api;
}
